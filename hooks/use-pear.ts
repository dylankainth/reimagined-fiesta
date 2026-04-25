import { useCallback, useState } from 'react'

export interface PeerInfo {
  peerId: string
  connected: boolean
}

export function usePear() {
  const [state] = useState({
    ready: true,
    currentTopic: null as string | null,
    peers: [] as PeerInfo[],
    error: null as string | null,
  })

  const [peers, setPeers] = useState<PeerInfo[]>([])
  const [currentTopic, setCurrentTopic] = useState<string | null>(null)

  const joinTopic = useCallback((topic: string) => {
    setCurrentTopic(topic)
    const mockPeerId1 = 'peer-' + Math.random().toString(36).slice(2, 8)
    const mockPeerId2 = 'peer-' + Math.random().toString(36).slice(2, 8)
    setPeers([
      { peerId: mockPeerId1, connected: true },
      { peerId: mockPeerId2, connected: true },
    ])
  }, [])

  const leaveTopic = useCallback(() => {
    setCurrentTopic(null)
    setPeers([])
  }, [])

  const sendToPeer = useCallback((peerId: string, message: unknown) => {
    console.log('Sending to peer', peerId, message)
  }, [])

  return {
    ready: true,
    currentTopic,
    peers,
    error: null,
    joinTopic,
    leaveTopic,
    sendToPeer,
  }
}
