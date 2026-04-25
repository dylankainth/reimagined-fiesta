import { useState, useEffect } from 'react'
import { PearIDVerifier } from './pear-client'
import PassportUpload from './components/PassportUpload'
import IDLinker from './components/IDLinker'
import RecordsList from './components/RecordsList'
import './App.css'

export default function App() {
  const [verifier, setVerifier] = useState(null)
  const [records, setRecords] = useState([])
  const [publicKey, setPublicKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('verify')

  useEffect(() => {
    const init = async () => {
      try {
        const v = new PearIDVerifier()
        await v.initialize()
        setVerifier(v)
        setPublicKey(v.getPublicKey())
        await loadRecords(v)
      } catch (err) {
        console.error('Failed to initialize verifier:', err)
      }
    }
    init()
  }, [])

  const loadRecords = async (v) => {
    try {
      const data = await v.getAllRecords()
      setRecords(data)
    } catch (err) {
      console.error('Failed to load records:', err)
    }
  }

  const handleVerificationComplete = async (passportData, digitalID, metadata) => {
    if (!verifier) return
    
    setLoading(true)
    try {
      await verifier.storeVerifiedID(passportData, digitalID, metadata)
      await loadRecords(verifier)
      alert('ID verified and stored successfully!')
    } catch (err) {
      console.error('Verification failed:', err)
      alert('Failed to store verification')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="app">
      <header className="header">
        <h1>🏛️ Government ID Verifier</h1>
        <div className="key-display">
          <small>Public Key: {publicKey?.slice(0, 16)}...</small>
        </div>
      </header>

      <div className="tabs">
        <button 
          className={`tab ${activeTab === 'verify' ? 'active' : ''}`}
          onClick={() => setActiveTab('verify')}
        >
          Verify New ID
        </button>
        <button 
          className={`tab ${activeTab === 'records' ? 'active' : ''}`}
          onClick={() => setActiveTab('records')}
        >
          Verified Records ({records.length})
        </button>
      </div>

      <main className="content">
        {activeTab === 'verify' && (
          <div className="verify-section">
            <PassportUpload onPassportData={(data) => {
              setActiveTab('records')
            }} />
            <IDLinker 
              onLinkComplete={handleVerificationComplete}
              loading={loading}
            />
          </div>
        )}
        {activeTab === 'records' && (
          <RecordsList records={records} />
        )}
      </main>
    </div>
  )
}
