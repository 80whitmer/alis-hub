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
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Top bar — Clean, professional header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-4 flex items-center gap-8 shadow-sm">
        <span className="font-bold text-xl text-primary-600">
          alis<span className="text-accent-500">-hub</span>
        </span>
        <nav className="flex gap-8">
          {nav.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end
              className={({ isActive }) =>
                `text-sm font-medium transition-colors ${
                  isActive
                    ? 'text-primary-600 border-b-2 border-accent-500 pb-2'
                    : 'text-neutral-600 hover:text-primary-600'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto text-xs text-neutral-500">
          v0.1.0
        </div>
      </header>

      {/* Page content — With proper spacing */}
      <main className="flex-1 px-6 py-8">
        <div className="container-wide">
          <Routes>
            <Route path="/"          element={<Dashboard />} />
            <Route path="/new-job"   element={<NewJob />}    />
            <Route path="/jobs/:id"  element={<JobDetail />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
