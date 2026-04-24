/** @typedef {import('pear-interface')} */ /* global Pear */
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import { createHash, randomBytes } from 'crypto'
import {
  MSG, JOB_STATUS, HEARTBEAT_INTERVAL, PAYMENT_INTERVAL,
  HARVEST_TOPIC, makeMsg, encode, decode
} from '@harvest/shared'

// ─── Default job to submit ────────────────────────────────────────────────────
const MY_JOB = {
  jobId:             randomBytes(16).toString('hex'),
  description:       'Train neural net on MNIST',
  type:              'ml-training',
  cores:             2,
  ramGB:             4,
  estimatedMinutes:  2,
  maxBudgetUSDT:     0.05,
}

// ─── Pear runtime helpers (Pear is an injected global in the Pear runtime) ────
const pearConfig  = globalThis.Pear?.config
const teardown    = (fn) => globalThis.Pear ? globalThis.Pear.teardown(fn) : process.on('exit', fn)

// ─── Timing constants ─────────────────────────────────────────────────────────
const WATCHDOG_TIMEOUT = 2.5 * PAYMENT_INTERVAL

// ─── Runtime state ────────────────────────────────────────────────────────────
const providers   = new Map()  // peerId → { send, advertise, conn }
const logLines    = []
let   currentJob  = null       // the one active job we track
let   jobStatus   = JOB_STATUS.PENDING
let   totalPaid   = 0
let   tickIndex   = 0
let   payTimer    = null
let   watchdogTimer = null
let   lastHeartbeatAt = null
let   epochLines  = []         // live progress output

function log(line) {
  const ts = new Date().toISOString().slice(11, 23)
  logLines.push(`[${ts}] ${line}`)
  if (logLines.length > 30) logLines.shift()
}

// ─── Storage ──────────────────────────────────────────────────────────────────
const storagePath = pearConfig?.storage ?? './requester-storage'
const store = new Corestore(storagePath)
await store.ready()
log('Corestore ready')

// ─── Hyperswarm DHT ───────────────────────────────────────────────────────────
const swarm      = new Hyperswarm()
const SELF_ID    = b4a.toString(swarm.keyPair.publicKey, 'hex').slice(0, 16)
const topicBuf   = createHash('sha256').update(HARVEST_TOPIC).digest()

