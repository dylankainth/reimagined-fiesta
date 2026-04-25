import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-hero">
        <h1 className="landing-title">
          Verify IDs securely, in seconds
        </h1>
        <p className="landing-subtitle">
          Your verification partner, grounded in the documents
          <br />
          you trust, built for secure onboarding.
        </p>
        <Link to="/dashboard" className="landing-cta">
          Open dashboard
        </Link>
      </header>
    </div>
  )
}
