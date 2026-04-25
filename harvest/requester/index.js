/** @typedef {import('pear-interface')} */ /* global Pear */
import Hyperswarm from 'hyperswarm'
import Corestore from 'corestore'
import Protomux from 'protomux'
import c from 'compact-encoding'
import b4a from 'b4a'
import { createHash, randomBytes } from 'crypto'
import {
  MSG, JOB_STATUS, PAYMENT_INTERVAL,
  HARVEST_TOPIC, makeMsg, encode, decode
} from '@harvest/shared'

// ─── CLI args ─────────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const out  = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--') && args[i + 1] !== undefined) {
      out[args[i].slice(2)] = args[i + 1]
      i++
    }
  }
  return out
}
const argv = parseArgs()

// ─── Job config (CLI args override defaults) ──────────────────────────────────
const JOB = {
  jobId:            randomBytes(16).toString('hex'),
  description:      argv.description ?? 'Train neural net on MNIST',
  jobType:          argv.type        ?? 'ml-training',
  cores:            Number(argv.cores)   || 2,
  ramGB:            Number(argv.ram)     || 4,
  estimatedMinutes: Number(argv.minutes) || 1,
  maxBudgetUSDT:    Number(argv.budget)  || 0.05,
}

// ─── Pear runtime helpers ─────────────────────────────────────────────────────
const pearConfig = globalThis.Pear?.config
const teardown   = (fn) => globalThis.Pear ? globalThis.Pear.teardown(fn) : process.on('exit', fn)

// ─── Timing constants ─────────────────────────────────────────────────────────
const WATCHDOG_TIMEOUT = 2.5 * PAYMENT_INTERVAL

// ─── Runtime state ────────────────────────────────────────────────────────────
const providers  = new Map()  // peerId → { send, conn, advertise }
const logLines   = []
let   currentJob = null       // { ...JOB, peerId, providerId, acceptedAt, logPublicKey, score, rep, failedPeers }
let   jobStatus  = JOB_STATUS.PENDING
let   totalPaid  = 0
let   tickIndex  = 0
let   payTimer   = null
let   watchdogTimer  = null
let   failoverTimer  = null
let   lastHeartbeatAt = null
let   heartbeatCount  = 0
let   progressCurrent = 0
let   progressTotal   = 30
let   lastProgressLine = null

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
const swarm    = new Hyperswarm()
const SELF_ID  = b4a.toString(swarm.keyPair.publicKey, 'hex').slice(0, 16)
const topicBuf = createHash('sha256').update(HARVEST_TOPIC).digest()

// ─── Provider scoring ─────────────────────────────────────────────────────────
function scoreProvider(adv) {
  if (!adv) return -1
  if (adv.activeJobs >= adv.maxJobs) return -1
  if (adv.cores < JOB.cores || adv.ramGB < JOB.ramGB) return -1
  const estCost = (JOB.cores * adv.pricePerCorePerMin + JOB.ramGB * adv.pricePerGBPerMin)
                * JOB.estimatedMinutes
  if (estCost > JOB.maxBudgetUSDT) return -1
  const reputation = adv.completedJobs || 0
  const available  = adv.maxJobs - adv.activeJobs
  return (1 / adv.pricePerCorePerMin) * (1 + reputation * 0.1) * available
}

