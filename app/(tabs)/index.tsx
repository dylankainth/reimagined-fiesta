import React from 'react'
import {
  View, Text, ScrollView,
  StyleSheet,
} from 'react-native'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function IdentityScreen() {
  const dark = useColorScheme() === 'dark'

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>Your Digital ID</Text>
      <Text style={[styles.subheading, { color: sub }]}>Self-sovereign · no central authority</Text>

      <View style={[styles.formCard, { backgroundColor: inputBg, borderColor: border }]}>
        <Text style={[styles.formTitle, { color: fg }]}>Coming Soon</Text>
        <Text style={[styles.label, { color: sub }]}>
          Digital identity functionality will be added here.
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
