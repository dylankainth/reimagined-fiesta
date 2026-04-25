import React, { useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Clipboard,
} from 'react-native'
import { usePear } from '@/hooks/use-pear'
import { useColorScheme } from '@/hooks/use-color-scheme'

export default function IdentityScreen() {
  const dark = useColorScheme() === 'dark'
  const pear = usePear()
  const [topic, setTopic] = useState('')
  const [isSharing, setIsSharing] = useState(false)

  const handleStartShare = useCallback(() => {
    setIsSharing(true)
    pear.joinTopic('demo-topic-for-p2p-sharing')
  }, [pear])

  const handleStopShare = useCallback(() => {
    setIsSharing(false)
    pear.leaveTopic()
  }, [pear])

  const handleJoinTopic = useCallback(() => {
    if (topic.trim()) {
      pear.joinTopic(topic)
    }
  }, [topic, pear])

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  if (!pear.ready) {
    return (
      <View style={[styles.center, { backgroundColor: bg }]}>
        <ActivityIndicator color="#0a7ea4" size="large" />
        <Text style={{ color: sub, fontSize: 14 }}>Initializing P2P…</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>Pear P2P</Text>
      <Text style={[styles.subheading, { color: sub }]}>Decentralized networking</Text>

      {!isSharing && !pear.currentTopic ? (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Share or Connect</Text>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={handleStartShare}>
            <Text style={styles.btnText}>Start Sharing</Text>
          </TouchableOpacity>

          <Text style={[styles.dividerText, { color: sub }]}>or</Text>

          <Text style={[styles.label, { color: sub }]}>Join Topic</Text>
          <TextInput
            style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
            value={topic}
            onChangeText={setTopic}
            placeholder="Enter topic hex"
            placeholderTextColor={sub}
          />
          <TouchableOpacity
            style={[styles.btnSecondary, { borderColor: border }]}
            onPress={handleJoinTopic}>
            <Text style={[styles.btnSecondaryText, { color: fg }]}>Join</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {isSharing && (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Sharing</Text>
          <Text style={[styles.desc, { color: sub }]}>
            Topic: demo-topic-for-p2p-sharing
          </Text>
          <Text style={[styles.label, { color: sub }]}>
            Connected Peers: {pear.peers.length}
          </Text>
          {pear.peers.map((peer) => (
            <Text key={peer.peerId} style={[styles.peerItem, { color: fg }]}>
              • {peer.peerId}
            </Text>
          ))}
          <TouchableOpacity style={styles.btnDanger} onPress={handleStopShare}>
            <Text style={styles.btnDangerText}>Stop Sharing</Text>
          </TouchableOpacity>
        </View>
      )}

      {pear.currentTopic && !isSharing && (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>Connected</Text>
          <Text style={[styles.desc, { color: sub }]}>
            Topic: {pear.currentTopic}
          </Text>
          <Text style={[styles.label, { color: sub }]}>
            Peers: {pear.peers.length}
          </Text>
          {pear.peers.map((peer) => (
            <Text key={peer.peerId} style={[styles.peerItem, { color: fg }]}>
              • {peer.peerId}
            </Text>
          ))}
          <TouchableOpacity
            style={styles.btnSecondary}
            onPress={() => pear.leaveTopic()}>
            <Text style={[styles.btnSecondaryText, { color: fg }]}>Disconnect</Text>
          </TouchableOpacity>
        </View>
      )}

      {pear.error && (
        <View style={[styles.errorCard, { backgroundColor: '#4a1010', borderColor: '#da3633' }]}>
          <Text style={[styles.errorText, { color: '#ff6b6b' }]}>Error: {pear.error}</Text>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },

  card: { borderRadius: 16, padding: 20, borderWidth: 1, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 16 },
  desc: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  dividerText: { textAlign: 'center', fontSize: 12, marginVertical: 12 },

  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, marginBottom: 12 },

  btnPrimary: { backgroundColor: '#0a7ea4', borderRadius: 12, padding: 14, alignItems: 'center', marginBottom: 12 },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 16 },

  btnSecondary: { borderWidth: 1, borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
  btnSecondaryText: { fontWeight: '600', fontSize: 15 },

  btnDanger: { borderWidth: 1, borderColor: '#da3633', borderRadius: 12, padding: 12, alignItems: 'center', marginTop: 8 },
  btnDangerText: { color: '#da3633', fontWeight: '600' },

  peerItem: { fontSize: 13, marginBottom: 6, paddingLeft: 8 },
  errorCard: { borderRadius: 12, padding: 12, borderWidth: 1, marginBottom: 16 },
  errorText: { fontSize: 13, fontWeight: '500' },
})
