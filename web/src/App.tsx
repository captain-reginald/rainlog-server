import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useRainlogState } from './lib/hooks'
import { Charts } from './pages/Charts'
import { Dashboard } from './pages/Dashboard'
import { Data } from './pages/Data'
import { History } from './pages/History'
import { Settings } from './pages/Settings'

const NAV = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/history', label: 'History', end: false },
  { to: '/charts', label: 'Charts', end: false },
  { to: '/data', label: 'Data', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <path
        d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.4a6.5 6.5 0 1 1-13 0C5.5 10.7 8.4 7.1 12 2.5Z"
        fill="currentColor"
        opacity="0.16"
      />
      <path
        d="M12 2.5c3.6 4.6 6.5 8.2 6.5 11.4a6.5 6.5 0 1 1-13 0C5.5 10.7 8.4 7.1 12 2.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M9 13.4c0 1.7 1.3 3.1 3 3.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function App() {
  const stateQuery = useRainlogState()
  const location = useLocation()
  const parseError = stateQuery.data?.parseError
  const showGlobalBanner = Boolean(parseError) && location.pathname !== '/data'

  return (
    <div className="app-shell">
      <header className="site-header">
        <NavLink to="/" className="brand">
          <DropIcon />
          <span>Rain Log</span>
        </NavLink>
        <nav className="site-nav" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-link is-active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="site-main">
        {showGlobalBanner ? (
          <div className="banner banner-error">
            <strong>The data file is not valid JSON.</strong>
            <span>{parseError}</span>
            <span>
              Writes are paused to protect your history. <NavLink to="/data">Open the Data page</NavLink> to
              recover it.
            </span>
          </div>
        ) : null}
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/history" element={<History />} />
          <Route path="/charts" element={<Charts />} />
          <Route path="/data" element={<Data />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <footer className="site-footer">
        <span>Rain Log web companion</span>
        <span aria-hidden="true">·</span>
        <span>
          Data stays in <code>rainlog.json</code>
        </span>
        <NavLink to="/data">Compatibility</NavLink>
      </footer>
    </div>
  )
}
