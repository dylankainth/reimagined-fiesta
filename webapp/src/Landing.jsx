import { FolderFavouriteIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <div className="landing-hero-icon" aria-hidden>
          <HugeiconsIcon
            icon={FolderFavouriteIcon}
            size={144}
            strokeWidth={1.35}
            color="var(--theme-accent)"
          />
        </div>
        <h1 className="landing-title">
          Verify IDs securely,
          <br />
          in seconds
        </h1>
        <p className="landing-subtitle">
          Built on the documents you trust,
          <br/>
          for secure onboarding.
        </p>
        <Link to="/dashboard" className="landing-cta">
          Open dashboard
        </Link>
      </header>
    </div>
  )
}
