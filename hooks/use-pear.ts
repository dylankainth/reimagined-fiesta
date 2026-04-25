import { useEffect, useRef, useState, useCallback } from 'react'
import { Worklet } from 'react-native-bare-kit'
import b4a from 'b4a'

const WORKLET_SOURCE = `
try {
  const b4a = require('b4a')
  const peers = new Map()
  let discoveryKey = null
  let swarm = null

  const send = (type, data) => {
    try {
      const msg = JSON.stringify({ type, data })
      const buf = b4a.from(msg)
      if (BareKit && BareKit.IPC) {
        BareKit.IPC.write(buf)
      }
    } catch (err) {
      console.error('Send error:', err)
    }
  }

  // Try to initialize Hyperswarm, fall back to mock if it fails
  try {
    const Hyperswarm = require('hyperswarm')
    swarm = new Hyperswarm()

    swarm.on('error', (err) => {
      send('ERROR', { message: 'Swarm error: ' + err.message })
    })
  } catch (err) {
    console.warn('Hyperswarm not available, using mock mode:', err.message)
    send('WARNING', { message: 'Running in mock mode - Hyperswarm unavailable' })
  }

  BareKit.IPC.on('data', (raw) => {
    try {
      const msg = JSON.parse(b4a.toString(raw))
      const { type, data } = msg

      switch (type) {
        case 'JOIN_TOPIC': {
          if (!data || !data.topic) return
          try {
            if (swarm) {
              const topicBuf = Buffer.from(data.topic, 'hex')
              discoveryKey = topicBuf
              const discovery = swarm.join(topicBuf, { server: true, client: true })

              discovery.on('connection', (socket) => {
                const peerId = b4a.toString(socket.remotePublicKey, 'hex').slice(0, 12)
                peers.set(peerId, { socket, id: peerId })
                send('PEER_CONNECTED', { peerId })

                socket.on('data', (raw) => {
                  try {
                    const msg = JSON.parse(b4a.toString(raw))
                    send('PEER_MESSAGE', { peerId, message: msg })
                  } catch (e) {}
                })

                socket.on('end', () => {
                  peers.delete(peerId)
                  send('PEER_DISCONNECTED', { peerId })
                })

                socket.on('error', () => {
                  peers.delete(peerId)
                })
              })

              send('TOPIC_JOINED', { topic: data.topic })
              send('MODE', { mode: 'REAL_PEAR' })
            } else {
              // Mock mode - simulate peer
              console.log('Running in MOCK mode - Hyperswarm not available')
              const mockPeerId = 'mock-peer-' + Math.random().toString(36).slice(2, 8)
              peers.set(mockPeerId, { id: mockPeerId })
              send('TOPIC_JOINED', { topic: data.topic })
              send('PEER_CONNECTED', { peerId: mockPeerId })
              send('MODE', { mode: 'MOCK' })
            }
          } catch (err) {
            send('ERROR', { message: 'Join error: ' + err.message })
          }
          break
        }

        case 'LEAVE_TOPIC': {
          try {
            if (swarm && discoveryKey) {
              swarm.leave(discoveryKey)
            }
            discoveryKey = null
            peers.clear()
            send('TOPIC_LEFT', {})
          } catch (err) {
            send('ERROR', { message: 'Leave error: ' + err.message })
          }
          break
        }

        case 'SEND_TO_PEER': {
          try {
            const { peerId, message } = data
            const peer = peers.get(peerId)
            if (peer && peer.socket) {
              peer.socket.write(b4a.from(JSON.stringify(message)))
            }
          } catch (err) {
            send('ERROR', { message: 'Send error: ' + err.message })
          }
          break
        }
      }
    } catch (err) {
      console.error('IPC handler error:', err)
      send('ERROR', { message: 'Handler error: ' + err.message })
    }
  })

  send('READY', {})
} catch (err) {
  console.error('Worklet init failed:', err)
}
`

export interface PeerInfo {
  peerId: string
  connected: boolean
}

interface PearState {
  ready: boolean
  currentTopic: string | null
  peers: Map<string, PeerInfo>
  error: string | null
}

