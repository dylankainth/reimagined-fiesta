/** @typedef {import('pear-interface')} */ /* global Pear */
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Hyperbee from 'hyperbee'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import { createHash } from 'crypto'
import { spawn } from 'child_process'
import Table from 'cli-table3'
import {
  MSG, JOB_STATUS, HEARTBEAT_INTERVAL, PAYMENT_INTERVAL,
  HARVEST_TOPIC, makeMsg, encode, decode
} from '@harvest/shared'

// ─── Provider config ──────────────────────────────────────────────────────────
const CFG = {
  cores:              4,
  ramGB:              8,
  pricePerCorePerMin: 0.001,
  pricePerGBPerMin:   0.0005,
  maxJobs:            3,
}

// ─── Pear runtime helpers (Pear is an injected global in the Pear runtime) ────
const pearConfig  = globalThis.Pear?.config
const teardown    = (fn) => globalThis.Pear ? globalThis.Pear.teardown(fn) : process.on('exit', fn)

// ─── Runtime state ────────────────────────────────────────────────────────────
const peers      = new Map()  // peerId → { send, conn }
const activeJobs = new Map()  // jobId  → JobState
const logLines   = []         // last 20 log lines for the UI

function log(line) {
  const ts = new Date().toISOString().slice(11, 23)
  logLines.push(`[${ts}] ${line}`)
  if (logLines.length > 20) logLines.shift()
}

