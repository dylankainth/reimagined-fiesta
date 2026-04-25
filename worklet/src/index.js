'use strict'

const { IPC } = BareKit
const Hyperswarm = require('hyperswarm')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')

const PEER_ID_LENGTH = 16

let identity = null
let swarm = null

function send(type, data) {
  IPC.write(Buffer.from(JSON.stringify({ type, data: data || null })))
}

IPC.on('data', (raw) => {
  let msg
  try {
    msg = JSON.parse(raw.toString())
  } catch (err) {
    return send('ERROR', { message: 'Invalid IPC message: ' + err.message })
  }
  const { type, data } = msg

  if (type === 'CREATE_IDENTITY') return createIdentity(data)
  if (type === 'LOAD_IDENTITY') {
    identity = data
    return send('IDENTITY_LOADED', identity)
  }
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

  const payloadBuf = Buffer.from(JSON.stringify(payload))
  const sig = crypto.sign(payloadBuf, keyPair.secretKey)

  identity = {
    ...payload,
    signature: b4a.toString(sig, 'hex'),
    _privateKey: b4a.toString(keyPair.secretKey, 'hex'),
  }

  const publicIdentity = { ...payload, signature: identity.signature }
  send('IDENTITY_CREATED', publicIdentity)
}

async function startSession() {
  await endSession()

  try {
    const topic = crypto.randomBytes(32)
    swarm = new Hyperswarm()

    swarm.on('connection', (conn) => {
      const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, PEER_ID_LENGTH)
      send('PEER_CONNECTED', { peerId })

      if (identity) {
        const { name, dob, publicKey, signature, issuedAt, v } = identity
        const idPayload = JSON.stringify({ type: 'ID_DATA', data: { name, dob, publicKey, signature, issuedAt, v } })
        conn.write(Buffer.from(idPayload))
      }

      const onData = (d) => {
        try {
          const m = JSON.parse(d.toString())
          if (m.type === 'ACK_VERIFIED') send('IDENTITY_VERIFIED', { peerId })
        } catch (err) {
          send('ERROR', { message: 'Failed to parse peer message: ' + err.message })
        }
      }

      const onClose = () => {
        conn.removeListener('data', onData)
        send('PEER_DISCONNECTED', { peerId })
      }

      const onError = (err) => {
        send('ERROR', { message: 'Connection error: ' + err.message })
      }

      conn.on('data', onData)
      conn.on('close', onClose)
      conn.on('error', onError)
    })

    await swarm.join(topic, { server: true, client: false }).flushed()
    send('SESSION_STARTED', { topic: b4a.toString(topic, 'hex') })
  } catch (err) {
    send('ERROR', { message: 'Failed to start session: ' + err.message })
  }
}

async function joinSession(topicHex) {
  await endSession()

  try {
    const topic = b4a.from(topicHex, 'hex')
    swarm = new Hyperswarm()

    swarm.on('connection', (conn) => {
      const peerId = b4a.toString(conn.remotePublicKey, 'hex').slice(0, PEER_ID_LENGTH)
      send('PEER_CONNECTED', { peerId })

      const onData = (raw) => {
        try {
          const m = JSON.parse(raw.toString())
          if (m.type !== 'ID_DATA') return

          const received = m.data

          const verifyPayload = { name: received.name, dob: received.dob, publicKey: received.publicKey, issuedAt: received.issuedAt, v: received.v }
          const verifyBuf = Buffer.from(JSON.stringify(verifyPayload))
          const sigBuf = b4a.from(received.signature, 'hex')
          const pubKeyBuf = b4a.from(received.publicKey, 'hex')

          let valid = false
          try {
            valid = crypto.verify(verifyBuf, sigBuf, pubKeyBuf)
          } catch {
            valid = false
          }

          conn.write(Buffer.from(JSON.stringify({ type: 'ACK_VERIFIED' })))
          send('ID_RECEIVED', { identity: received, valid, verifiedAt: new Date().toISOString() })
        } catch (err) {
          send('ERROR', { message: 'Failed to process ID_DATA: ' + err.message })
        }
      }

      const onClose = () => {
        conn.removeListener('data', onData)
        send('PEER_DISCONNECTED', { peerId })
      }

      const onError = (err) => {
        send('ERROR', { message: 'Connection error: ' + err.message })
      }

      conn.on('data', onData)
      conn.on('close', onClose)
      conn.on('error', onError)
    })

    await swarm.join(topic, { server: false, client: true }).flushed()
    send('SESSION_JOINED', { topic: topicHex })
  } catch (err) {
    send('ERROR', { message: 'Failed to join session: ' + err.message })
  }
}

async function endSession() {
  if (!swarm) return
  try {
    await swarm.destroy()
  } catch (err) {
    send('ERROR', { message: 'Failed to destroy swarm: ' + err.message })
  }
  swarm = null
  send('SESSION_ENDED', null)
}

Bare.on('exit', async () => {
  if (swarm) {
    try {
      await swarm.destroy()
    } catch (err) {
      console.error('Cleanup error:', err)
    }
  }
})

send('READY', null)
