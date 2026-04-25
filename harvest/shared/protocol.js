/**
 * shared/protocol.js — Harvest compute marketplace message contract
 * All MSG types, JOB_STATUS values, constants, and message helpers.
 * Every node imports from here — change nothing without team sign-off.
 */

// ─── Message types ────────────────────────────────────────────────────────────
export const MSG = Object.freeze({
  // Provider → swarm / requester
  ADVERTISE:    'ADVERTISE',    // broadcast capacity + price on connect
  HEARTBEAT:    'HEARTBEAT',    // signed proof-of-liveness every 5 s
  JOB_COMPLETE: 'JOB_COMPLETE', // job done, output, log key
  JOB_FAILED:   'JOB_FAILED',   // job crashed, reason
  JOB_ACCEPT:   'JOB_ACCEPT',   // confirmed, estimated cost
  JOB_REJECT:   'JOB_REJECT',   // too busy or budget mismatch
  JOB_PROGRESS: 'JOB_PROGRESS', // live stdout line from subprocess

  // Requester → provider
  JOB_REQUEST:   'JOB_REQUEST',   // submit a job
  PAYMENT_TICK:  'PAYMENT_TICK',  // USDT stub payment for this interval
  CANCEL_JOB:    'CANCEL_JOB',    // abort the job

  // Requester → provider — payment channel lifecycle
  CHANNEL_OPEN:  'CHANNEL_OPEN',  // payment channel opened on job accept
  CHANNEL_PAUSE: 'CHANNEL_PAUSE', // payment paused (watchdog / failover)
  CHANNEL_CLOSE: 'CHANNEL_CLOSE', // final settlement on job complete
})

// ─── Job lifecycle states ──────────────────────────────────────────────────────
export const JOB_STATUS = Object.freeze({
  PENDING:   'pending',
  MATCHED:   'matched',
  RUNNING:   'running',
  COMPLETE:  'complete',
  FAILED:    'failed',
  CANCELLED: 'cancelled',
})

// ─── Timing constants ──────────────────────────────────────────────────────────
export const HEARTBEAT_INTERVAL = 5_000   // ms — provider → requester keepalive
export const PAYMENT_INTERVAL   = 10_000  // ms — requester → provider payment tick

// ─── DHT topic ─────────────────────────────────────────────────────────────────
// Both nodes hash this string to get the 32-byte Hyperswarm topic buffer.
export const HARVEST_TOPIC = 'harvest-compute-marketplace-v1'

// ─── Message factories ─────────────────────────────────────────────────────────

/**
 * Wrap any payload in a typed, timestamped envelope.
 * @param {string} type  - one of MSG.*
 * @param {object} payload
 * @returns {object}
 */
export function makeMsg(msgType, payload = {}) {
  // Spread payload first, then stamp type/ts so payload can never clobber them.
  return { ...payload, type: msgType, ts: Date.now() }
}

/**
 * Encode a message to a Buffer (UTF-8 JSON).
 * Used by the Protomux raw-encoding path.
 */
export function encode(msg) {
  return Buffer.from(JSON.stringify(msg))
}

/**
 * Decode a Buffer / Uint8Array back to a message object.
 */
export function decode(buf) {
  return JSON.parse(buf.toString())
}

// ─── Schema docs (for teammates) ──────────────────────────────────────────────
/**
 * ADVERTISE   { providerId, publicKey, cores, ramGB,
 *               pricePerCorePerMin, pricePerGBPerMin, maxJobs, activeJobs }
 *
 * JOB_REQUEST { jobId, description, type, cores, ramGB,
 *               estimatedMinutes, maxBudgetUSDT }
 *
 * JOB_ACCEPT  { jobId, estimatedCost, providerId, logPublicKey }
 * JOB_REJECT  { jobId, reason }
 *
 * HEARTBEAT   { jobId, providerId, seq, cpuPct, memPct }
 * JOB_PROGRESS{ jobId, data: { epoch, total, loss, accuracy } }
 *
 * JOB_COMPLETE{ jobId, totalCost, logPublicKey }
 * JOB_FAILED  { jobId, reason }
 *
 * PAYMENT_TICK  { jobId, amount, tickIndex, totalPaid }
 * CANCEL_JOB    { jobId }
 *
 * CHANNEL_OPEN  { jobId, ts }
 * CHANNEL_PAUSE { jobId, totalPaid }
 * CHANNEL_CLOSE { jobId, totalPaid, finalAmount }
 */