// ─── Storage + Hypercore job log ──────────────────────────────────────────────
const storagePath = pearConfig?.storage ?? './provider-storage'
const store = new Corestore(storagePath)
const jobCore = store.get({ name: 'job-log' })
const bee = new Hyperbee(jobCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
await bee.ready()
log(`Hyperbee ready  logKey=${b4a.toString(jobCore.key, 'hex').slice(0, 16)}…`)

// ─── Hyperswarm DHT ───────────────────────────────────────────────────────────
const swarm = new Hyperswarm()
const PROVIDER_ID = b4a.toString(swarm.keyPair.publicKey, 'hex').slice(0, 16)
const topicBuf    = createHash('sha256').update(HARVEST_TOPIC).digest()

// ─── Connection handler — registered BEFORE join so we never miss an event ────
swarm.on('connection', (conn) => {
  const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
  log(`Peer connected: ${peerId}`)

  const mux = new Protomux(conn)
  const channel = mux.createChannel({
    protocol: 'harvest-compute-v1',
    onclose() {
      peers.delete(peerId)
      log(`Peer disconnected: ${peerId}`)
    },
  })

  const msg = channel.addMessage({
    encoding: c.raw,
    onmessage(buf) {
      let data
      try { data = decode(buf) } catch { return }
      handleMessage(data, peerId).catch((err) => log(`handleMessage err: ${err.message}`))
    },
  })

  channel.open()

  const send = (data) => {
    try { msg.send(encode(data)) } catch {}
  }

  peers.set(peerId, { send, conn })

  // Immediately advertise our capacity to this new peer
  send(makeMsg(MSG.ADVERTISE, {
    providerId:         PROVIDER_ID,
    publicKey:          b4a.toString(swarm.keyPair.publicKey, 'hex'),
    cores:              CFG.cores,
    ramGB:              CFG.ramGB,
    pricePerCorePerMin: CFG.pricePerCorePerMin,
    pricePerGBPerMin:   CFG.pricePerGBPerMin,
    maxJobs:            CFG.maxJobs,
    activeJobs:         activeJobs.size,
  }))
})

swarm.join(topicBuf, { server: true, client: true })
await swarm.flush()
log(`Joined DHT topic=${b4a.toString(topicBuf, 'hex').slice(0, 16)}…`)
log(`Provider ID: ${PROVIDER_ID}`)

// ─── Message router ───────────────────────────────────────────────────────────
async function handleMessage(data, peerId) {
  const peer = peers.get(peerId)
  if (!peer) return

  switch (data.type) {
    case MSG.JOB_REQUEST:   return handleJobRequest(data, peer, peerId)
    case MSG.PAYMENT_TICK:  return handlePaymentTick(data, peerId)
    case MSG.CANCEL_JOB:    return handleCancelJob(data, peerId)
    default:
      log(`Unknown msg type: ${data.type} from ${peerId}`)
  }
}

// ─── Job request ──────────────────────────────────────────────────────────────
async function handleJobRequest(data, peer, peerId) {
  const { jobId, description, cores, ramGB, estimatedMinutes, maxBudgetUSDT, type } = data
  log(`JOB_REQUEST jobId=${jobId.slice(0, 8)} cores=${cores} ram=${ramGB}GB from ${peerId}`)

  // Capacity checks
  if (activeJobs.size >= CFG.maxJobs) {
    peer.send(makeMsg(MSG.JOB_REJECT, { jobId, reason: 'Provider at max capacity' }))
    log(`Rejected ${jobId.slice(0, 8)}: at capacity`)
    return
  }
  if (cores > CFG.cores) {
    peer.send(makeMsg(MSG.JOB_REJECT, { jobId, reason: `Need ${cores} cores, have ${CFG.cores}` }))
    return
  }
  if (ramGB > CFG.ramGB) {
    peer.send(makeMsg(MSG.JOB_REJECT, { jobId, reason: `Need ${ramGB}GB RAM, have ${CFG.ramGB}GB` }))
    return
  }

  const estimatedCost =
    (cores * CFG.pricePerCorePerMin + ramGB * CFG.pricePerGBPerMin) * estimatedMinutes

  if (estimatedCost > maxBudgetUSDT * 1.1) { // allow 10% headroom
    peer.send(makeMsg(MSG.JOB_REJECT, {
      jobId,
      reason: `Est. cost $${estimatedCost.toFixed(5)} exceeds budget $${maxBudgetUSDT}`,
    }))
    log(`Rejected ${jobId.slice(0, 8)}: budget mismatch`)
    return
  }

  // Accept — log start to Hyperbee
  await bee.put(`job:${jobId}:start`, {
    jobId, description, cores, ramGB, type,
    status: JOB_STATUS.RUNNING,
    startedAt: Date.now(),
    peerId,
  })

  const job = {
    jobId, description, cores, ramGB, estimatedMinutes, maxBudgetUSDT, type,
    estimatedCost,
    status:          JOB_STATUS.RUNNING,
    startedAt:       Date.now(),
    peerId,
    peer,
    heartbeatCount:  0,
    paymentReceived: 0,
    proc:            null,
    heartbeatTimer:  null,
  }
  activeJobs.set(jobId, job)

  peer.send(makeMsg(MSG.JOB_ACCEPT, {
    jobId,
    estimatedCost,
    providerId:   PROVIDER_ID,
    logPublicKey: b4a.toString(jobCore.key, 'hex'),
  }))
  log(`Accepted ${jobId.slice(0, 8)} est=$${estimatedCost.toFixed(5)}`)

  runJob(job)
}

// ─── Payment tick handler ─────────────────────────────────────────────────────
function handlePaymentTick(data, peerId) {
  const { jobId, amount, tickIndex, totalPaid } = data
  const job = activeJobs.get(jobId)
  if (!job) return
  job.paymentReceived = totalPaid ?? (job.paymentReceived + (amount ?? 0))
  log(`PAYMENT_TICK #${tickIndex} jobId=${jobId.slice(0, 8)} +$${amount?.toFixed(6)} total=$${job.paymentReceived.toFixed(6)}`)
  // Persist payment record
  bee.put(`job:${jobId}:payment:${tickIndex}`, {
    amount, totalPaid: job.paymentReceived, ts: Date.now(),
  }).catch(() => {})
}

// ─── Cancel handler ───────────────────────────────────────────────────────────
function handleCancelJob(data, peerId) {
  const { jobId } = data
  const job = activeJobs.get(jobId)
  if (!job) return
  log(`CANCEL_JOB ${jobId.slice(0, 8)} from ${peerId}`)
  job.status = JOB_STATUS.CANCELLED
  job.proc?.kill('SIGTERM')
  clearInterval(job.heartbeatTimer)
  activeJobs.delete(jobId)
}

// ─── Job runner ───────────────────────────────────────────────────────────────
function runJob(job) {
  const { jobId, peer } = job

  // Python ML training simulation — 30 epochs, 1 s each → ~30 s total
  const pythonCode = [
    'import time, json, random, math, sys',
    'epochs = 30',
    'accuracy = 0.0',
    'for epoch in range(1, epochs + 1):',
    '    time.sleep(1)',
    '    loss = math.exp(-epoch * 0.15) + random.uniform(0, 0.05)',
    '    accuracy = 1 - math.exp(-epoch * 0.12) + random.uniform(-0.01, 0.02)',
    '    accuracy = min(max(accuracy, 0.0), 0.99)',
    '    print(json.dumps({"epoch": epoch, "total": 30, "loss": round(loss, 4), "accuracy": round(accuracy, 4)}), flush=True)',
    'print(json.dumps({"status": "done", "final_accuracy": round(accuracy, 4)}), flush=True)',
  ].join('\n')

  const proc = spawn('python3', ['-c', pythonCode], { stdio: ['ignore', 'pipe', 'pipe'] })
  job.proc = proc

  // ── Heartbeat loop ────────────────────────────────────────────────────────
  job.heartbeatTimer = setInterval(async () => {
    if (job.status !== JOB_STATUS.RUNNING) return
    job.heartbeatCount++
    const hb = makeMsg(MSG.HEARTBEAT, {
      jobId,
      providerId: PROVIDER_ID,
      seq:        job.heartbeatCount,
      cpuPct:     Math.round(20 + Math.random() * 60),
      memPct:     Math.round(30 + Math.random() * 40),
    })
    // Persist to tamper-evident log
    await bee.put(`job:${jobId}:heartbeat:${job.heartbeatCount}`, hb).catch(() => {})
    // Send to requester
    const p = peers.get(job.peerId)
    if (p) p.send(hb)
    log(`HB #${job.heartbeatCount} cpu=${hb.cpuPct}% mem=${hb.memPct}%`)
  }, HEARTBEAT_INTERVAL)

  // ── stdout → JOB_PROGRESS ─────────────────────────────────────────────────
  let stdoutBuf = ''
  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()  // keep the incomplete trailing line
    for (const line of lines) {
      if (!line.trim()) continue
      let parsed
      try { parsed = JSON.parse(line) } catch { continue }
      peer.send(makeMsg(MSG.JOB_PROGRESS, { jobId, data: parsed }))
      log(`Progress: ${line.slice(0, 80)}`)
    }
  })

  proc.stderr.on('data', (chunk) => {
    log(`[py stderr] ${chunk.toString().slice(0, 120)}`)
  })

  // ── Process exit ──────────────────────────────────────────────────────────
  proc.on('close', async (code) => {
    clearInterval(job.heartbeatTimer)
    if (job.status === JOB_STATUS.CANCELLED) return

    const elapsedMin = (Date.now() - job.startedAt) / 60_000
    const totalCost  = (job.cores * CFG.pricePerCorePerMin + job.ramGB * CFG.pricePerGBPerMin) * elapsedMin
    const logKey     = b4a.toString(jobCore.key, 'hex')
    const p          = peers.get(job.peerId)

    if (code === 0) {
      job.status = JOB_STATUS.COMPLETE
      await bee.put(`job:${jobId}:complete`, {
        status: JOB_STATUS.COMPLETE, totalCost, completedAt: Date.now(), logKey,
      }).catch(() => {})
      if (p) p.send(makeMsg(MSG.JOB_COMPLETE, { jobId, totalCost, logPublicKey: logKey }))
      log(`JOB_COMPLETE ${jobId.slice(0, 8)} totalCost=$${totalCost.toFixed(6)}`)
    } else {
      job.status = JOB_STATUS.FAILED
      await bee.put(`job:${jobId}:failed`, { exitCode: code, ts: Date.now() }).catch(() => {})
      if (p) p.send(makeMsg(MSG.JOB_FAILED, { jobId, reason: `python3 exited with code ${code}` }))
      log(`JOB_FAILED ${jobId.slice(0, 8)} exit=${code}`)
    }

    activeJobs.delete(jobId)
  })
}

