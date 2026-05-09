import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import NewJob    from './pages/NewJob';
import JobDetail from './pages/JobDetail';

const nav = [
  { to: '/',        label: 'Dashboard' },
  { to: '/new-job', label: '+ New Job'  },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar */}
      <header className="border-b border-border px-6 py-4 flex items-center gap-8">
        <span className="font-display text-accent font-medium tracking-tight text-lg">
          alis<span className="text-muted">-</span>hub
        </span>
        <nav className="flex gap-6">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `font-body text-sm transition-colors ${
                  isActive ? 'text-white' : 'text-muted hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto font-display text-xs text-muted">
          v0.1.0
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 p-6">
        <Routes>
          <Route path="/"          element={<Dashboard />} />
          <Route path="/new-job"   element={<NewJob />}    />
          <Route path="/jobs/:id"  element={<JobDetail />} />
        </Routes>
      </main>
    </div>
  );
}
