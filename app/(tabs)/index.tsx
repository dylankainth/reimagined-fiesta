import React, { useState, useEffect, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, Alert, ActivityIndicator, Clipboard,
} from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useBareWorklet, type DigitalID } from '@/hooks/use-bare-worklet'
import { useColorScheme } from '@/hooks/use-color-scheme'

const STORAGE_KEY = 'digitalid_v1'

function IDCard({ id, dark }: { id: DigitalID; dark: boolean }) {
  const idNumber = id.publicKey.slice(0, 12).toUpperCase().match(/.{1,4}/g)!.join('-')
  return (
    <View style={[styles.card, dark && styles.cardDark]}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardHeaderLabel}>DIGITAL IDENTITY</Text>
        <Text style={styles.cardChip}>⬡</Text>
      </View>
      <View style={styles.cardAvatar}>
        <Text style={styles.cardAvatarText}>
          {id.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
        </Text>
      </View>
      <Text style={styles.cardName}>{id.name}</Text>
      <View style={styles.cardRow}>
        <View>
          <Text style={styles.cardFieldLabel}>DATE OF BIRTH</Text>
          <Text style={styles.cardFieldValue}>{id.dob}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.cardFieldLabel}>ISSUED</Text>
          <Text style={styles.cardFieldValue}>{id.issuedAt.slice(0, 10)}</Text>
        </View>
      </View>
      <Text style={styles.cardNumber}>{idNumber}</Text>
      <Text style={styles.cardSubLabel}>SELF-SOVEREIGN · P2P VERIFIED</Text>
    </View>
  )
}

