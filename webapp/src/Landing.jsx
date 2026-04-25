import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  return (
    <div className="landing">
      <h1 className="landing-title">Verify IDs with confidence</h1>
      <Link to="/dashboard" className="landing-cta">
        Open dashboard
      </Link>
    </div>
  )
}
