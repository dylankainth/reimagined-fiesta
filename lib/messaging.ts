import { SignedCredential, generateNonce, signNonce } from './crypto'

/**
 * P2P Message Types for DID Flows
 */

export type MessageType =
  | 'CREDENTIAL_REQUEST'
  | 'CREDENTIAL_ISSUED'
  | 'VERIFICATION_CHALLENGE'
  | 'VERIFICATION_PROOF'
  | 'VERIFICATION_RESULT'
  | 'ERROR'

export interface PeerMessage {
  type: MessageType
  payload: unknown
  timestamp: string
  nonce?: string
}

/**
 * ISSUER → HOLDER
 * Issuer sends signed credential after holder requests it
 */
export interface CredentialIssuedMessage {
  type: 'CREDENTIAL_ISSUED'
  credential: SignedCredential
  issuerPublicKey: string
}

/**
 * HOLDER → VERIFIER
 * Holder sends proof of credential and key ownership
 */
export interface VerificationProofMessage {
  type: 'VERIFICATION_PROOF'
  credential: SignedCredential
  holderPublicKey: string
  nonceSignature: string
  challenge: string
}

/**
 * VERIFIER → HOLDER
 * Verifier sends challenge nonce
 */
export interface VerificationChallengeMessage {
  type: 'VERIFICATION_CHALLENGE'
  nonce: string
  claimHash: string
}

/**
 * VERIFIER → HOLDER (or UI)
 * Verification result
 */
export interface VerificationResultMessage {
  type: 'VERIFICATION_RESULT'
  valid: boolean
  reason?: string
  claimHash: string
}

/**
 * Create a credential request message (Holder sends to Issuer)
 */
export function createCredentialRequest(holderPublicKey: string): PeerMessage {
  return {
    type: 'CREDENTIAL_REQUEST',
    payload: {
      holderPublicKey,
      requestedClaim: 'age_over_18',
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a credential issued message (Issuer sends to Holder)
 */
export function createCredentialIssuedMessage(
  credential: SignedCredential,
  issuerPublicKey: string
): PeerMessage {
  return {
    type: 'CREDENTIAL_ISSUED',
    payload: {
      credential,
      issuerPublicKey,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a verification challenge (Verifier sends to Holder)
 */
export function createVerificationChallenge(claimHash: string): PeerMessage {
  const nonce = generateNonce()
  return {
    type: 'VERIFICATION_CHALLENGE',
    payload: {
      nonce,
      claimHash,
    },
    nonce,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a verification proof (Holder sends to Verifier)
 */
export function createVerificationProof(
  credential: SignedCredential,
  holderPublicKey: string,
  holderSecretKey: string,
  challenge: string
): PeerMessage {
  const nonceSignature = signNonce(challenge, holderSecretKey)
  return {
    type: 'VERIFICATION_PROOF',
    payload: {
      credential,
      holderPublicKey,
      nonceSignature,
      challenge,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create a verification result (Verifier sends back)
 */
export function createVerificationResult(
  valid: boolean,
  claimHash: string,
  reason?: string
): PeerMessage {
  return {
    type: 'VERIFICATION_RESULT',
    payload: {
      valid,
      reason,
      claimHash,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Create error message
 */
export function createErrorMessage(message: string): PeerMessage {
  return {
    type: 'ERROR',
    payload: {
      message,
    },
    timestamp: new Date().toISOString(),
  }
}

/**
 * Parse incoming P2P message
 */
export function parseMessage(data: unknown): PeerMessage {
  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid message format')
  }

  const msg = data as Record<string, unknown>
  if (!msg.type || !msg.timestamp || !msg.payload) {
    throw new Error('Message missing required fields')
  }

  return msg as PeerMessage
}
