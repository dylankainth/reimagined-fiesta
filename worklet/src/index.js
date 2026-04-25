'use strict'

const { IPC } = BareKit
const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

let identity = null
let swarm = null

function send(type, data) {
  IPC.write(Buffer.from(JSON.stringify({ type, data: data || null })))
}

IPC.on('data', (raw) => {
  let msg
  try { msg = JSON.parse(raw.toString()) } catch { return }
  const { type, data } = msg

  if (type === 'CREATE_IDENTITY') return createIdentity(data)
  if (type === 'LOAD_IDENTITY') return (identity = data, send('IDENTITY_LOADED', identity))
  if (type === 'START_SESSION') return startSession()
  if (type === 'JOIN_SESSION') return joinSession(data.topic)
  if (type === 'END_SESSION') return endSession()
})

function createIdentity({ name, dob }) {
  const keyPair = crypto.keyPair()

  const payload = {
    name,
    dob,
    publicKey: b4a.toString(keyPair.publicKey, 'hex'),
    issuedAt: new Date().toISOString(),
    v: 1,
  }

  const sig = crypto.sign(Buffer.from(JSON.stringify(payload)), keyPair.secretKey)

  identity = {
    ...payload,
    signature: b4a.toString(sig, 'hex'),
    privateKey: b4a.toString(keyPair.secretKey, 'hex'),
  }

  send('IDENTITY_CREATED', identity)
}

async function startSession() {
  await endSession()

  const topic = crypto.randomBytes(32)
  swarm = new Hyperswarm()

  swarm.on('connection', (conn) => {
    const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
    send('PEER_CONNECTED', { peerId })

    if (identity) {
      const { name, dob, publicKey, signature, issuedAt, v } = identity
      conn.write(Buffer.from(JSON.stringify({ type: 'ID_DATA', data: { name, dob, publicKey, signature, issuedAt, v } })))
    }

    conn.on('data', (d) => {
      try {
        const m = JSON.parse(d.toString())
        if (m.type === 'ACK_VERIFIED') send('IDENTITY_VERIFIED', { peerId })
      } catch {}
    })

    conn.on('close', () => send('PEER_DISCONNECTED', { peerId }))
    conn.on('error', () => {})
  })

  await swarm.join(topic, { server: true, client: false }).flushed()
  send('SESSION_STARTED', { topic: b4a.toString(topic, 'hex') })
}

async function joinSession(topicHex) {
  await endSession()

  const topic = b4a.from(topicHex, 'hex')
  swarm = new Hyperswarm()

  swarm.on('connection', (conn) => {
    const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, 16)
    send('PEER_CONNECTED', { peerId })

    conn.on('data', (raw) => {
      try {
        const m = JSON.parse(raw.toString())
        if (m.type !== 'ID_DATA') return

        const received = m.data
        const verifyPayload = { name: received.name, dob: received.dob, publicKey: received.publicKey, issuedAt: received.issuedAt, v: received.v }
        const valid = crypto.verify(
          Buffer.from(JSON.stringify(verifyPayload)),
          b4a.from(received.signature, 'hex'),
          b4a.from(received.publicKey, 'hex')
        )

        conn.write(Buffer.from(JSON.stringify({ type: 'ACK_VERIFIED' })))
        send('ID_RECEIVED', { identity: received, valid, verifiedAt: new Date().toISOString() })
      } catch (e) {
        send('ERROR', { message: e.message })
      }
    })

    conn.on('close', () => send('PEER_DISCONNECTED', { peerId }))
    conn.on('error', () => {})
  })

  swarm.join(topic, { server: false, client: true })
  send('SESSION_JOINED', { topic: topicHex })
}

async function endSession() {
  if (!swarm) return
  await swarm.destroy()
  swarm = null
  send('SESSION_ENDED', null)
}

Bare.on('exit', () => { if (swarm) swarm.destroy() })

send('READY', null)
