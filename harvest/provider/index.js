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

// ─── Supported job types with price multipliers ───────────────────────────────
const SUPPORTED_JOB_TYPES = {
  'ml-training':  { description: 'ML training run',  multiplier: 1.0 },
  'rendering':    { description: '3D render job',    multiplier: 1.2 },
  'data-process': { description: 'Data pipeline',    multiplier: 0.8 },
  'compression':  { description: 'File compression', multiplier: 0.6 },
}

// ─── CLI args ─────────────────────────────────────────────────────────────────
{
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--storage' && args[i + 1]) { process.env.PROVIDER_STORAGE = args[++i] }
    if (args[i] === '--cores'   && args[i + 1]) { CFG.cores   = Number(args[++i]) }
    if (args[i] === '--price'   && args[i + 1]) { CFG.pricePerCorePerMin = Number(args[++i]) }
  }
}

// ─── Pear runtime helpers ─────────────────────────────────────────────────────
const pearConfig = globalThis.Pear?.config
const teardown   = (fn) => globalThis.Pear ? globalThis.Pear.teardown(fn) : process.on('exit', fn)

// ─── Runtime state ────────────────────────────────────────────────────────────
const peers      = new Map()   // peerId → { send, conn }
const activeJobs = new Map()   // jobId  → JobState
const logLines   = []
let   totalEarned   = 0
let   completedJobs = 0
const startedAt     = Date.now()

function log(line) {
  const ts = new Date().toISOString().slice(11, 23)
  logLines.push(`[${ts}] ${line}`)
  if (logLines.length > 20) logLines.shift()
}

// ─── Storage + Hypercore job log ──────────────────────────────────────────────
const storagePath = pearConfig?.storage ?? process.env.PROVIDER_STORAGE ?? './provider-storage'
const store   = new Corestore(storagePath)
const jobCore = store.get({ name: 'job-log' })
const bee     = new Hyperbee(jobCore, { keyEncoding: 'utf-8', valueEncoding: 'json' })
await bee.ready()
log(`Hyperbee ready  logKey=${b4a.toString(jobCore.key, 'hex').slice(0, 16)}…`)

// ─── Load persisted stats ─────────────────────────────────────────────────────
const statsEntry = await bee.get('provider:stats')
if (statsEntry?.value) {
  completedJobs = statsEntry.value.completedJobs ?? 0
  totalEarned   = statsEntry.value.totalEarned   ?? 0
}
log(`Loaded stats: completedJobs=${completedJobs} earned=$${totalEarned.toFixed(6)}`)

// ─── Hyperswarm DHT ───────────────────────────────────────────────────────────
const swarm       = new Hyperswarm()
const PROVIDER_ID = b4a.toString(swarm.keyPair.publicKey, 'hex').slice(0, 16)
const topicBuf    = createHash('sha256').update(HARVEST_TOPIC).digest()

// ─── Advertise helper — used on connect and after job changes ─────────────────
function advertise(send) {
  send(makeMsg(MSG.ADVERTISE, {
    providerId:         PROVIDER_ID,
    publicKey:          b4a.toString(swarm.keyPair.publicKey, 'hex'),
    cores:              CFG.cores,
    ramGB:              CFG.ramGB,
    pricePerCorePerMin: CFG.pricePerCorePerMin,
    pricePerGBPerMin:   CFG.pricePerGBPerMin,
    maxJobs:            CFG.maxJobs,
    activeJobs:         activeJobs.size,
    completedJobs,
    supportedTypes:     Object.keys(SUPPORTED_JOB_TYPES),
  }))
}

// ─── Connection handler ───────────────────────────────────────────────────────
swarm.on('connection', (conn) => {
  const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
  log(`Peer connected: ${peerId}`)

  const mux     = new Protomux(conn)
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

  const send = (data) => { try { msg.send(encode(data)) } catch {} }
  peers.set(peerId, { send, conn })
  advertise(send)
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
    case MSG.CHANNEL_OPEN:  return handleChannelEvent(data, 'open')
    case MSG.CHANNEL_PAUSE: return handleChannelEvent(data, 'pause')
    case MSG.CHANNEL_CLOSE: return handleChannelEvent(data, 'close')
    default:
      log(`Unknown msg type: ${data.type} from ${peerId}`)
  }
}

