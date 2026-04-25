import { useState } from 'react'
import crypto from 'hypercore-crypto'
import '../styles/IDLinker.css'

export default function IDLinker({ onLinkComplete, loading }) {
  const [passportData, setPassportData] = useState({
    number: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: '',
    issuingCountry: '',
    expiryDate: '',
  })
  const [digitalID, setDigitalID] = useState(null)
  const [verifierInfo, setVerifierInfo] = useState({
    name: '',
    officialID: '',
    notes: '',
  })
  const [step, setStep] = useState('passport')

  const handlePassportChange = (e) => {
    const { name, value } = e.target
    setPassportData(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const handlePassportSubmit = (e) => {
    e.preventDefault()
    if (!passportData.number) {
      alert('Please fill in all passport fields')
      return
    }
    setStep('digital')
  }

  const handleGenerateDigitalID = (e) => {
    e.preventDefault()
    const id = {
      id: crypto.randomBytes(16).toString('hex'),
      publicKey: crypto.keyPair().publicKey.toString('hex'),
      createdAt: new Date().toISOString(),
    }
    setDigitalID(id)
    setStep('verify')
  }

  const handleVerifierChange = (e) => {
    const { name, value } = e.target
    setVerifierInfo(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!passportData || !digitalID || !verifierInfo.name) {
      alert('Please complete all steps')
      return
    }

    await onLinkComplete(
      passportData,
      digitalID,
      {
        verifiedBy: verifierInfo.name,
        officialID: verifierInfo.officialID,
        verificationMethod: 'manual',
        notes: verifierInfo.notes,
      }
    )

    // Reset form
    setPassportData({
      number: '',
      firstName: '',
      lastName: '',
      dateOfBirth: '',
      nationality: '',
      issuingCountry: '',
      expiryDate: '',
    })
    setDigitalID(null)
    setVerifierInfo({ name: '', officialID: '', notes: '' })
    setStep('passport')
  }

  return (
    <div className="id-linker">
      <h2>🔗 Link Digital ID</h2>

      <div className="steps">
        <div className={`step ${step === 'passport' ? 'active' : ''}`}>
          <span className="step-number">1</span>
          <span>Passport</span>
        </div>
        <div className={`step ${step === 'digital' ? 'active' : ''}`}>
          <span className="step-number">2</span>
          <span>Digital ID</span>
        </div>
        <div className={`step ${step === 'verify' ? 'active' : ''}`}>
          <span className="step-number">3</span>
          <span>Verify</span>
        </div>
      </div>

      {step === 'passport' && (
        <form onSubmit={handlePassportSubmit} className="form">
          <div className="form-group">
            <label>Passport Number</label>
            <input
              type="text"
              name="number"
              value={passportData.number}
              onChange={handlePassportChange}
              placeholder="AB123456"
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input
                type="text"
                name="firstName"
                value={passportData.firstName}
                onChange={handlePassportChange}
                placeholder="First name"
              />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input
                type="text"
                name="lastName"
                value={passportData.lastName}
                onChange={handlePassportChange}
                placeholder="Last name"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Date of Birth</label>
            <input
              type="date"
              name="dateOfBirth"
              value={passportData.dateOfBirth}
              onChange={handlePassportChange}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Nationality</label>
              <input
                type="text"
                name="nationality"
                value={passportData.nationality}
                onChange={handlePassportChange}
                placeholder="E.g., US"
              />
            </div>
            <div className="form-group">
              <label>Issuing Country</label>
              <input
                type="text"
                name="issuingCountry"
                value={passportData.issuingCountry}
                onChange={handlePassportChange}
                placeholder="E.g., US"
              />
            </div>
          </div>
          <div className="form-group">
            <label>Expiry Date</label>
            <input
              type="date"
              name="expiryDate"
              value={passportData.expiryDate}
              onChange={handlePassportChange}
            />
          </div>
          <button type="submit" className="btn btn-primary">
            Next: Create Digital ID
          </button>
        </form>
      )}

      {step === 'digital' && (
        <div className="digital-id-section">
          <p>Generated Digital ID:</p>
          <div className="id-display">
            <code>{digitalID?.id}</code>
          </div>
          <button onClick={handleGenerateDigitalID} className="btn btn-primary">
            Generate Digital ID
          </button>
          <button onClick={() => setStep('verify')} className="btn btn-secondary">
            Continue
          </button>
        </div>
      )}

      {step === 'verify' && (
        <form onSubmit={handleSubmit} className="form">
          <h3>Verification Details</h3>
          
          <div className="form-group">
            <label>Verifier Name *</label>
            <input
              type="text"
              name="name"
              value={verifierInfo.name}
              onChange={handleVerifierChange}
              placeholder="Government official name"
              required
            />
          </div>

          <div className="form-group">
            <label>Official ID</label>
            <input
              type="text"
              name="officialID"
              value={verifierInfo.officialID}
              onChange={handleVerifierChange}
              placeholder="Badge or ID number"
            />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea
              name="notes"
              value={verifierInfo.notes}
              onChange={handleVerifierChange}
              placeholder="Any additional notes or observations"
              rows="4"
            />
          </div>

          <div className="summary">
            <h4>Summary</h4>
            <p><strong>Passport:</strong> {passportData?.number}</p>
            <p><strong>Digital ID:</strong> {digitalID?.id?.slice(0, 16)}...</p>
            <p><strong>Verifier:</strong> {verifierInfo.name}</p>
          </div>

          <button type="submit" className="btn btn-success" disabled={loading}>
            {loading ? 'Storing...' : '✓ Verify & Store on Pear'}
          </button>
          <button 
            type="button" 
            className="btn btn-secondary"
            onClick={() => setStep('passport')}
            disabled={loading}
          >
            Back
          </button>
        </form>
      )}
    </div>
  )
}
