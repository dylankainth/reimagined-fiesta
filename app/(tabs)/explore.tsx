import React from 'react'
import {
  View, Text, ScrollView,
  StyleSheet,
} from 'react-native'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function VerifyScreen() {
  const dark = useColorScheme() === 'dark'

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>Verify Identity</Text>
      <Text style={[styles.subheading, { color: sub }]}>P2P · no data stored on servers</Text>

      <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
        <Text style={[styles.cardTitle, { color: fg }]}>Coming Soon</Text>
        <Text style={[styles.desc, { color: sub }]}>
          Identity verification functionality will be added here.
        </Text>
      </View>
    </ScrollView>
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
