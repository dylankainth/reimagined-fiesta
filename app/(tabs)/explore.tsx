import React, { useState, useCallback } from 'react'
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, FlatList,
} from 'react-native'
import { usePear } from '@/hooks/use-pear'
import { useColorScheme } from '@/hooks/use-color-scheme'

interface Message {
  id: string
  peerId: string
  content: string
  timestamp: number
}

export default function TestScreen() {
  const dark = useColorScheme() === 'dark'
  const pear = usePear()
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)

  const handleSendMessage = useCallback(() => {
    if (!message.trim() || !selectedPeer) return
    setMessages((prev) => [
      ...prev,
      {
        id: Math.random().toString(),
        peerId: 'self',
        content: message,
        timestamp: Date.now(),
      },
      {
        id: Math.random().toString(),
        peerId: selectedPeer,
        content: 'Echo: ' + message,
        timestamp: Date.now(),
      },
    ])
    setMessage('')
  }, [message, selectedPeer])

  const bg = dark ? '#0d1117' : '#f5f7fa'
  const fg = dark ? '#e6edf3' : '#1a1a2e'
  const sub = dark ? '#8b949e' : '#6e7681'
  const inputBg = dark ? '#161b22' : '#ffffff'
  const border = dark ? '#30363d' : '#d0d7de'

  return (
    <ScrollView style={{ flex: 1, backgroundColor: bg }} contentContainerStyle={styles.container}>
      <Text style={[styles.heading, { color: fg }]}>P2P Messaging</Text>
      <Text style={[styles.subheading, { color: sub }]}>Test peer-to-peer communication</Text>

      {pear.peers.length === 0 ? (
        <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
          <Text style={[styles.cardTitle, { color: fg }]}>No Peers Connected</Text>
          <Text style={[styles.desc, { color: sub }]}>
            Connect to the P2P network from the home screen to send messages.
          </Text>
        </View>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
            <Text style={[styles.label, { color: sub }]}>Select Peer</Text>
            {pear.peers.map((peer) => (
              <TouchableOpacity
                key={peer.peerId}
                style={[
                  styles.peerButton,
                  { borderColor: border, backgroundColor: selectedPeer === peer.peerId ? '#0a7ea4' : inputBg },
                ]}
                onPress={() => setSelectedPeer(peer.peerId)}>
                <Text
                  style={[
                    styles.peerButtonText,
                    { color: selectedPeer === peer.peerId ? '#fff' : fg },
                  ]}>
                  {peer.peerId}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
            <Text style={[styles.label, { color: sub }]}>Messages</Text>
            <FlatList
              data={messages}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={[styles.message, { backgroundColor: item.peerId === 'self' ? '#0a7ea410' : '#22222210' }]}>
                  <Text style={[styles.messagePeer, { color: sub }]}>
                    {item.peerId === 'self' ? 'You' : item.peerId}
                  </Text>
                  <Text style={[styles.messageContent, { color: fg }]}>{item.content}</Text>
                </View>
              )}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: sub }]}>No messages yet</Text>
              }
            />
          </View>

          {selectedPeer && (
            <View style={[styles.card, { backgroundColor: inputBg, borderColor: border }]}>
              <Text style={[styles.label, { color: sub }]}>Send Message</Text>
              <TextInput
                style={[styles.input, { backgroundColor: bg, borderColor: border, color: fg }]}
                value={message}
                onChangeText={setMessage}
                placeholder="Type a message…"
                placeholderTextColor={sub}
                multiline
              />
              <TouchableOpacity style={styles.btnPrimary} onPress={handleSendMessage}>
                <Text style={styles.btnText}>Send</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  heading: { fontSize: 28, fontWeight: '800', marginBottom: 4 },
  subheading: { fontSize: 13, marginBottom: 28 },

  card: { borderRadius: 16, padding: 16, borderWidth: 1, marginBottom: 16 },
  cardTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  desc: { fontSize: 14, lineHeight: 20 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10 },

  peerButton: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 8 },
  peerButtonText: { fontSize: 14, fontWeight: '500' },

  message: { borderRadius: 8, padding: 12, marginBottom: 8 },
  messagePeer: { fontSize: 11, fontWeight: '600', marginBottom: 4 },
  messageContent: { fontSize: 13 },
  emptyText: { textAlign: 'center', fontSize: 13, paddingVertical: 20 },

  input: { borderWidth: 1, borderRadius: 8, padding: 10, fontSize: 14, marginBottom: 12, minHeight: 60 },
  btnPrimary: { backgroundColor: '#0a7ea4', borderRadius: 8, padding: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
