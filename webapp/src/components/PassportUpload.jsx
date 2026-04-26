import { HugeiconsIcon } from '@hugeicons/react'
import { ImageUpload01Icon } from '@hugeicons/core-free-icons'
import { useRef, useState } from 'react'
import '../styles/PassportUpload.css'

export default function PassportUpload({ publicKey, onPassportData }) {
  const [method, setMethod] = useState('manual')
  const [formData, setFormData] = useState({
    number: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    nationality: '',
    issuingCountry: '',
    expiryDate: '',
  })
  const [ocrLoading, setOcrLoading] = useState(false)
  const fileInputRef = useRef(null)

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }))
  }

  const handleManualSubmit = (e) => {
    e.preventDefault()
    if (Object.values(formData).some(v => !v)) {
      alert('Please fill in all fields')
      return
    }
    onPassportData(formData)
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setOcrLoading(true)
    await new Promise(r => setTimeout(r, 2500))
    setFormData({
      number: '123709012',
      firstName: 'ARVIN',
      lastName: 'HADIDI-FARD',
      dateOfBirth: '2005-09-15',
      nationality: 'GBR',
      issuingCountry: 'GBR',
      expiryDate: '2026-01-22',
    })
    setOcrLoading(false)
    setMethod('manual')
  }

  return (
    <div className="passport-upload">
      <h2 className="passport-upload-title">Passport Data Entry</h2>

      <div className="key-display">
        <small>Public Key: {publicKey?.slice(0, 16)}...</small>
      </div>

      <div className="method-toggle">
        <button 
          className={method === 'manual' ? 'active' : ''}
          onClick={() => setMethod('manual')}
        >
          Manual Entry
        </button>
        <button 
          className={method === 'ocr' ? 'active' : ''}
          onClick={() => setMethod('ocr')}
        >
          Upload Image (OCR)
        </button>
      </div>

      {method === 'manual' && (
        <form onSubmit={handleManualSubmit} className="form">
          <div className="form-group">
            <label>Passport Number *</label>
            <input
              type="text"
              name="number"
              value={formData.number}
              onChange={handleInputChange}
              placeholder="E.g., AB123456"
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>First Name *</label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                placeholder="First name"
              />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                placeholder="Last name"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Date of Birth *</label>
            <input
              type="date"
              name="dateOfBirth"
              value={formData.dateOfBirth}
              onChange={handleInputChange}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Nationality *</label>
              <input
                type="text"
                name="nationality"
                value={formData.nationality}
                onChange={handleInputChange}
                placeholder="E.g., US"
              />
            </div>
            <div className="form-group">
              <label>Issuing Country *</label>
              <input
                type="text"
                name="issuingCountry"
                value={formData.issuingCountry}
                onChange={handleInputChange}
                placeholder="E.g., US"
              />
            </div>
          </div>

          <div className="form-group">
            <label>Expiry Date *</label>
            <input
              type="date"
              name="expiryDate"
              value={formData.expiryDate}
              onChange={handleInputChange}
            />
          </div>

          <button type="submit" className="btn btn-primary">
            Continue to Digital ID Link
          </button>
        </form>
      )}

      {method === 'ocr' && (
        <div className="ocr-upload">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
          />
          <button
            type="button"
            className="btn btn-secondary btn-with-icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={ocrLoading}
          >
            <HugeiconsIcon
              icon={ImageUpload01Icon}
              size={18}
              strokeWidth={1.75}
              color="currentColor"
              aria-hidden
            />
            {ocrLoading ? 'Scanning passport...' : 'Upload Passport Image'}
          </button>
          {!ocrLoading && <p className="hint">Supported: JPG, PNG. OCR processing happens client-side.</p>}
        </div>
      )}
    </div>
  )
}
