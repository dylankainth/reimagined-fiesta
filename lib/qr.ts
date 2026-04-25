/**
 * QR Code handling for Hyperswarm discovery topics
 */

export interface QRData {
  type: 'holder' | 'verifier' | 'issuer'
  topic: string
  publicKey?: string
  timestamp: string
}

/**
 * Encode discovery data for QR code
 */
export function encodeQRData(data: QRData): string {
  // Use a simple URL-safe encoding
  // In production, use a proper QR library like `qrcode` or `qrcode.react`
  const encoded = btoa(JSON.stringify(data))
  return `pear://${encoded}`
}

/**
 * Decode QR data from scanned string
 */
export function decodeQRData(qrString: string): QRData {
  try {
    if (qrString.startsWith('pear://')) {
      const encoded = qrString.replace('pear://', '')
      const decoded = atob(encoded)
      return JSON.parse(decoded)
    }
    throw new Error('Invalid QR format')
  } catch (err) {
    throw new Error(`Failed to decode QR: ${err instanceof Error ? err.message : 'Unknown error'}`)
  }
}

/**
 * Generate a human-readable topic hex for display
 */
export function formatTopic(topic: string): string {
  // Show first 16 chars, then ellipsis, then last 8
  if (topic.length <= 24) return topic
  return `${topic.slice(0, 16)}...${topic.slice(-8)}`
}

/**
 * Generate a discovery topic from a public key
 * (In real implementation, would use proper hash function)
 */
export function topicFromPublicKey(publicKey: string): string {
  // Use first 64 hex chars (32 bytes) of public key as topic
  return publicKey.slice(0, 64)
}