// ─── Job request ──────────────────────────────────────────────────────────────
async function handleJobRequest(data, peer, peerId) {
  const { jobId, description, cores, ramGB, estimatedMinutes, maxBudgetUSDT, jobType } = data
  log(`JOB_REQUEST jobId=${jobId.slice(0, 8)} type=${jobType} cores=${cores} ram=${ramGB}GB from ${peerId}`)

  // Job type check
  if (!SUPPORTED_JOB_TYPES[jobType]) {
    peer.send(makeMsg(MSG.JOB_REJECT, { jobId, reason: 'Unsupported job type' }))
    log(`Rejected ${jobId.slice(0, 8)}: unsupported type '${jobType}'`)
    return
  }

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

  const multiplier     = SUPPORTED_JOB_TYPES[jobType].multiplier
  const estimatedCost  =
    (cores * CFG.pricePerCorePerMin + ramGB * CFG.pricePerGBPerMin) * estimatedMinutes * multiplier

  if (estimatedCost > maxBudgetUSDT * 1.1) {
    peer.send(makeMsg(MSG.JOB_REJECT, {
      jobId,
      reason: `Est. cost $${estimatedCost.toFixed(5)} exceeds budget $${maxBudgetUSDT}`,
    }))
    log(`Rejected ${jobId.slice(0, 8)}: budget mismatch`)
    return
  }

  await bee.put(`job:${jobId}:start`, {
    jobId, description, cores, ramGB, jobType,
    status: JOB_STATUS.RUNNING,
    startedAt: Date.now(),
    peerId,
  })

  const job = {
    jobId, description, cores, ramGB, estimatedMinutes, maxBudgetUSDT, type: jobType,
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
  log(`Accepted ${jobId.slice(0, 8)} type=${jobType} multiplier=${multiplier} est=$${estimatedCost.toFixed(5)}`)

  // Re-broadcast updated activeJobs count
  for (const [, p] of peers) advertise(p.send)

  runJob(job)
}

// ─── Payment tick handler ─────────────────────────────────────────────────────
function handlePaymentTick(data, peerId) {
  const { jobId, amount, tickIndex, totalPaid } = data
  const job = activeJobs.get(jobId)
  if (!job) return
  job.paymentReceived = totalPaid ?? (job.paymentReceived + (amount ?? 0))
  log(`PAYMENT_TICK #${tickIndex} jobId=${jobId.slice(0, 8)} +$${amount?.toFixed(6)} total=$${job.paymentReceived.toFixed(6)}`)
  bee.put(`job:${jobId}:payment:${tickIndex}`, {
    amount, totalPaid: job.paymentReceived, ts: Date.now(),
  }).catch(() => {})
}

// ─── Channel event handler ────────────────────────────────────────────────────
function handleChannelEvent(data, event) {
  const { jobId, totalPaid, finalAmount } = data
  const amount = finalAmount ?? totalPaid ?? 0
  bee.put(`job:${jobId}:channel:${event}`, {
    event, amount, timestamp: Date.now(),
  }).catch(() => {})
  const label = `CHANNEL_${event.toUpperCase()}`
  log(`${label} jobId=${jobId?.slice(0, 8)} amount=$${amount.toFixed ? amount.toFixed(6) : amount}`)
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

// ─── Python code per job type ─────────────────────────────────────────────────
function pythonCodeFor(type) {
  switch (type) {
    case 'ml-training':
      return [
        'import time, json, random, math',
        'epochs = 30',
        'for epoch in range(1, epochs + 1):',
        '    time.sleep(1)',
        '    loss = math.exp(-epoch * 0.15) + random.uniform(0, 0.05)',
        '    acc  = 1 - math.exp(-epoch * 0.12) + random.uniform(-0.01, 0.02)',
        '    acc  = min(max(acc, 0.0), 0.99)',
        '    print(json.dumps({"epoch": epoch, "total": 30, "loss": round(loss, 4), "accuracy": round(acc, 4)}), flush=True)',
        'print(json.dumps({"status": "done", "final_accuracy": round(acc, 4)}), flush=True)',
      ].join('\n')

    case 'rendering':
      return [
        'import time, json, random',
        'frames = 30',
        'for frame in range(1, frames + 1):',
        '    time.sleep(1)',
        '    render_time = round(0.8 + random.uniform(0, 0.4), 3)',
        '    rays        = random.randint(800_000, 1_200_000)',
        '    print(json.dumps({"frame": frame, "total": 30, "render_time": render_time, "rays": rays}), flush=True)',
        'print(json.dumps({"status": "done", "total_frames": 30}), flush=True)',
      ].join('\n')

    case 'data-process':
      return [
        'import time, json, random',
        'batches = 30',
        'total_rows = 0',
        'for batch in range(1, batches + 1):',
        '    time.sleep(1)',
        '    rows      = random.randint(8_000, 12_000)',
        '    anomalies = random.randint(0, 20)',
        '    total_rows += rows',
        '    print(json.dumps({"batch": batch, "total": 30, "rows_processed": rows, "anomalies": anomalies, "cumulative": total_rows}), flush=True)',
        'print(json.dumps({"status": "done", "total_rows": total_rows}), flush=True)',
      ].join('\n')

    case 'compression':
      return [
        'import time, json, random',
        'chunks = 30',
        'for chunk in range(1, chunks + 1):',
        '    time.sleep(1)',
        '    mb_in   = round(random.uniform(45, 55), 2)',
        '    ratio   = round(random.uniform(2.1, 3.8), 3)',
        '    mb_out  = round(mb_in / ratio, 2)',
        '    print(json.dumps({"chunk": chunk, "total": 30, "mb_processed": mb_in, "ratio": ratio, "mb_out": mb_out}), flush=True)',
        'print(json.dumps({"status": "done", "total_chunks": 30}), flush=True)',
      ].join('\n')

    default:
      // Fallback — should never reach here due to type check in handleJobRequest
      return 'import json; print(json.dumps({"status": "done"}))'
  }
}

// ─── Job runner ───────────────────────────────────────────────────────────────
function runJob(job) {
  const { jobId, peer, type } = job

  const proc = spawn('python3', ['-c', pythonCodeFor(type)], { stdio: ['ignore', 'pipe', 'pipe'] })
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
    await bee.put(`job:${jobId}:heartbeat:${job.heartbeatCount}`, hb).catch(() => {})
    const p = peers.get(job.peerId)
    if (p) p.send(hb)
    log(`HB #${job.heartbeatCount} cpu=${hb.cpuPct}% mem=${hb.memPct}%`)
  }, HEARTBEAT_INTERVAL)

  // ── stdout → JOB_PROGRESS ─────────────────────────────────────────────────
  let stdoutBuf = ''
  proc.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split('\n')
    stdoutBuf = lines.pop()
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

    const multiplier  = SUPPORTED_JOB_TYPES[job.type]?.multiplier ?? 1.0
    const elapsedMin  = (Date.now() - job.startedAt) / 60_000
    const totalCost   = (job.cores * CFG.pricePerCorePerMin + job.ramGB * CFG.pricePerGBPerMin)
                        * elapsedMin * multiplier
    const logKey      = b4a.toString(jobCore.key, 'hex')
    const p           = peers.get(job.peerId)

    if (code === 0) {
      job.status = JOB_STATUS.COMPLETE
      completedJobs++
      totalEarned += job.paymentReceived
      await bee.put(`job:${jobId}:complete`, {
        status: JOB_STATUS.COMPLETE, totalCost, completedAt: Date.now(), logKey,
      }).catch(() => {})
      await bee.put('provider:stats', { completedJobs, totalEarned }).catch(() => {})
      if (p) p.send(makeMsg(MSG.JOB_COMPLETE, { jobId, totalCost, logPublicKey: logKey }))
      log(`JOB_COMPLETE ${jobId.slice(0, 8)} totalCost=$${totalCost.toFixed(6)}`)
    } else {
      job.status = JOB_STATUS.FAILED
      await bee.put(`job:${jobId}:failed`, { exitCode: code, ts: Date.now() }).catch(() => {})
      if (p) p.send(makeMsg(MSG.JOB_FAILED, { jobId, reason: `python3 exited with code ${code}` }))
      log(`JOB_FAILED ${jobId.slice(0, 8)} exit=${code}`)
    }

    activeJobs.delete(jobId)
    // Re-broadcast updated activeJobs count and completedJobs
    for (const [, peer] of peers) advertise(peer.send)
  })
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function fmtUptime() {
  const s = Math.floor((Date.now() - startedAt) / 1000)
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`
}

// ─── Terminal UI ──────────────────────────────────────────────────────────────
function renderUI() {
  console.clear()
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║          HARVEST  —  PROVIDER  NODE              ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`  Provider ID   : ${PROVIDER_ID}`)
  console.log(`  Uptime        : ${fmtUptime()}`)
  console.log(`  Peers         : ${peers.size}`)
  console.log(`  Total earned  : $${totalEarned.toFixed(6)} USDT`)
  console.log(`  Capacity      : ${CFG.cores} cores · ${CFG.ramGB} GB RAM · max ${CFG.maxJobs} jobs`)
  console.log(`  Pricing       : $${CFG.pricePerCorePerMin}/core/min · $${CFG.pricePerGBPerMin}/GB/min`)
  console.log(`  Log key       : ${b4a.toString(jobCore.key, 'hex').slice(0, 32)}…`)
  console.log('')

  if (activeJobs.size > 0) {
    const table = new Table({
      head:      ['Job ID', 'Type', 'Status', 'HBs', 'Earned USDT'],
      colWidths: [10, 15, 10, 5, 13],
      style:     { head: ['cyan'] },
    })
    for (const [, job] of activeJobs) {
      table.push([
        job.jobId.slice(0, 8),
        job.type,
        job.status,
        job.heartbeatCount,
        `$${job.paymentReceived.toFixed(6)}`,
      ])
    }
    console.log(table.toString())
  } else {
    console.log('  ○  No active jobs — waiting for work…')
  }

  console.log('')
  console.log(`  Completed jobs: ${completedJobs}   Max concurrent: ${CFG.maxJobs}`)
  console.log('')
  console.log('─── Recent log ──────────────────────────────────────')
  for (const line of logLines.slice(-8)) {
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
