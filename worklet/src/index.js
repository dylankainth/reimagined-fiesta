const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')

const swarm = new Hyperswarm()
const peers = new Map()
let discoveryKey = null

const { IPC } = BareKit

const send = (type, data) => {
  IPC.write(b4a.from(JSON.stringify({ type, data })))
}

IPC.on('data', (raw) => {
  let msg
  try {
    msg = JSON.parse(b4a.toString(raw))
  } catch {
    return
  }

  const { type, data } = msg

  switch (type) {
    case 'JOIN_TOPIC': {
      if (!data.topic) return
      discoveryKey = data.topic
      joinTopic(data.topic)
      break
    }
    case 'LEAVE_TOPIC': {
      if (discoveryKey) {
        swarm.leave(discoveryKey)
        discoveryKey = null
        peers.clear()
        send('TOPIC_LEFT', {})
      }
      break
    }
    case 'SEND_TO_PEER': {
      const { peerId, message } = data
      const peer = peers.get(peerId)
      if (peer && peer.connection) {
        peer.connection.write(b4a.from(JSON.stringify(message)))
      }
      break
    }
  }
})

function joinTopic(topic) {
  const topicBuf = Buffer.from(topic, 'hex')

  const discovery = swarm.join(topicBuf, { server: true, client: true })

  discovery.on('connection', (socket) => {
    const peerId = socket.remotePublicKey.toString('hex').slice(0, 12)
    peers.set(peerId, { connection: socket })

    send('PEER_CONNECTED', { peerId })

    socket.on('data', (raw) => {
      try {
        const msg = JSON.parse(b4a.toString(raw))
        send('PEER_MESSAGE', { peerId, message: msg })
      } catch {
        // Invalid JSON from peer
      }
    })

    socket.on('end', () => {
      peers.delete(peerId)
      send('PEER_DISCONNECTED', { peerId })
    })

    socket.on('error', () => {
      peers.delete(peerId)
    })
  })

  discovery.on('close', () => {
    peers.clear()
  })

  send('TOPIC_JOINED', { topic, discoveryKey: topicBuf.toString('hex') })
}

swarm.on('error', (err) => {
  send('ERROR', { message: err.message })
})

send('READY', {})
