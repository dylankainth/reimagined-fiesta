import { useEffect, useRef, useState, useCallback } from 'react'
import { AppState } from 'react-native'
import { Worklet } from 'react-native-bare-kit'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const b4a = require('b4a') as { from: (s: string) => Uint8Array; toString: (b: Uint8Array) => string }

export interface DigitalID {
  name: string
  dob: string
  publicKey: string
  signature: string
  issuedAt: string
  privateKey?: string
  v: number
}

export interface VerificationResult {
  identity: DigitalID
  valid: boolean
  verifiedAt: string
}

interface WorkletState {
  ready: boolean
  identity: DigitalID | null
  sessionTopic: string | null
  sessionRole: 'holder' | 'verifier' | null
  peerConnected: boolean
  peerId: string | null
  verification: VerificationResult | null
  identityVerified: boolean
  error: string | null
}

const workletSource = require('../worklet/bundle.js')

export function useBareWorklet() {
  const workletRef = useRef<Worklet | null>(null)
  const [state, setState] = useState<WorkletState>({
    ready: false,
    identity: null,
    sessionTopic: null,
    sessionRole: null,
    peerConnected: false,
    peerId: null,
    verification: null,
    identityVerified: false,
    error: null,
  })

  const send = useCallback((type: string, data?: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(workletRef.current?.IPC as any)?.write(b4a.from(JSON.stringify({ type, data: data ?? null })))
  }, [])

  useEffect(() => {
    const worklet = new Worklet()
    workletRef.current = worklet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(worklet.IPC as any).on('data', (raw: Uint8Array) => {
      let msg: { type: string; data: unknown }
      try { msg = JSON.parse(b4a.toString(raw)) } catch { return }
      const { type, data } = msg as { type: string; data: Record<string, unknown> }

      switch (type) {
        case 'READY':
          setState(s => ({ ...s, ready: true }))
          break
        case 'IDENTITY_CREATED':
        case 'IDENTITY_LOADED':
          setState(s => ({ ...s, identity: data as unknown as DigitalID }))
          break
        case 'SESSION_STARTED':
          setState(s => ({ ...s, sessionTopic: (data as { topic: string }).topic, sessionRole: 'holder' }))
          break
        case 'SESSION_JOINED':
          setState(s => ({ ...s, sessionRole: 'verifier' }))
          break
        case 'PEER_CONNECTED':
          setState(s => ({ ...s, peerConnected: true, peerId: (data as { peerId: string }).peerId }))
          break
        case 'PEER_DISCONNECTED':
          setState(s => ({ ...s, peerConnected: false, peerId: null }))
          break
        case 'IDENTITY_VERIFIED':
          setState(s => ({ ...s, identityVerified: true }))
          break
        case 'ID_RECEIVED':
          setState(s => ({ ...s, verification: data as unknown as VerificationResult }))
          break
        case 'SESSION_ENDED':
          setState(s => ({ ...s, sessionTopic: null, sessionRole: null, peerConnected: false, peerId: null, identityVerified: false }))
          break
        case 'ERROR':
          setState(s => ({ ...s, error: (data as { message: string }).message }))
          break
      }
    })

    worklet.start('/app.bundle', workletSource)

    const sub = AppState.addEventListener('change', (status) => worklet.update(status))
    return () => {
      sub.remove()
      worklet.terminate()
    }
  }, [])

  const createIdentity = useCallback((name: string, dob: string) => {
    send('CREATE_IDENTITY', { name, dob })
  }, [send])

  const loadIdentity = useCallback((id: DigitalID) => {
    send('LOAD_IDENTITY', id)
  }, [send])

  const startSession = useCallback(() => {
    setState(s => ({ ...s, identityVerified: false }))
    send('START_SESSION')
  }, [send])

  const joinSession = useCallback((topic: string) => {
    setState(s => ({ ...s, verification: null }))
    send('JOIN_SESSION', { topic })
  }, [send])

  const endSession = useCallback(() => {
    send('END_SESSION')
  }, [send])

  const clearError = useCallback(() => setState(s => ({ ...s, error: null })), [])

  return { ...state, createIdentity, loadIdentity, startSession, joinSession, endSession, clearError }
}
