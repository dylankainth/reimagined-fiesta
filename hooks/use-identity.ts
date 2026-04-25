import { useState, useEffect, useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { generateKeypair, SignedCredential } from '@/lib/crypto'

export interface Identity {
  name: string
  dob: string
  publicKey: string
  secretKey: string
  createdAt: string
}

export interface StoredCredential {
  identityId: string
  credential: SignedCredential
  receivedAt: string
}

const STORAGE_KEY = 'identity_v1'
const CREDENTIALS_KEY = 'credentials_v1'

export function useIdentity() {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [credentials, setCredentials] = useState<StoredCredential[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadIdentity()
    loadCredentials()
  }, [])

  const loadIdentity = async () => {
    try {
      setLoading(true)
      const stored = await AsyncStorage.getItem(STORAGE_KEY)
      if (stored) {
        setIdentity(JSON.parse(stored))
        console.log('Identity loaded')
      }
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load identity')
    } finally {
      setLoading(false)
    }
  }

  const loadCredentials = async () => {
    try {
      const stored = await AsyncStorage.getItem(CREDENTIALS_KEY)
      if (stored) {
        setCredentials(JSON.parse(stored))
        console.log('Credentials loaded')
      }
    } catch (err) {
      console.error('Failed to load credentials:', err)
    }
  }

  const createIdentity = useCallback(
    async (name: string, dob: string) => {
      try {
        setError(null)
        if (!name.trim()) throw new Error('Name is required')
        if (!dob.trim()) throw new Error('Date of birth is required')
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          throw new Error('Date must be in YYYY-MM-DD format')
        }

        // Generate real ed25519 keypair
        const keypair = generateKeypair()
        console.log('Created real ed25519 keypair with tweetnacl')

        const newIdentity: Identity = {
          name: name.trim(),
          dob: dob.trim(),
          publicKey: keypair.publicKey,
          secretKey: keypair.secretKey,
          createdAt: new Date().toISOString(),
        }

        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newIdentity))
        setIdentity(newIdentity)
        console.log('Identity created:', newIdentity.name, '| Public Key:', newIdentity.publicKey.slice(0, 16) + '...')
        return newIdentity
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create identity'
        console.error('Identity creation error:', message)
        setError(message)
        throw err
      }
    },
    []
  )

  const deleteIdentity = useCallback(async () => {
    try {
      await AsyncStorage.removeItem(STORAGE_KEY)
      setIdentity(null)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete identity')
      throw err
    }
  }, [])

  const storeCredential = useCallback(
    async (credential: SignedCredential) => {
      try {
        if (!identity) throw new Error('No identity')
        const storedCredential: StoredCredential = {
          identityId: identity.publicKey,
          credential,
          receivedAt: new Date().toISOString(),
        }
        const updated = [...credentials, storedCredential]
        await AsyncStorage.setItem(CREDENTIALS_KEY, JSON.stringify(updated))
        setCredentials(updated)
        console.log('Credential stored')
        return storedCredential
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to store credential'
        setError(message)
        throw err
      }
    },
    [identity, credentials]
  )

  return {
    identity,
    credentials,
    loading,
    error,
    createIdentity,
    deleteIdentity,
    storeCredential,
  }
}
