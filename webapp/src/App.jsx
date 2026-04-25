import { Routes, Route } from 'react-router-dom'
import Landing from './Landing'
import Dashboard from './Dashboard'

export default function App() {
  return (
    <div className="routes-root">
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/dashboard" element={<Dashboard />} />
      </Routes>
    </div>
  )
}
