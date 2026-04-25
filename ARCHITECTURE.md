# Pear DID Architecture

## Overview
This app implements a **Decentralized Identifier (DID) system** using Holepunch/Pear as the P2P transport layer. The system eliminates central authentication servers and uses cryptographic proofs instead.

## Core Flows

### 1. **Issuer Role** (Government/ID Authority)
- Generates identity claims: `Sign(Issuer_PrivateKey, [User_PublicKey + "OVER_18"])`
- Hosts a Hyperswarm topic (encoded as QR code)
- User scans QR, connects via P2P
- Issuer signs and returns credential

### 2. **Holder Role** (User's Phone)
- **Identity Generation**: Creates ed25519 keypair locally
- **Credential Storage**: Receives signed credentials from Issuer and stores locally
- **Proof Creation**: Can prove ownership of keypair via nonce signing
- **P2P Discovery**: Uses public key to derive Hyperswarm topic

### 3. **Verifier Role** (Bouncer/Third Party)
- Hosts a Hyperswarm topic (QR code)
- User connects and sends: `[Credential + Nonce_Signature + Public_Key]`
- Validates signature using Issuer's public key
- Challenges with random nonce to prevent replay attacks

## Cryptography

**Real Implementation**: Uses `tweetnacl` (pure JavaScript ed25519)

### Key Functions (lib/crypto.ts)
```typescript
generateKeypair()                    // Create ed25519 keypair
signCredential(claim, secretKey)     // Issue a credential
verifyCredential(credential)         // Validate credential signature
generateNonce()                      // Create challenge
signNonce(nonce, secretKey)          // Prove key ownership
verifyNonceSignature(...)            // Validate nonce proof
```

## Transport Layer

**Real P2P**: Uses `react-native-bare-kit` worklet with Hyperswarm

### Current Status
- ✅ **Bare worklet initialized** (see logs: "Starting worklet...")
- ✅ **Real Hyperswarm available** (falls back to mock if unavailable)
- ✅ **IPC bridge working** (React Native ↔ Bare runtime)
- ✅ **Ed25519 keypair generation** (tweetnacl)

### Worklet Mode Detection
The logs show:
```
Starting worklet...
Worklet started
Pear mode: REAL_PEAR  (if Hyperswarm available)
Pear mode: MOCK       (if Hyperswarm unavailable)
```

## QR Code Flow

### Encoding (lib/qr.ts)
```
QRData {
  type: 'holder' | 'verifier' | 'issuer'
  topic: 'abc123...' (64-char hex)
  publicKey: '...' (optional)
  timestamp: ISO string
}
→ Encoded as: pear://BASE64_ENCODED_JSON
→ Renders as QR code
```

### Scanning
- User scans QR with phone camera
- Decodes to Hyperswarm topic
- Auto-joins via P2P network
- Peer discovery via DHT

## Privacy & Security

### What Makes This Secure
1. **No central server** - no database of who accessed what
2. **Cryptographic proof** - Verifier checks math, not a database query
3. **Offline compatible** - if Issuer's public key is known
4. **Nonce challenges** - prevent someone from replaying stolen signatures

### What Happens
```
Holder's Phone                          Verifier's Laptop
         |                                      |
         | Scan QR (topic = abc123...)         |
         |------- Join P2P Topic --------------|
         |                                      |
         | Send: [Credential + Nonce_Sig]      |
         |------- P2P Message ------->         |
         |                                      |
         |  Verify(Issuer_PubKey, Signature)  |
         |  Verify(Holder_PubKey, Nonce_Sig)  |
         |                                      |
         |<------- Result: VALID/INVALID -------|
         |
    (Verifier never calls anyone, just validates crypto)
```

## Next Steps

### Phase 2: Complete Flows
- [ ] Issuer screen: Generate credentials, host P2P topic, display QR
- [ ] Holder screen: Request credential, scan issuer QR, receive & store
- [ ] Verifier screen: Display QR, receive proofs, validate
- [ ] Message handling: JSON protocol over P2P sockets

### Phase 3: Polish
- [ ] Real QR code rendering (qrcode.react or react-native-qrcode)
- [ ] Camera scanning (expo-camera)
- [ ] Credential expiration & revocation
- [ ] Multi-device support

## Current Test Status

✅ **Working**:
- Identity creation with real ed25519 keypairs
- Pear P2P initialization (real or mock mode)
- AsyncStorage persistence
- QR data encoding/decoding utilities
- Crypto signing/verification functions

⏳ **Not yet wired**:
- QR code rendering to UI
- P2P message routing for credentials
- Issuer/Verifier role screens
- End-to-end issuer→holder→verifier flow

## Files

### Core Crypto
- `lib/crypto.ts` - Ed25519 signing, verification, nonces
- `lib/qr.ts` - QR data encoding, topic generation

### React Native UI
- `hooks/use-identity.ts` - Local identity management
- `hooks/use-pear.ts` - P2P networking bridge
- `app/(tabs)/index.tsx` - Holder screen (in progress)
- `app/(tabs)/explore.tsx` - Verifier testing screen

### P2P Runtime
- `worklet/src/index.js` - Bare.js worklet (Hyperswarm bridge)

## Debugging

### Check if using real Pear
Watch the console logs:
```
LOG Starting worklet...
LOG Worklet started
LOG Pear mode: REAL_PEAR  ← Real Hyperswarm working
```

### Generate test credentials
```typescript
import { createSignedCredential } from '@/lib/crypto'

const cred = createSignedCredential(
  'age_over_18',
  'issuer_public_key_hex',
  'issuer_secret_key_hex'
)
```

### Verify a credential
```typescript
import { verifyCredential } from '@/lib/crypto'

const isValid = verifyCredential(credential)
console.log('Valid:', isValid)
```