// ─── Find best provider and submit job ────────────────────────────────────────
function findAndSubmitJob() {
  clearTimeout(failoverTimer)
  failoverTimer = null

  // Don't re-enter if already dispatched or finished
  if (jobStatus === JOB_STATUS.COMPLETE   ||
      jobStatus === JOB_STATUS.CANCELLED  ||
      jobStatus === JOB_STATUS.MATCHED    ||
      jobStatus === JOB_STATUS.RUNNING) return

  const failedPeers = currentJob?.failedPeers ?? new Set()

  // Score all eligible providers
  let bestPeerId = null
  let bestScore  = -Infinity
  for (const [peerId, p] of providers) {
    if (!p.advertise) continue
    if (failedPeers.has(peerId)) continue
    const score = scoreProvider(p.advertise)
    if (score > bestScore) {
      bestScore  = score
      bestPeerId = peerId
    }
  }

  if (bestPeerId === null) {
    log('⚠  No providers available — waiting for new peers...')
    failoverTimer = setTimeout(() => {
      if (jobStatus === JOB_STATUS.PENDING) findAndSubmitJob()
    }, 10_000)
    return
  }

  const p   = providers.get(bestPeerId)
  const adv = p.advertise

  // Reset per-run progress tracking
  progressCurrent  = 0
  progressTotal    = 30
  lastProgressLine = null
  lastHeartbeatAt  = null
  heartbeatCount   = 0

  jobStatus  = JOB_STATUS.MATCHED
  currentJob = {
    ...JOB,
    peerId:      bestPeerId,
    providerId:  adv.providerId,
    score:       bestScore,
    rep:         adv.completedJobs || 0,
    failedPeers,
  }

  log(`Submitting job ${JOB.jobId.slice(0, 8)} to ${adv.providerId} ` +
      `(score: ${bestScore.toFixed(1)}, rep: ${adv.completedJobs || 0} jobs)`)
  p.send(makeMsg(MSG.JOB_REQUEST, JOB))
}

