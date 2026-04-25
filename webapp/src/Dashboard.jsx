import { useEffect, useState } from 'react'
import './App.css'
import IDLinker from './components/IDLinker'
import PassportUpload from './components/PassportUpload'
import RecordsList from './components/RecordsList'
import { PearIDVerifier } from './pear-client'

export default function Dashboard() {
  const [verifier, setVerifier] = useState(null)
  const [records, setRecords] = useState([])
  const [publicKey, setPublicKey] = useState('')
  const [loading, setLoading] = useState(false)

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
      <div className="app-layout">
        <aside className="records-sidebar">
          <RecordsList records={records} />
        </aside>

        <main className="main-content">
          <PassportUpload publicKey={publicKey} onPassportData={() => {}} />
          <IDLinker
            onLinkComplete={handleVerificationComplete}
            loading={loading}
          />
        </main>
      </div>
    </div>
  )
}
