import React, { useState, useCallback, useEffect } from 'react'
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet,
} from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useIdentity } from '@/hooks/use-identity'
import { usePear } from '@/hooks/use-pear'
import { useColorScheme } from '@/hooks/use-color-scheme'
import {
  verifyCredential, verifyNonceSignature, hashCredential,
} from '@/lib/crypto'
import {
  parseMessage, createVerificationChallenge, createVerificationResult,
} from '@/lib/messaging'
import type { SignedCredential } from '@/lib/crypto'

export default function VerifierScreen() {
  const dark = useColorScheme() === 'dark'
  const { identity } = useIdentity()
  const pear = usePear()

  const [permission, requestPermission] = useCameraPermissions()
  const [scanned, setScanned] = useState(false)
  const [verificationStatus, setVerificationStatus] = useState<string | null>(null)
  const [isScanning, setIsScanning] = useState(false)

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  useEffect(() => {
    requestPermission()
  }, [])

  // Handle incoming messages
  useEffect(() => {
    if (!pear.ready) return

    pear.onMessage((peerId: string, rawMessage: unknown) => {
      try {
        const msg = parseMessage(rawMessage)

        if (msg.type === 'VERIFICATION_PROOF') {
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
      } catch (err) {
        console.error('Message handler error:', err)
      }
    })
  }, [pear])

  const handleBarCodeScanned = useCallback(({ type, data }: { type: string; data: string; }) => {
    setScanned(true)
    try {
      const qrData = JSON.parse(data)
      if (qrData.type === 'holder' && qrData.topic) {
        setIsScanning(false)
        setVerificationStatus('Connecting to holder...')
        pear.joinTopic(qrData.topic)

        setTimeout(() => {
          if (pear.peers.length > 0) {
            const challenge = createVerificationChallenge(hashCredential({
              claim: 'age_over_18',
              issuerPublicKey: '',
              signature: '',
              timestamp: new Date().toISOString(),
            }))
            pear.peers.forEach((peer) => {
              pear.sendToPeer(peer.peerId, challenge)
            })
            setVerificationStatus('Challenge sent, awaiting response...')
          } else {
            setVerificationStatus('No holder found at topic')
          }
        }, 500)
      } else {
        setVerificationStatus('Invalid QR code: expected holder credential')
      }
    } catch (err) {
      setVerificationStatus('Failed to parse QR code')
      console.error('QR scan error:', err)
    }
  }, [pear])

  if (!permission) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: sub }}>Requesting camera permission...</Text>
      </View>
    )
  }

  if (!permission.granted) {
    return (
      <View style={{ flex: 1, backgroundColor: bg, justifyContent: 'center', alignItems: 'center', padding: 20 }}>
        <Text style={[styles.heading, { color: fg, textAlign: 'center' }]}>Camera Access Required</Text>
        <Text style={[styles.desc, { color: sub, marginTop: 12, textAlign: 'center' }]}>
          Please enable camera access in settings to scan QR codes
        </Text>
      </View>
    )
  }

  if (isScanning) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView
          onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
          {scanned && (
            <TouchableOpacity style={[styles.btnPrimary, { marginBottom: 12 }]} onPress={() => setScanned(false)}>
              <Text style={styles.btnText}>Tap to scan again</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.btnPrimary, { backgroundColor: '#666' }]}
            onPress={() => {
              setIsScanning(false)
              setScanned(false)
            }}>
            <Text style={styles.btnText}>Close Scanner</Text>
          </TouchableOpacity>
        </View>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>✅ Credential Verifier</Text>
      <Text style={[styles.subheading, { color: sub }]}>Scan holder credentials to verify</Text>

      <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
        <Text style={[styles.cardTitle, { color: fg }]}>Scan QR Code</Text>
        <Text style={[styles.desc, { color: sub }]}>Hold your camera up to scan a holder's credential QR code</Text>

        <TouchableOpacity
          style={[styles.btnPrimary, { backgroundColor: '#FF9800', marginTop: 12 }]}
          onPress={() => {
            setIsScanning(true)
            setScanned(false)
          }}>
          <Text style={styles.btnText}>Open Scanner</Text>
        </TouchableOpacity>

        {verificationStatus && (
          <Text style={[styles.label, { color: '#FF9800', marginTop: 16, textAlign: 'center' }]}>{verificationStatus}</Text>
        )}

        <Text style={[styles.label, { color: sub, marginTop: 20 }]}>Connected Peers: {pear.peers.length}</Text>
        {pear.peers.map((peer) => (
          <Text key={peer.peerId} style={[styles.peerItem, { color: fg }]}>
            • {peer.peerId}
          </Text>
        ))}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 20, paddingBottom: 40 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },
  card: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  qrContainer: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  peerItem: { fontSize: 13, marginBottom: 6, paddingLeft: 8 },
  btnPrimary: { backgroundColor: '#FF9800', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