// ─── Connection handler ───────────────────────────────────────────────────────
swarm.on('connection', (conn) => {
  const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
  log(`Connected to peer: ${peerId}`)

  const mux     = new Protomux(conn)
  const channel = mux.createChannel({
    protocol: 'harvest-compute-v1',
    onclose() {
      providers.delete(peerId)
      log(`Peer dropped: ${peerId}`)

      if (currentJob?.peerId === peerId &&
          (jobStatus === JOB_STATUS.RUNNING || jobStatus === JOB_STATUS.MATCHED)) {
        log(`⚠  Provider ${peerId} disconnected — seeking failover...`)
        stopPaymentStream()
        stopWatchdog()
        currentJob.failedPeers.add(peerId)
        jobStatus  = JOB_STATUS.PENDING
        findAndSubmitJob()
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

  const send = (data) => { try { msg.send(encode(data)) } catch {} }
  providers.set(peerId, { send, conn, advertise: null })
})

swarm.join(topicBuf, { server: false, client: true })
await swarm.flush()
log(`Requester ID: ${SELF_ID}`)
log(`Job type: ${JOB.jobType}  cores: ${JOB.cores}  RAM: ${JOB.ramGB}GB  budget: $${JOB.maxBudgetUSDT}`)
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
    default:               log(`Unknown msg: ${data.type}`)
  }
}

// ─── ADVERTISE ───────────────────────────────────────────────────────────────
function handleAdvertise(data, peerId) {
  const provider = providers.get(peerId)
  if (!provider) return
  provider.advertise = data

  log(`ADVERTISE from ${data.providerId} cores=${data.cores} ram=${data.ramGB}GB ` +
      `$${data.pricePerCorePerMin}/core/min rep=${data.completedJobs ?? 0} ` +
      `active=${data.activeJobs}/${data.maxJobs}`)

  if (jobStatus === JOB_STATUS.PENDING) findAndSubmitJob()
}

// ─── JOB_ACCEPT ──────────────────────────────────────────────────────────────
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

// ─── JOB_REJECT ──────────────────────────────────────────────────────────────
function handleJobReject(data, peerId) {
  const { jobId, reason } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  log(`JOB_REJECT from ${peerId}: ${reason}`)
  currentJob.failedPeers.add(peerId)
  jobStatus = JOB_STATUS.PENDING
  findAndSubmitJob()
}

// ─── HEARTBEAT ───────────────────────────────────────────────────────────────
function handleHeartbeat(data, peerId) {
  const { seq, cpuPct, memPct, jobId } = data
  if (!currentJob || currentJob.jobId !== jobId) return
  lastHeartbeatAt = Date.now()
  heartbeatCount  = seq
  log(`HB #${seq} cpu=${cpuPct}% mem=${memPct}%`)
  resetWatchdog()
}

// ─── JOB_PROGRESS ────────────────────────────────────────────────────────────
function handleProgress(data) {
  const { jobId, data: prog } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  lastProgressLine = JSON.stringify(prog)

  // Generic: pick whichever step counter this job type uses
  const step = prog.epoch ?? prog.frame ?? prog.batch ?? prog.chunk
  if (step !== undefined) {
    progressCurrent = step
    progressTotal   = prog.total ?? 30
  }
}

// ─── JOB_COMPLETE ────────────────────────────────────────────────────────────
function handleJobComplete(data) {
  const { jobId, totalCost, logPublicKey } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  jobStatus = JOB_STATUS.COMPLETE
  stopPaymentStream()
  stopWatchdog()

  log(`JOB_COMPLETE totalCost=$${totalCost.toFixed(6)} totalPaid=$${totalPaid.toFixed(6)}`)

  console.clear()
  console.log('╔════════════════════════════════════════════════╗')
  console.log('║             JOB COMPLETED                      ║')
  console.log('╚════════════════════════════════════════════════╝')
  console.log(`  Job ID      : ${jobId}`)
  console.log(`  Total cost  : $${totalCost.toFixed(6)} USDT`)
  console.log(`  Total paid  : $${totalPaid.toFixed(6)} USDT`)
  console.log(`  Log key     : ${logPublicKey}`)
  console.log('  (Verify execution on the Hypercore tamper-evident log)')
  console.log('')
}

// ─── JOB_FAILED ──────────────────────────────────────────────────────────────
function handleJobFailed(data) {
  const { jobId, reason } = data
  if (!currentJob || currentJob.jobId !== jobId) return

  log(`JOB_FAILED: ${reason} — attempting failover`)
  stopPaymentStream()
  stopWatchdog()
  currentJob.failedPeers.add(currentJob.peerId)
  jobStatus = JOB_STATUS.PENDING
  findAndSubmitJob()
}

// ─── Payment stream ───────────────────────────────────────────────────────────
function startPaymentStream(peerId) {
  payTimer = setInterval(() => {
    if (jobStatus !== JOB_STATUS.RUNNING) return
    const provider = providers.get(peerId)
    if (!provider) return

    const tickAmount = (JOB.cores * 0.001 + JOB.ramGB * 0.0005) * (PAYMENT_INTERVAL / 60_000)
    totalPaid += tickAmount
    tickIndex += 1

    // Budget exhaustion checks
    const remaining = JOB.maxBudgetUSDT - totalPaid
    if (remaining < JOB.maxBudgetUSDT * 0.1) {
      log(`⚠  Approaching budget limit ($${remaining.toFixed(6)} remaining)`)
    }
    if (totalPaid >= JOB.maxBudgetUSDT) {
      log('Budget exhausted — job cancelled')
      provider.send(makeMsg(MSG.CANCEL_JOB, { jobId: currentJob.jobId }))
      jobStatus = JOB_STATUS.CANCELLED
      stopPaymentStream()
      stopWatchdog()
      return
    }

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

// ─── Watchdog ─────────────────────────────────────────────────────────────────
function startWatchdog() {
  lastHeartbeatAt = Date.now()
  watchdogTimer   = setInterval(() => {
    if (!lastHeartbeatAt || jobStatus !== JOB_STATUS.RUNNING) return
    const silence = Date.now() - lastHeartbeatAt
    if (silence > WATCHDOG_TIMEOUT) {
      log(`⚠  WATCHDOG: no heartbeat for ${(silence / 1000).toFixed(0)}s — failing over`)
      stopPaymentStream()
      stopWatchdog()
      currentJob.failedPeers.add(currentJob.peerId)
      jobStatus = JOB_STATUS.PENDING
      findAndSubmitJob()
    }
  }, 1_000)
}

function resetWatchdog() {
  lastHeartbeatAt = Date.now()
  if (!payTimer && jobStatus === JOB_STATUS.RUNNING && currentJob?.peerId) {
    log('Heartbeat resumed — restarting payment stream')
    startPaymentStream(currentJob.peerId)
  }
}

function stopWatchdog() {
  clearInterval(watchdogTimer)
  watchdogTimer = null
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function progressBar(current, total, width = 16) {
  const filled = total > 0 ? Math.min(width, Math.round((current / total) * width)) : 0
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

function statusBadge(s) {
  const map = {
    [JOB_STATUS.PENDING]:   '○ pending',
    [JOB_STATUS.MATCHED]:   '◎ matched',
    [JOB_STATUS.RUNNING]:   '● running',
    [JOB_STATUS.COMPLETE]:  '✓ complete',
    [JOB_STATUS.FAILED]:    '✗ failed',
    [JOB_STATUS.CANCELLED]: '⊘ cancelled',
  }
  return map[s] ?? s
}

function fmtSince(ts) {
  if (!ts) return 'none'
  return `${Math.round((Date.now() - ts) / 1000)}s ago`
}

// ─── Terminal UI (2s refresh) ─────────────────────────────────────────────────
function renderUI() {
  if (jobStatus === JOB_STATUS.COMPLETE || jobStatus === JOB_STATUS.CANCELLED) return

  console.clear()
  console.log('╔══════════════════════════════════════════════════╗')
  console.log('║          HARVEST  —  REQUESTER  NODE             ║')
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`  Requester ID : ${SELF_ID}`)
  console.log(`  Providers    : ${providers.size} available`)
  console.log(`  Budget       : $${JOB.maxBudgetUSDT.toFixed(4)} USDT`)
  console.log('')

  // ── Active job panel ──────────────────────────────────────────────────────
  console.log('─── Active Job ─────────────────────────────────────')
  if (currentJob?.peerId) {
    const bar = progressBar(progressCurrent, progressTotal)
    const remaining = JOB.maxBudgetUSDT - totalPaid
    console.log(`  Job ID    : ${JOB.jobId.slice(0, 16)}…`)
    console.log(`  Provider  : ${currentJob.providerId} (score: ${currentJob.score?.toFixed(1) ?? '?'}, rep: ${currentJob.rep ?? 0} jobs)`)
    console.log(`  Status    : ${statusBadge(jobStatus)}`)
    console.log(`  Heartbeat : ${heartbeatCount} received  (last: ${fmtSince(lastHeartbeatAt)})`)
    console.log(`  Spent     : $${totalPaid.toFixed(6)} / $${JOB.maxBudgetUSDT.toFixed(4)} USDT`)
    console.log(`  Progress  : ${bar}  ${progressCurrent}/${progressTotal}`)
    if (lastProgressLine) {
      console.log(`  Last data : ${lastProgressLine.slice(0, 64)}`)
    }
  } else {
    console.log(`  Job ID    : ${JOB.jobId.slice(0, 16)}…`)
    console.log(`  Status    : ${statusBadge(jobStatus)}`)
    console.log(`  Type      : ${JOB.jobType}  ${JOB.cores} cores · ${JOB.ramGB} GB RAM`)
    console.log(`  Budget    : $${JOB.maxBudgetUSDT.toFixed(4)} USDT`)
  }
  console.log('')

  // ── Last 5 log lines ──────────────────────────────────────────────────────
  console.log('─── Last 5 log lines ───────────────────────────────')
  for (const line of logLines.slice(-5)) {
    console.log(`  ${line}`)
  }
  console.log('')

  // ── Provider market ───────────────────────────────────────────────────────
  console.log('─── Provider Market ────────────────────────────────')
  const sorted = [...providers.entries()]
    .filter(([, p]) => p.advertise)
    .map(([peerId, p]) => ({ peerId, score: scoreProvider(p.advertise), ...p.advertise }))
    .sort((a, b) => b.score - a.score)

  if (sorted.length === 0) {
    console.log('  (scanning for providers…)')
  }
  for (let i = 0; i < sorted.length; i++) {
    const p      = sorted[i]
    const active = currentJob?.peerId === p.peerId ? '  ← active' : ''
    const score  = p.score >= 0 ? `score:${p.score.toFixed(1)}` : 'unavailable'
    console.log(`  ${i + 1}. ${p.peerId}  ${p.cores} cores  $${p.pricePerCorePerMin}/min  rep:${p.completedJobs ?? 0}  ${score}${active}`)
  }
}

setInterval(renderUI, 2_000)
renderUI()

// ─── Graceful shutdown ────────────────────────────────────────────────────────
teardown(async () => {
  clearTimeout(failoverTimer)
  stopPaymentStream()
  stopWatchdog()
  await swarm.destroy()
  await store.close()
})
