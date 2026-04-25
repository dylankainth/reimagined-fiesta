import { HugeiconsIcon } from '@hugeicons/react'
import { DocumentValidationIcon } from '@hugeicons/core-free-icons'
import '../styles/RecordsList.css'

export default function RecordsList({ records }) {
  return (
    <div className="records-sidebar-panel">
      <div className="sidebar-header">
        <div className="sidebar-title">
          <HugeiconsIcon
            icon={DocumentValidationIcon}
            size={18}
            strokeWidth={1.75}
            color="currentColor"
            aria-hidden
          />
          <span>Verified Records</span>
        </div>
        <div className="sidebar-meta">
          <span className="sidebar-count">{records.length}</span>
        </div>
      </div>

      <div className="sidebar-body">
        {records.length === 0 ? (
          <div className="sidebar-empty">
            <p>No verified IDs yet.</p>
            <p>Start by verifying a passport.</p>
          </div>
        ) : (
          <ul className="sidebar-list">
            {records.map((record, idx) => (
              <li key={idx} className="sidebar-item">
                <div className="sidebar-item-dot" />
                <div className="sidebar-item-body">
                  <div className="sidebar-item-top">
                    <span className="sidebar-item-name">
                      {record.passportData.firstName} {record.passportData.lastName}
                    </span>
                    <span className="sidebar-item-time">
                      {new Date(record.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="sidebar-item-sub">
                    <span className="sidebar-item-badge">{record.verificationMethod?.toUpperCase() || 'MANUAL'}</span>
                    <span className="sidebar-item-detail">
                      {record.passportData.nationality} · {record.passportData.number}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