export default function IdentityScreen() {
  const dark = useColorScheme() === 'dark'
  const worklet = useBareWorklet()

  const [name, setName] = useState('')
  const [dob, setDob] = useState('')
  const [creating, setCreating] = useState(false)
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (!worklet.ready) return
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (raw) worklet.loadIdentity(JSON.parse(raw))
    })
  }, [worklet.ready])

  useEffect(() => {
    if (worklet.identity) {
      setCreating(false)
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(worklet.identity))
    }
  }, [worklet.identity])

  useEffect(() => {
    if (worklet.sessionTopic) setSharing(true)
  }, [worklet.sessionTopic])

  const handleCreate = useCallback(() => {
    if (!name.trim() || !dob.trim()) return Alert.alert('Missing fields', 'Enter your name and date of birth.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return Alert.alert('Invalid date', 'Use format YYYY-MM-DD')
    setCreating(true)
    worklet.createIdentity(name.trim(), dob.trim())
  }, [name, dob, worklet])

  const handleStopShare = useCallback(() => {
    worklet.endSession()
    setSharing(false)
  }, [worklet])

  const handleCopy = useCallback(() => {
    if (worklet.sessionTopic) Clipboard.setString(worklet.sessionTopic)
  }, [worklet.sessionTopic])

  const handleDelete = useCallback(() => {
    Alert.alert('Delete Identity', 'This will permanently remove your digital ID.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: () => {
          AsyncStorage.removeItem(STORAGE_KEY)
          worklet.loadIdentity(null as unknown as DigitalID)
        },
      },
    ])
  }, [worklet])

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  if (!worklet.ready) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color="#0a7ea4" size="large" />
        <Text style={[styles.statusText, { color: sub }]}>Starting secure runtime…</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>Your Digital ID</Text>
      <Text style={[styles.subheading, { color: sub }]}>Self-sovereign · no central authority</Text>

      {!worklet.identity ? (
        <View style={[styles.formCard, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.formTitle, { color: fg }]}>Create Your Identity</Text>
          <Text style={[styles.label, { color: sub }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
            value={name}
            onChangeText={setName}
            placeholder="Jane Doe"
            placeholderTextColor={sub}
            autoCapitalize="words"
          />
          <Text style={[styles.label, { color: sub }]}>Date of Birth</Text>
          <TextInput
            style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
            value={dob}
            onChangeText={setDob}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={sub}
            keyboardType="numeric"
          />
          <TouchableOpacity
            style={[styles.btnPrimary, creating && styles.btnDisabled]}
            onPress={handleCreate}
            disabled={creating}>
            {creating
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Generate Keypair & Create ID</Text>}
          </TouchableOpacity>
          <Text style={[styles.hint, { color: sub }]}>
            An ed25519 keypair is generated entirely on-device. Your private key never leaves this phone.
          </Text>
        </View>
      ) : (
        <>
          <IDCard id={worklet.identity} dark={dark} />

          {!sharing ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={() => worklet.startSession()}>
              <Text style={styles.btnText}>Share Identity via P2P</Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.shareCard, { backgroundColor: inputBg, borderColor: border }]}>
              <Text style={[styles.shareTitle, { color: fg }]}>
                {worklet.peerConnected ? '✓ Verifier Connected' : 'Waiting for verifier…'}
              </Text>
              {!worklet.peerConnected && worklet.sessionTopic && (
                <>
                  <Text style={[styles.label, { color: sub }]}>Share this code with the verifier:</Text>
                  <TouchableOpacity onPress={handleCopy} activeOpacity={0.7}>
                    <Text style={styles.sessionCode}>
                      {worklet.sessionTopic.match(/.{1,8}/g)!.join('  ')}
                    </Text>
                    <Text style={[styles.hint, { color: sub, textAlign: 'center' }]}>Tap to copy</Text>
                  </TouchableOpacity>
                </>
              )}
              {worklet.peerConnected && (
                <Text style={[styles.hint, { color: sub }]}>
                  {worklet.identityVerified
                    ? '✓ Verifier confirmed receipt of your identity.'
                    : 'Sending identity data to verifier…'}
                </Text>
              )}
              <TouchableOpacity style={[styles.btnSecondary, { borderColor: border }]} onPress={handleStopShare}>
                <Text style={[styles.btnSecondaryText, { color: fg }]}>End Session</Text>
              </TouchableOpacity>
            </View>
          )}

          <TouchableOpacity style={[styles.btnDanger]} onPress={handleDelete}>
            <Text style={styles.btnDangerText}>Delete Identity</Text>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },
  statusText: { fontSize: 14 },

  card: {
    borderRadius: 20, padding: 24, marginBottom: 24,
    backgroundColor: '#0a7ea4',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 16, elevation: 10,
  },
  cardDark: { backgroundColor: '#0d4f6e' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  cardHeaderLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 10, fontWeight: '700', letterSpacing: 2 },
  cardChip: { color: 'rgba(255,255,255,0.8)', fontSize: 20 },
  cardAvatar: {
    width: 60, height: 60, borderRadius: 30,
    backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', marginBottom: 12,
  },
  cardAvatarText: { color: '#fff', fontSize: 22, fontWeight: '700' },
  cardName: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 20 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 },
  cardFieldLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 4 },
  cardFieldValue: { color: '#fff', fontSize: 14, fontWeight: '600' },
  cardNumber: { color: 'rgba(255,255,255,0.9)', fontSize: 16, fontWeight: '700', letterSpacing: 3, marginBottom: 8 },
  cardSubLabel: { color: 'rgba(255,255,255,0.5)', fontSize: 9, fontWeight: '600', letterSpacing: 1 },

  formCard: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  formTitle: { fontSize: 18, fontWeight: '700', marginBottom: 20 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 14, fontSize: 16, marginBottom: 16 },
  hint: { fontSize: 12, lineHeight: 18, marginTop: 8 },

  btnPrimary: { backgroundColor: '#0a7ea4', borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 12 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  btnSecondary: { borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  btnSecondaryText: { fontWeight: '600', fontSize: 15 },

  btnDanger: { borderWidth: 1, borderColor: '#da3633', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  btnDangerText: { color: '#da3633', fontWeight: '600' },

  shareCard: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  shareTitle: { fontSize: 17, fontWeight: '700', marginBottom: 16 },
  sessionCode: {
    fontFamily: 'monospace', fontSize: 12, color: '#0a7ea4',
    backgroundColor: 'rgba(10,126,164,0.1)', borderRadius: 8,
    padding: 14, textAlign: 'center', letterSpacing: 1, marginBottom: 4,
  },
})