// ─── Connection handler — registered BEFORE join so we never miss an event ────
swarm.on('connection', (conn) => {
  const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
  log(`Connected to peer: ${peerId}`)

  const mux = new Protomux(conn)
  const channel = mux.createChannel({
    protocol: 'harvest-compute-v1',
    onclose() {
      providers.delete(peerId)
      log(`Peer dropped: ${peerId}`)
      if (currentJob && currentJob.peerId === peerId && jobStatus === JOB_STATUS.RUNNING) {
        log('⚠  Provider disconnected mid-job — stopping payments')
        stopPaymentStream()
      }
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

  providers.set(peerId, { send, conn, advertise: null })
})

swarm.join(topicBuf, { server: false, client: true })
await swarm.flush()
log(`Requester ID: ${SELF_ID}`)
log(`Scanning DHT topic=${b4a.toString(topicBuf, 'hex').slice(0, 16)}…`)

// ─── Message router ───────────────────────────────────────────────────────────
async function handleMessage(data, peerId) {
  switch (data.type) {
    case MSG.ADVERTISE:    return handleAdvertise(data, peerId)
    case MSG.JOB_ACCEPT:   return handleJobAccept(data, peerId)
    case MSG.JOB_REJECT:   return handleJobReject(data, peerId)
    case MSG.HEARTBEAT:    return handleHeartbeat(data, peerId)
    case MSG.JOB_PROGRESS: return handleProgress(data)
    case MSG.JOB_COMPLETE: return handleJobComplete(data)
    case MSG.JOB_FAILED:   return handleJobFailed(data)
    default:
      log(`Unknown msg: ${data.type}`)
  }
}

// ─── ADVERTISE handler — pick cheapest and submit job ─────────────────────────
function handleAdvertise(data, peerId) {
  const provider = providers.get(peerId)
  if (!provider) return

  provider.advertise = data
  log(`ADVERTISE from ${data.providerId} cores=${data.cores} ram=${data.ramGB}GB ` +
      `price=${data.pricePerCorePerMin}/core/min active=${data.activeJobs}/${data.maxJobs}`)

  // Only submit once
  if (jobStatus !== JOB_STATUS.PENDING) return

  // Check if this provider can handle our job
  if (data.activeJobs >= data.maxJobs) {
    log(`${data.providerId} is full — waiting`)
    return
  }
  if (data.cores < MY_JOB.cores || data.ramGB < MY_JOB.ramGB) {
    log(`${data.providerId} insufficient resources`)
    return
  }

  const estCost = (MY_JOB.cores * data.pricePerCorePerMin + MY_JOB.ramGB * data.pricePerGBPerMin)
                * MY_JOB.estimatedMinutes
  if (estCost > MY_JOB.maxBudgetUSDT) {
    log(`${data.providerId} too expensive: est $${estCost.toFixed(5)} > budget $${MY_JOB.maxBudgetUSDT}`)
    return
  }

  // Pick this provider — submit job
  jobStatus = JOB_STATUS.MATCHED
  currentJob = { ...MY_JOB, peerId, providerId: data.providerId }
  log(`Submitting job ${MY_JOB.jobId.slice(0, 8)} to ${data.providerId}`)
  provider.send(makeMsg(MSG.JOB_REQUEST, MY_JOB))
}

// ─── JOB_ACCEPT ───────────────────────────────────────────────────────────────
function handleJobAccept(data, peerId) {
  const { jobId, estimatedCost, logPublicKey } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  jobStatus = JOB_STATUS.RUNNING
  log(`JOB_ACCEPT est=$${estimatedCost.toFixed(5)} logKey=${logPublicKey.slice(0, 16)}…`)

  currentJob.logPublicKey = logPublicKey
  currentJob.acceptedAt   = Date.now()

  startPaymentStream(peerId)
  startWatchdog()
}

// ─── JOB_REJECT ───────────────────────────────────────────────────────────────
function handleJobReject(data, peerId) {
  const { jobId, reason } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  log(`JOB_REJECT: ${reason} — resetting to PENDING`)
  jobStatus  = JOB_STATUS.PENDING
  currentJob = null
  // Will re-submit when another ADVERTISE arrives
}

// ─── HEARTBEAT ────────────────────────────────────────────────────────────────
function handleHeartbeat(data, peerId) {
  const { seq, cpuPct, memPct, jobId } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  lastHeartbeatAt = Date.now()
  log(`HB #${seq} cpu=${cpuPct}% mem=${memPct}%`)
  resetWatchdog()
}

// ─── JOB_PROGRESS ─────────────────────────────────────────────────────────────
function handleProgress(data) {
  const { jobId, data: prog } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  if (prog.epoch !== undefined) {
    const bar = progressBar(prog.epoch, prog.total ?? 10)
    const line = `Epoch ${String(prog.epoch).padStart(2)}/${prog.total ?? 10}  ${bar}  loss=${prog.loss.toFixed(4)}  acc=${(prog.accuracy * 100).toFixed(2)}%`
    epochLines.push(line)
    if (epochLines.length > 12) epochLines.shift()
  } else if (prog.status === 'done') {
    epochLines.push(`✓  Training complete — final accuracy: ${(prog.final_accuracy * 100).toFixed(2)}%`)
  }
}

// ─── JOB_COMPLETE ─────────────────────────────────────────────────────────────
function handleJobComplete(data) {
  const { jobId, totalCost, logPublicKey } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  jobStatus = JOB_STATUS.COMPLETE
  stopPaymentStream()
  stopWatchdog()

  log(`JOB_COMPLETE totalCost=$${totalCost.toFixed(6)} totalPaid=$${totalPaid.toFixed(6)}`)
  log(`Verify proof-of-work at logKey=${logPublicKey}`)

  // Print final summary
  console.log('\n')
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║             JOB COMPLETED                      ║')
  console.log('╚════════════════════════════════════════════════╝')
  console.log(`  Job ID      : ${jobId}`)
  console.log(`  Total cost  : $${totalCost.toFixed(6)} USDT`)
  console.log(`  Total paid  : $${totalPaid.toFixed(6)} USDT`)
  console.log(`  Log key     : ${logPublicKey}`)
  console.log('  (Use this key to independently verify execution on the Hypercore log)')
  console.log('')
}

// ─── JOB_FAILED ───────────────────────────────────────────────────────────────
function handleJobFailed(data) {
  const { jobId, reason } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  jobStatus = JOB_STATUS.FAILED
  stopPaymentStream()
  stopWatchdog()
  log(`JOB_FAILED: ${reason}`)
}

// ─── Payment stream ───────────────────────────────────────────────────────────
function startPaymentStream(peerId) {
  payTimer = setInterval(() => {
    const provider = providers.get(peerId)
    if (!provider || jobStatus !== JOB_STATUS.RUNNING) return

    const elapsedMin = (Date.now() - currentJob.acceptedAt) / 60_000
    const tickAmount = (MY_JOB.cores * 0.001 + MY_JOB.ramGB * 0.0005) *
                       (PAYMENT_INTERVAL / 60_000)
    totalPaid  += tickAmount
    tickIndex  += 1

    provider.send(makeMsg(MSG.PAYMENT_TICK, {
      jobId:    currentJob.jobId,
      amount:   tickAmount,
      tickIndex,
      totalPaid,
    }))
    log(`PAYMENT_TICK #${tickIndex} amount=$${tickAmount.toFixed(6)} total=$${totalPaid.toFixed(6)}`)
  }, PAYMENT_INTERVAL)
}

function stopPaymentStream() {
  clearInterval(payTimer)
  payTimer = null
}

// ─── Heartbeat watchdog ───────────────────────────────────────────────────────
// If no heartbeat in 2.5 × PAYMENT_INTERVAL → warn and pause payments
function startWatchdog() {
  lastHeartbeatAt = Date.now()
  watchdogTimer   = setInterval(() => {
    if (!lastHeartbeatAt) return
    const silence = Date.now() - lastHeartbeatAt
    if (silence > WATCHDOG_TIMEOUT && jobStatus === JOB_STATUS.RUNNING) {
      log(`⚠  WATCHDOG: no heartbeat for ${(silence / 1000).toFixed(0)}s — pausing payments!`)
      stopPaymentStream()
      jobStatus = JOB_STATUS.FAILED  // treat as failed
    }
  }, 1_000)
}

function resetWatchdog() {
  lastHeartbeatAt = Date.now()
  // If payments were paused and provider came back, resume
  if (!payTimer && jobStatus === JOB_STATUS.RUNNING && currentJob) {
    log('Heartbeat resumed — restarting payment stream')
    startPaymentStream(currentJob.peerId)
  }
}

function stopWatchdog() {
  clearInterval(watchdogTimer)
  watchdogTimer = null
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function progressBar(current, total, width = 20) {
  const filled = Math.round((current / total) * width)
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']'
}

function statusBadge(s) {
  const badges = {
    [JOB_STATUS.PENDING]:   '○ pending',
    [JOB_STATUS.MATCHED]:   '◎ matched',
    [JOB_STATUS.RUNNING]:   '● running',
    [JOB_STATUS.COMPLETE]:  '✓ complete',
    [JOB_STATUS.FAILED]:    '✗ failed',
    [JOB_STATUS.CANCELLED]: '⊘ cancelled',
  }
  return badges[s] ?? s
}

// ─── Terminal UI ──────────────────────────────────────────────────────────────
function renderUI() {
  console.clear()
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║          HARVEST  —  REQUESTER  NODE           ║')
  console.log('╚════════════════════════════════════════════════╝')
  console.log(`  Requester ID : ${SELF_ID}`)
  console.log(`  Providers    : ${providers.size} discovered`)
  console.log('')

  if (currentJob) {
    const elapsed = currentJob.acceptedAt
      ? ((Date.now() - currentJob.acceptedAt) / 1000).toFixed(1)
      : '—'
    console.log('┌─ Active Job ─────────────────────────────────┐')
    console.log(`│  ID          : ${currentJob.jobId.slice(0, 16)}…`)
    console.log(`│  Description : ${currentJob.description}`)
    console.log(`│  Provider    : ${currentJob.providerId ?? '—'}`)
    console.log(`│  Status      : ${statusBadge(jobStatus)}`)
    console.log(`│  Elapsed     : ${elapsed}s`)
    console.log(`│  Paid        : $${totalPaid.toFixed(6)} USDT  (tick #${tickIndex})`)
    if (currentJob.logPublicKey) {
      console.log(`│  Log key     : ${currentJob.logPublicKey.slice(0, 32)}…`)
    }
    console.log('└──────────────────────────────────────────────┘')
    console.log('')
  } else {
    const job = MY_JOB
    console.log('┌─ Pending Job ────────────────────────────────┐')
    console.log(`│  ID          : ${job.jobId.slice(0, 16)}…`)
    console.log(`│  Description : ${job.description}`)
    console.log(`│  Resources   : ${job.cores} cores · ${job.ramGB} GB RAM`)
    console.log(`│  Budget      : $${job.maxBudgetUSDT} USDT  (${job.estimatedMinutes} min est.)`)
    console.log(`│  Status      : ${statusBadge(jobStatus)}`)
    console.log('└──────────────────────────────────────────────┘')
    console.log('')
  }

  if (epochLines.length > 0) {
    console.log('─── Training output ─────────────────────────────')
    for (const line of epochLines) {
      console.log(`  ${line}`)
    }
    console.log('')
  }

  console.log('─── Log ─────────────────────────────────────────')
  for (const line of logLines.slice(-10)) {
    console.log(`  ${line}`)
  }
}

setInterval(renderUI, 3_000)
renderUI()

// ─── Graceful shutdown ────────────────────────────────────────────────────────
teardown(async () => {
  stopPaymentStream()
  stopWatchdog()
  await swarm.destroy()
  await store.close()
})
