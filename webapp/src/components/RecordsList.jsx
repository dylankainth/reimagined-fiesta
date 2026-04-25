import '../styles/RecordsList.css'

export default function RecordsList({ records }) {
  if (records.length === 0) {
    return (
      <div className="records-empty">
        <p>No verified IDs yet. Start by verifying a passport.</p>
      </div>
    )
  }

  return (
    <div className="records-list">
      <h2>📄 Verified ID Records ({records.length})</h2>
      
      <div className="records">
        {records.map((record, idx) => (
          <div key={idx} className="record-card">
            <div className="record-header">
              <h3>{record.passportData.firstName} {record.passportData.lastName}</h3>
              <span className="badge">{record.verificationMethod?.toUpperCase() || 'MANUAL'}</span>
            </div>

            <div className="record-content">
              <div className="record-section">
                <h4>Passport</h4>
                <p><strong>Number:</strong> {record.passportData.number}</p>
                <p><strong>DOB:</strong> {record.passportData.dateOfBirth}</p>
                <p><strong>Nationality:</strong> {record.passportData.nationality}</p>
                <p><strong>Expires:</strong> {record.passportData.expiryDate}</p>
              </div>

              <div className="record-section">
                <h4>Digital ID</h4>
                <p><strong>ID:</strong> <code>{record.digitalID.id.slice(0, 16)}...</code></p>
                <p><strong>Public Key:</strong> <code>{record.digitalID.publicKey.slice(0, 16)}...</code></p>
              </div>

              <div className="record-section">
                <h4>Verification</h4>
                <p><strong>Verified By:</strong> {record.verifiedBy}</p>
                <p><strong>Timestamp:</strong> {new Date(record.timestamp).toLocaleString()}</p>
                {record.notes && <p><strong>Notes:</strong> {record.notes}</p>}
              </div>
            </div>

            <div className="record-footer">
              <small>Record #{idx + 1}</small>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
