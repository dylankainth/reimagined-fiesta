import Hypercore from 'hypercore'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'

export class PearIDVerifier {
  constructor() {
    this.core = null
    this.swarm = null
    this.ready = false
  }

  async initialize() {
    // Create a Hypercore for storing verified IDs
    this.core = new Hypercore(`./storage/id-core`, {
      keyPair: crypto.keyPair(),
    })
    
    await this.core.ready()
    
    // Create a Hyperswarm to share this core
    this.swarm = new Hyperswarm()
    this.swarm.join(this.core.discoveryKey)
    
    this.ready = true
    console.log('Pear ID Verifier initialized')
    console.log('Public Key:', this.core.key.toString('hex'))
  }

  // Store a verified ID record
  async storeVerifiedID(passportData, digitalID, metadata = {}) {
    if (!this.ready) await this.initialize()

    const record = {
      timestamp: Date.now(),
      passportData: {
        number: passportData.number,
        firstName: passportData.firstName,
        lastName: passportData.lastName,
        dateOfBirth: passportData.dateOfBirth,
        nationality: passportData.nationality,
        issuingCountry: passportData.issuingCountry,
        expiryDate: passportData.expiryDate,
      },
      digitalID: {
        id: digitalID.id,
        publicKey: digitalID.publicKey,
        createdAt: digitalID.createdAt,
      },
      verifiedBy: metadata.verifiedBy,
      verificationMethod: metadata.verificationMethod,
      notes: metadata.notes || '',
    }

    const encoded = JSON.stringify(record)
    await this.core.append(encoded)
    
    return {
      success: true,
      index: this.core.length - 1,
      publicKey: this.core.key.toString('hex'),
    }
  }

  // Retrieve all verified ID records
  async getAllRecords() {
    if (!this.ready) await this.initialize()

    const records = []
    for (let i = 0; i < this.core.length; i++) {
      const data = await this.core.get(i)
      records.push(JSON.parse(data.toString()))
    }
    return records
  }

  // Query records by passport number
  async getByPassportNumber(passportNumber) {
    const records = await this.getAllRecords()
    return records.filter(r => r.passportData.number === passportNumber)
  }

  // Get core discovery key for sharing
  getDiscoveryKey() {
    if (!this.core) return null
    return this.core.discoveryKey.toString('hex')
  }

  // Get public key for the ID core
  getPublicKey() {
    if (!this.core) return null
    return this.core.key.toString('hex')
  }

  async close() {
    if (this.swarm) await this.swarm.destroy()
    if (this.core) await this.core.close()
  }
}
