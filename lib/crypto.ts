import nacl from 'tweetnacl'
import b4a from 'b4a'

export interface Keypair {
  publicKey: string
  secretKey: string
}

export interface SignedCredential {
  claim: string
  issuerPublicKey: string
  signature: string
  timestamp: string
}

export interface VerificationChallenge {
  nonce: string
  timestamp: string
  claimHash: string
}

/**
 * Generate an Ed25519 keypair for a DID
 */
export function generateKeypair(): Keypair {
  const keypair = nacl.sign.keyPair()
  return {
    publicKey: b4a.toString(keypair.publicKey, 'hex'),
    secretKey: b4a.toString(keypair.secretKey, 'hex'),
  }
}

/**
 * Sign a credential claim with issuer's private key
 */
export function signCredential(claim: string, issuerSecretKey: string): string {
  const secretKeyBuf = b4a.from(issuerSecretKey, 'hex')
  const claimBuf = b4a.from(claim)
  const signature = nacl.sign.detached(claimBuf, secretKeyBuf)
  return b4a.toString(signature, 'hex')
}

/**
 * Create a signed credential for a claim
 */
export function createSignedCredential(
  claim: string,
  issuerPublicKey: string,
  issuerSecretKey: string
): SignedCredential {
  const signature = signCredential(claim, issuerSecretKey)
  return {
    claim,
    issuerPublicKey,
    signature,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Verify a credential signature
 */
export function verifyCredential(credential: SignedCredential): boolean {
  try {
    const claimBuf = b4a.from(credential.claim)
    const signatureBuf = b4a.from(credential.signature, 'hex')
    const publicKeyBuf = b4a.from(credential.issuerPublicKey, 'hex')
    return nacl.sign.detached.verify(claimBuf, signatureBuf, publicKeyBuf)
  } catch (err) {
    console.error('Verification error:', err)
    return false
  }
}

/**
 * Generate a random nonce for replay attack prevention
 */
export function generateNonce(): string {
  const randomBytes = nacl.randomBytes(32)
  return b4a.toString(randomBytes, 'hex')
}

/**
 * Sign a nonce to prove ownership of private key
 */
export function signNonce(nonce: string, secretKey: string): string {
  const secretKeyBuf = b4a.from(secretKey, 'hex')
  const nonceBuf = b4a.from(nonce)
  const signature = nacl.sign.detached(nonceBuf, secretKeyBuf)
  return b4a.toString(signature, 'hex')
}

/**
 * Verify nonce signature to prove key ownership
 */
export function verifyNonceSignature(nonce: string, signature: string, publicKey: string): boolean {
  try {
    const nonceBuf = b4a.from(nonce)
    const signatureBuf = b4a.from(signature, 'hex')
    const publicKeyBuf = b4a.from(publicKey, 'hex')
    return nacl.sign.detached.verify(nonceBuf, signatureBuf, publicKeyBuf)
  } catch (err) {
    console.error('Nonce verification error:', err)
    return false
  }
}

/**
 * Create a hash of credential for verification challenge
 */
export function hashCredential(credential: SignedCredential): string {
  const data = JSON.stringify({
    claim: credential.claim,
    issuerPublicKey: credential.issuerPublicKey,
    signature: credential.signature,
  })
  const hash = nacl.hash(b4a.from(data))
  return b4a.toString(hash, 'hex')
}