// ─── Terminal UI ──────────────────────────────────────────────────────────────
function renderUI() {
  console.clear()
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║          HARVEST  —  PROVIDER  NODE            ║')
  console.log('╚════════════════════════════════════════════════╝')
  console.log(`  Provider ID : ${PROVIDER_ID}`)
  console.log(`  Peers       : ${peers.size}`)
  console.log(`  Capacity    : ${CFG.cores} cores · ${CFG.ramGB} GB RAM · max ${CFG.maxJobs} jobs`)
  console.log(`  Pricing     : $${CFG.pricePerCorePerMin}/core/min · $${CFG.pricePerGBPerMin}/GB/min`)
  console.log(`  Log key     : ${b4a.toString(jobCore.key, 'hex').slice(0, 32)}…`)
  console.log('')

  if (activeJobs.size > 0) {
    const table = new Table({
      head:      ['Job ID', 'Description', 'Status', 'HBs', 'Paid USDT'],
      colWidths: [10, 30, 10, 5, 12],
      style:     { head: ['cyan'] },
    })
    for (const [, job] of activeJobs) {
      table.push([
        job.jobId.slice(0, 8),
        job.description.slice(0, 28),
        job.status,
        job.heartbeatCount,
        job.paymentReceived.toFixed(5),
      ])
    }
    console.log(table.toString())
  } else {
    console.log('  ○  No active jobs — waiting for work…')
  }

  console.log('')
  console.log('─── Recent log ──────────────────────────────────')
  for (const line of logLines.slice(-10)) {
    console.log(`  ${line}`)
  }
}

setInterval(renderUI, 3_000)
renderUI()

// ─── Graceful shutdown ────────────────────────────────────────────────────────
teardown(async () => {
  for (const [, job] of activeJobs) {
    job.proc?.kill('SIGTERM')
    clearInterval(job.heartbeatTimer)
  }
  await swarm.destroy()
  await store.close()
})