export type MessageHandler = (peerId: string, message: unknown) => void

export function usePear() {
  const workletRef = useRef<Worklet | null>(null)
  const messageHandlerRef = useRef<MessageHandler | null>(null)
  const [state, setState] = useState<PearState>({
    ready: false,
    currentTopic: null,
    peers: new Map(),
    error: null,
  })

  const send = useCallback((type: string, data?: unknown) => {
    if (!workletRef.current) return
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(workletRef.current as any).IPC?.write(
        b4a.from(JSON.stringify({ type, data: data ?? null }))
      )
    } catch (err) {
      console.error('Failed to send to worklet:', err)
    }
  }, [])

  useEffect(() => {
    const initializeWorklet = async () => {
      try {
        const worklet = new Worklet()
        workletRef.current = worklet

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ipc = (worklet as any).IPC
        if (!ipc) {
          console.error('IPC not available')
          setState((s) => ({ ...s, error: 'IPC initialization failed', ready: true }))
          return
        }

        ipc.on('data', (raw: Uint8Array) => {
          try {
            const msg = JSON.parse(b4a.toString(raw))
            const { type, data } = msg as { type: string; data: Record<string, unknown> }

            switch (type) {
              case 'READY':
                setState((s) => ({ ...s, ready: true }))
                break

              case 'TOPIC_JOINED':
                setState((s) => ({
                  ...s,
                  currentTopic: (data as { topic: string }).topic,
                  peers: new Map(),
                }))
                break

              case 'TOPIC_LEFT':
                setState((s) => ({
                  ...s,
                  currentTopic: null,
                  peers: new Map(),
                }))
                break

              case 'PEER_CONNECTED': {
                const peerId = (data as { peerId: string }).peerId
                setState((s) => {
                  const newPeers = new Map(s.peers)
                  newPeers.set(peerId, { peerId, connected: true })
                  return { ...s, peers: newPeers }
                })
                break
              }

              case 'PEER_DISCONNECTED': {
                const peerId = (data as { peerId: string }).peerId
                setState((s) => {
                  const newPeers = new Map(s.peers)
                  newPeers.delete(peerId)
                  return { ...s, peers: newPeers }
                })
                break
              }

              case 'PEER_MESSAGE': {
                const { peerId, message } = data as {
                  peerId: string
                  message: unknown
                }
                console.log('Message from peer:', peerId, message)
                if (messageHandlerRef.current) {
                  messageHandlerRef.current(peerId, message)
                }
                break
              }

              case 'ERROR':
              case 'WARNING':
                setState((s) => ({ ...s, error: (data as { message: string }).message }))
                break

              case 'MODE':
                console.log('Pear mode:', (data as { mode: string }).mode)
                break
            }
          } catch (err) {
            console.error('IPC message parse error:', err)
          }
        })

        console.log('Starting worklet...')
        worklet.start('/app.js', WORKLET_SOURCE)
        console.log('Worklet started')
      } catch (err) {
        console.error('Worklet initialization error:', err)
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : 'Worklet failed to initialize',
          ready: true,
        }))
      }
    }

    initializeWorklet()

    return () => {
      try {
        if (workletRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(workletRef.current as any).terminate?.()
        }
      } catch (err) {
        console.error('Worklet termination error:', err)
      }
    }
  }, [])

  const joinTopic = useCallback(
    (topic: string) => {
      send('JOIN_TOPIC', { topic })
    },
    [send]
  )

  const leaveTopic = useCallback(() => {
    send('LEAVE_TOPIC')
  }, [send])

  const sendToPeer = useCallback(
    (peerId: string, message: unknown) => {
      send('SEND_TO_PEER', { peerId, message })
    },
    [send]
  )

  const onMessage = useCallback((handler: MessageHandler) => {
    messageHandlerRef.current = handler
  }, [])

  return {
    ready: state.ready,
    currentTopic: state.currentTopic,
    peers: Array.from(state.peers.values()),
    error: state.error,
    joinTopic,
    leaveTopic,
    sendToPeer,
    onMessage,
  }
}
