import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Alert, TextInput, Dimensions, Image,
} from 'react-native'
import QRCode from 'qrcode'
import { useIdentity } from '@/hooks/use-identity'
import { usePear } from '@/hooks/use-pear'
import { useColorScheme } from '@/hooks/use-color-scheme'
import { encodeQRData, topicFromPublicKey } from '@/lib/qr'
import {
  createSignedCredential, verifyCredential, verifyNonceSignature,
  signNonce, generateNonce, hashCredential,
} from '@/lib/crypto'
import {
  createCredentialRequest, parseMessage, createCredentialIssuedMessage,
  createVerificationChallenge, createVerificationProof, createVerificationResult,
} from '@/lib/messaging'
import type { SignedCredential } from '@/lib/crypto'

type Role = null | 'holder' | 'issuer' | 'verifier'

const QR_SIZE = Math.min(Dimensions.get('window').width - 80, 300)

export default function IdentityScreen() {
  const dark = useColorScheme() === 'dark'
  const { identity, loading, error: identityError, createIdentity, deleteIdentity, credentials, storeCredential } = useIdentity()
  const pear = usePear()

  const [role, setRole] = useState<Role>(null)
  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [creating, setCreating] = useState(false)
  const [claimToIssue, setClaimToIssue] = useState('age_over_18')
  const [credentialStatus, setCredentialStatus] = useState<string | null>(null)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)
  const [verificationChallenge, setVerificationChallenge] = useState<string | null>(null)
  const [receivedCredentials, setReceivedCredentials] = useState<SignedCredential[]>([])
  const [issuerQRUri, setIssuerQRUri] = useState<string | null>(null)
  const [holderQRUri, setHolderQRUri] = useState<string | null>(null)
  const [verifierQRUri, setVerifierQRUri] = useState<string | null>(null)

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  // Generate QR code as data URI
  const generateQRUri = useCallback(async (data: string) => {
    try {
      const uri = await QRCode.toDataURL(data, { width: 300 })
      return uri
    } catch (err) {
      console.error('QR generation error:', err)
      return null
    }
  }, [])

  // Generate QR codes when role changes
  useEffect(() => {
    if (!identity) return
    if (role === 'issuer') {
      const issuerTopic = topicFromPublicKey(identity.publicKey)
      const qrData = encodeQRData({
        type: 'issuer',
        topic: issuerTopic,
        publicKey: identity.publicKey,
        timestamp: new Date().toISOString(),
      })
      generateQRUri(qrData).then(setIssuerQRUri)
    } else if (role === 'holder') {
      const holderTopic = topicFromPublicKey(identity.publicKey)
      const qrData = encodeQRData({
        type: 'holder',
        topic: holderTopic,
        publicKey: identity.publicKey,
        timestamp: new Date().toISOString(),
      })
      generateQRUri(qrData).then(setHolderQRUri)
    } else if (role === 'verifier') {
      const verifierTopic = 'verifier_' + Math.random().toString(36).slice(2, 10)
      const qrData = encodeQRData({
        type: 'verifier',
        topic: verifierTopic,
        timestamp: new Date().toISOString(),
      })
      generateQRUri(qrData).then(setVerifierQRUri)
    }
  }, [role, identity, generateQRUri])

  // Message handler for incoming P2P messages
  useEffect(() => {
    if (!identity || !pear.ready) return

    pear.onMessage((peerId: string, rawMessage: unknown) => {
      try {
        const msg = parseMessage(rawMessage)

        if (role === 'issuer' && msg.type === 'CREDENTIAL_REQUEST') {
          const req = msg.payload as { holderPublicKey: string; requestedClaim: string }
          setCredentialStatus(`Request from ${peerId.slice(0, 8)}...`)
          const credential = createSignedCredential(
            req.requestedClaim,
            identity.publicKey,
            identity.secretKey
          )
          const response = createCredentialIssuedMessage(credential, identity.publicKey)
          pear.sendToPeer(peerId, response)
          setCredentialStatus('✓ Credential issued')
        }

        if (role === 'holder' && msg.type === 'CREDENTIAL_ISSUED') {
          const cred = (msg.payload as { credential: SignedCredential }).credential
          if (verifyCredential(cred)) {
            storeCredential(cred)
            setReceivedCredentials([...receivedCredentials, cred])
            setCredentialStatus('✓ Credential received and verified')
          } else {
            setCredentialStatus('✗ Credential verification failed')
          }
        }

        if (role === 'verifier' && msg.type === 'VERIFICATION_PROOF') {
          const proof = msg.payload as {
            credential: SignedCredential
            holderPublicKey: string
            nonceSignature: string
            challenge: string
          }
          const isCredentialValid = verifyCredential(proof.credential)
          const isProofValid = verifyNonceSignature(
            proof.challenge,
            proof.nonceSignature,
            proof.holderPublicKey
          )
          const isValid = isCredentialValid && isProofValid
          const result = createVerificationResult(isValid, hashCredential(proof.credential))
          pear.sendToPeer(peerId, result)
          setVerificationStatus(isValid ? '✓ Credential verified' : '✗ Verification failed')
        }

        if (role === 'holder' && msg.type === 'VERIFICATION_CHALLENGE') {
          const challenge = (msg.payload as { nonce: string }).nonce
          setVerificationChallenge(challenge)
          if (receivedCredentials.length > 0) {
            const credential = receivedCredentials[0]
            const proofMsg = createVerificationProof(
              credential,
              identity.publicKey,
              identity.secretKey,
              challenge
            )
            pear.sendToPeer(peerId, proofMsg)
            setVerificationStatus('✓ Proof sent')
          }
        }

        if (msg.type === 'VERIFICATION_RESULT') {
          const result = msg.payload as { valid: boolean; reason?: string }
          setVerificationStatus(result.valid ? '✓ Verification passed' : '✗ Verification failed')
        }
      } catch (err) {
        console.error('Message handler error:', err)
      }
    })
  }, [role, identity, pear, credentials, receivedCredentials])

  // Create identity
  const handleCreateIdentity = useCallback(async () => {
    try {
      setCreating(true)
      await createIdentity(name, dob)
      setName('')
      setDob('')
    } catch (err) {
      Alert.alert('Error', err instanceof Error ? err.message : 'Failed')
    } finally {
      setCreating(false)
    }
  }, [name, dob, createIdentity])

  // ISSUER: Join topic to listen for requests
  const handleIssuerStart = useCallback(() => {
    if (!identity) return
    const topic = topicFromPublicKey(identity.publicKey)
    pear.joinTopic(topic)
    setCredentialStatus('Listening for requests...')
  }, [identity, pear])

  // HOLDER: Scan issuer QR (simulated - would use camera in real app)
  const handleHolderRequestCredential = useCallback(() => {
    if (!identity || !pear.currentTopic) return
    setCredentialStatus('Requesting credential...')
    const msg = createCredentialRequest(identity.publicKey)
    // Send to all connected peers on the issuer's topic
    pear.peers.forEach((peer) => {
      pear.sendToPeer(peer.peerId, msg)
    })
  }, [identity, pear])

  // VERIFIER: Generate discovery topic
  const handleVerifierStart = useCallback(() => {
    if (!pear.currentTopic) {
      setVerificationStatus('No verification topic active')
      return
    }
    setVerificationStatus('Waiting for credentials...')
    // When peers connect, send them a verification challenge
    pear.peers.forEach((peer) => {
      const challenge = createVerificationChallenge(hashCredential({
        claim: claimToIssue,
        issuerPublicKey: '',
        signature: '',
        timestamp: new Date().toISOString(),
      }))
      pear.sendToPeer(peer.peerId, challenge)
    })
  }, [pear, claimToIssue])

  // Show role selector if no role chosen
  if (!role) {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
        <Text style={[styles.heading, { color: fg }]}>DID System</Text>
        <Text style={[styles.subheading, { color: sub }]}>Choose Your Role</Text>

        {!identity && (
          <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
            <Text style={[styles.cardTitle, { color: fg }]}>Create Your Identity First</Text>
            <Text style={[styles.label, { color: sub }]}>Full Name</Text>
            <TextInput
              style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
              value={name}
              onChangeText={setName}
              placeholder="Jane Doe"
              placeholderTextColor={sub}
              editable={!creating}
            />
            <Text style={[styles.label, { color: sub }]}>Date of Birth</Text>
            <TextInput
              style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
              value={dob}
              onChangeText={setDob}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={sub}
              editable={!creating}
            />
            <TouchableOpacity
              style={[styles.btnPrimary, (creating || !name.trim() || !dob.trim()) && styles.btnDisabled]}
              disabled={creating || !name.trim() || !dob.trim()}
              onPress={handleCreateIdentity}>
              {creating ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>Create Identity</Text>}
            </TouchableOpacity>
          </View>
        )}

        {identity && (
          <>
            <Text style={[styles.heading, { color: fg, fontSize: 16, marginTop: 20 }]}>
              👤 {identity.name}
            </Text>
            <Text style={[styles.subheading, { color: sub }]}>{identity.publicKey.slice(0, 16)}...</Text>

            <TouchableOpacity
              style={[styles.roleButton, { borderColor: '#4CAF50', backgroundColor: '#4CAF50' + '20' }]}
              onPress={() => setRole('issuer')}>
              <Text style={[styles.roleIcon]}>🏛️</Text>
              <Text style={[styles.roleTitle, { color: '#4CAF50' }]}>ISSUER</Text>
              <Text style={[styles.roleDesc, { color: sub }]}>Issue credentials</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleButton, { borderColor: '#2196F3', backgroundColor: '#2196F3' + '20' }]}
              onPress={() => setRole('holder')}>
              <Text style={[styles.roleIcon]}>💳</Text>
              <Text style={[styles.roleTitle, { color: '#2196F3' }]}>HOLDER</Text>
              <Text style={[styles.roleDesc, { color: sub }]}>Request & store credentials</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.roleButton, { borderColor: '#FF9800', backgroundColor: '#FF9800' + '20' }]}
              onPress={() => setRole('verifier')}>
              <Text style={[styles.roleIcon]}>✅</Text>
              <Text style={[styles.roleTitle, { color: '#FF9800' }]}>VERIFIER</Text>
              <Text style={[styles.roleDesc, { color: sub }]}>Verify credentials</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnDanger, { marginTop: 20 }]}
              onPress={async () => {
                try {
                  await deleteIdentity()
                } catch (err) {
                  Alert.alert('Error', 'Failed to delete')
                }
              }}>
              <Text style={styles.btnDangerText}>Delete Identity</Text>
            </TouchableOpacity>
          </>
        )}

        {(identityError || pear.error) && (
          <View style={[styles.errorCard, { backgroundColor: '#4a1010', borderColor: '#da3633' }]}>
            <Text style={[styles.errorText, { color: '#ff6b6b' }]}>
              {identityError || pear.error}
            </Text>
          </View>
        )}
      </ScrollView>
    )
  }

  // ISSUER SCREEN
  if (role === 'issuer') {
    const issuerTopic = identity ? topicFromPublicKey(identity.publicKey) : ''

    return (
      <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => setRole(null)} style={{ marginBottom: 12 }}>
          <Text style={[styles.backBtn, { color: '#0a7ea4' }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: fg }]}>🏛️ ISSUER</Text>
        <Text style={[styles.subheading, { color: sub }]}>Issue digital credentials</Text>

        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Your Discovery QR</Text>
          <Text style={[styles.desc, { color: sub }]}>Users scan this to request credentials</Text>

          <View style={[styles.qrContainer, { backgroundColor: '#fff', borderColor: border }]}>
            {issuerQRUri ? (
              <Image source={{ uri: issuerQRUri }} style={{ width: 300, height: 300 }} />
            ) : (
              <ActivityIndicator color="#0a7ea4" />
            )}
          </View>

          <Text style={[styles.label, { color: sub, marginTop: 12 }]}>Topic: {issuerTopic.slice(0, 16)}...</Text>

          <TouchableOpacity style={styles.btnPrimary} onPress={handleIssuerStart}>
            <Text style={styles.btnText}>Start Hosting</Text>
          </TouchableOpacity>

          {credentialStatus && (
            <Text style={[styles.label, { color: '#4CAF50', marginTop: 12 }]}>{credentialStatus}</Text>
          )}

          <Text style={[styles.label, { color: sub, marginTop: 12 }]}>Connected Peers: {pear.peers.length}</Text>
          {pear.peers.map((peer) => (
            <Text key={peer.peerId} style={[styles.peerItem, { color: fg }]}>
              • {peer.peerId}
            </Text>
          ))}
        </View>
      </ScrollView>
    )
  }

  // HOLDER SCREEN
  if (role === 'holder') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => setRole(null)} style={{ marginBottom: 12 }}>
          <Text style={[styles.backBtn, { color: '#0a7ea4' }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: fg }]}>💳 HOLDER</Text>
        <Text style={[styles.subheading, { color: sub }]}>Manage your credentials</Text>

        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Your Credential QR</Text>
          <Text style={[styles.desc, { color: sub }]}>Verifiers scan this to validate your credentials</Text>

          <View style={[styles.qrContainer, { backgroundColor: '#fff', borderColor: border }]}>
            {holderQRUri ? (
              <Image source={{ uri: holderQRUri }} style={{ width: 300, height: 300 }} />
            ) : (
              <ActivityIndicator color="#2196F3" />
            )}
          </View>

          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={handleHolderRequestCredential}>
            <Text style={styles.btnText}>Request Credential</Text>
          </TouchableOpacity>

          {credentialStatus && (
            <Text style={[styles.label, { color: '#2196F3', marginTop: 12 }]}>{credentialStatus}</Text>
          )}

          {receivedCredentials.length > 0 && (
            <>
              <Text style={[styles.label, { color: sub, marginTop: 16 }]}>Stored Credentials ({receivedCredentials.length})</Text>
              {receivedCredentials.map((cred, i) => (
                <Text key={i} style={[styles.peerItem, { color: fg }]}>
                  • {cred.claim}
                </Text>
              ))}
            </>
          )}

          <Text style={[styles.label, { color: sub, marginTop: 12 }]}>Connected Peers: {pear.peers.length}</Text>
        </View>
      </ScrollView>
    )
  }

  // VERIFIER SCREEN
  if (role === 'verifier') {
    return (
      <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => setRole(null)} style={{ marginBottom: 12 }}>
          <Text style={[styles.backBtn, { color: '#0a7ea4' }]}>← Back</Text>
        </TouchableOpacity>

        <Text style={[styles.heading, { color: fg }]}>✅ VERIFIER</Text>
        <Text style={[styles.subheading, { color: sub }]}>Verify credentials</Text>

        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Verification QR</Text>
          <Text style={[styles.desc, { color: sub }]}>Users present their credential to scan this</Text>

          <View style={[styles.qrContainer, { backgroundColor: '#fff', borderColor: border }]}>
            {verifierQRUri ? (
              <Image source={{ uri: verifierQRUri }} style={{ width: 300, height: 300 }} />
            ) : (
              <ActivityIndicator color="#FF9800" />
            )}
          </View>

          <TouchableOpacity style={styles.btnPrimary} onPress={handleVerifierStart}>
            <Text style={styles.btnText}>Start Verification</Text>
          </TouchableOpacity>

          {verificationStatus && (
            <Text style={[styles.label, { color: '#FF9800', marginTop: 12 }]}>{verificationStatus}</Text>
          )}

          <Text style={[styles.label, { color: sub, marginTop: 12 }]}>Connected Peers: {pear.peers.length}</Text>
          {pear.peers.map((peer) => (
            <Text key={peer.peerId} style={[styles.peerItem, { color: fg }]}>
              • {peer.peerId}
            </Text>
          ))}
        </View>
      </ScrollView>
    )
  }

  return null
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },
  backBtn: { fontSize: 14, fontWeight: '600', paddingBottom: 8 },

  card: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12 },

  roleButton: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    alignItems: 'center',
  },
  roleIcon: { fontSize: 40, marginBottom: 8 },
  roleTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  roleDesc: { fontSize: 12, textAlign: 'center' },

  qrContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },

  peerItem: { fontSize: 13, marginBottom: 6, paddingLeft: 8 },

  btnPrimary: { backgroundColor: '#0a7ea4', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },

  btnDanger: { borderWidth: 1, borderColor: '#da3633', borderRadius: 12, padding: 12, alignItems: 'center' },
  btnDangerText: { color: '#da3633', fontWeight: '600' },

  errorCard: { borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 16 },
  errorText: { fontSize: 13, fontWeight: '500' },
})
