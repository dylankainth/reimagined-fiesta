import React, { useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native'
import { useBareWorklet } from '@/hooks/use-bare-worklet'
import { useColorScheme } from '@/hooks/use-color-scheme'

type Phase = 'idle' | 'entering' | 'connecting' | 'connected' | 'done'

export default function VerifyScreen() {
  const dark = useColorScheme() === 'dark'
  const worklet = useBareWorklet()

  const [topic, setTopic] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')

  const handleJoin = useCallback(() => {
    const clean = topic.replace(/\s/g, '')
    if (clean.length !== 64) return
    worklet.joinSession(clean)
    setPhase('connecting')
  }, [topic, worklet])

  const handleReset = useCallback(() => {
    worklet.endSession()
    setPhase('idle')
    setTopic('')
  }, [worklet])

  // Derive phase from worklet state
  const effectivePhase: Phase = worklet.verification
    ? 'done'
    : worklet.peerConnected
      ? 'connected'
      : phase

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  if (!worklet.ready) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color="#0a7ea4" size="large" />
        <Text style={{ color: sub, fontSize: 14 }}>Starting secure runtime…</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>Verify Identity</Text>
      <Text style={[styles.subheading, { color: sub }]}>P2P · no data stored on servers</Text>

      {effectivePhase === 'idle' || effectivePhase === 'entering' ? (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Enter Session Code</Text>
          <Text style={[styles.desc, { color: sub }]}>
            Ask the identity holder to open their app and tap "Share Identity via P2P". They'll see a code — enter it below.
          </Text>
          <TextInput
            style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
            value={topic}
            onChangeText={t => {
              setTopic(t)
              setPhase(t.length > 0 ? 'entering' : 'idle')
            }}
            placeholder="Paste 64-char hex code…"
            placeholderTextColor={sub}
            autoCapitalize="none"
            autoCorrect={false}
            multiline
          />
          <Text style={[styles.charCount, { color: sub }]}>
            {topic.replace(/\s/g, '').length} / 64 characters
          </Text>
          <TouchableOpacity
            style={[styles.btnPrimary, topic.replace(/\s/g, '').length !== 64 && styles.btnDisabled]}
            onPress={handleJoin}
            disabled={topic.replace(/\s/g, '').length !== 64}>
            <Text style={styles.btnText}>Connect & Verify</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {effectivePhase === 'connecting' && (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <ActivityIndicator color="#0a7ea4" style={{ marginBottom: 12 }} />
          <Text style={[styles.cardTitle, { color: fg, textAlign: 'center' }]}>Connecting via P2P…</Text>
          <Text style={[styles.desc, { color: sub, textAlign: 'center' }]}>
            Joining DHT swarm. Make sure the holder's app is open and sharing.
          </Text>
          <TouchableOpacity style={[styles.btnSecondary, { borderColor: border }]} onPress={handleReset}>
            <Text style={[styles.btnSecondaryText, { color: fg }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {effectivePhase === 'connected' && (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <ActivityIndicator color="#0a7ea4" style={{ marginBottom: 12 }} />
          <Text style={[styles.cardTitle, { color: fg, textAlign: 'center' }]}>Peer Connected</Text>
          <Text style={[styles.desc, { color: sub, textAlign: 'center' }]}>
            Receiving identity data and verifying signature…
          </Text>
        </View>
      )}

      {effectivePhase === 'done' && worklet.verification && (
        <>
          <View style={[
            styles.resultBanner,
            { backgroundColor: worklet.verification.valid ? '#1a4731' : '#4a1010' },
          ]}>
            <Text style={styles.resultIcon}>{worklet.verification.valid ? '✓' : '✗'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.resultTitle}>
                {worklet.verification.valid ? 'Identity Verified' : 'Verification Failed'}
              </Text>
              <Text style={styles.resultSub}>
                {worklet.verification.valid
                  ? 'Cryptographic signature is valid'
                  : 'Signature does not match public key'}
              </Text>
            </View>
          </View>

          <View style={[styles.idCard, { backgroundColor: inputBg, borderColor: border }]}>
            <Row label="Name" value={worklet.verification.identity.name} fg={fg} sub={sub} />
            <Row label="Date of Birth" value={worklet.verification.identity.dob} fg={fg} sub={sub} />
            <Row
              label="ID Number"
              value={worklet.verification.identity.publicKey.slice(0, 12).toUpperCase().match(/.{1,4}/g)!.join('-')}
              fg={fg} sub={sub} mono
            />
            <Row label="Issued" value={worklet.verification.identity.issuedAt.slice(0, 10)} fg={fg} sub={sub} />
            <Row label="Verified at" value={worklet.verification.verifiedAt.slice(0, 19).replace('T', ' ')} fg={fg} sub={sub} />
            <View style={[styles.divider, { backgroundColor: border }]} />
            <Text style={[styles.pubKeyLabel, { color: sub }]}>PUBLIC KEY</Text>
            <Text style={[styles.pubKey, { color: sub }]} numberOfLines={3}>
              {worklet.verification.identity.publicKey}
            </Text>
          </View>

          <TouchableOpacity style={styles.btnPrimary} onPress={handleReset}>
            <Text style={styles.btnText}>Verify Another</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  )
}

function Row({ label, value, fg, sub, mono = false }: {
  label: string; value: string; fg: string; sub: string; mono?: boolean
}) {
  return (
    <View style={styles.row}>
      <Text style={[styles.rowLabel, { color: sub }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: fg, fontFamily: mono ? 'monospace' : undefined }]}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },

  card: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 16 },

  input: { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 14, marginBottom: 6, minHeight: 70 },
  charCount: { fontSize: 11, marginBottom: 14 },

  btnPrimary: { backgroundColor: '#0a7ea4', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnSecondary: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnSecondaryText: { fontWeight: '600', fontSize: 15 },

  resultBanner: {
    borderRadius: 16, padding: 20, marginBottom: 16,
    flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  resultIcon: { fontSize: 36, color: '#fff' },
  resultTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 2 },
  resultSub: { color: 'rgba(255,255,255,0.7)', fontSize: 13 },

  idCard: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  rowLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, flex: 1 },
  rowValue: { fontSize: 14, fontWeight: '600', flex: 2, textAlign: 'right' },
  divider: { height: 1, marginVertical: 12 },
  pubKeyLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 6 },
  pubKey: { fontSize: 11, fontFamily: 'monospace', lineHeight: 18 },
})
