import { Routes, Route, NavLink } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import AccountHealthDashboard from './pages/AccountHealthDashboard';
import TeamAmDashboard from './pages/TeamAmDashboard';
import NewJob    from './pages/NewJob';
import JobDetail from './pages/JobDetail';
import FormMarkupApproval from './pages/FormMarkupApproval';
import KpiDashboard from './pages/KpiDashboard';
import WellnessScorecard from './pages/WellnessScorecard';
import UsageAuditDashboard from './pages/UsageAuditDashboard';
import AuditHistory from './pages/AuditHistory';
import EvaluationDetail from './pages/EvaluationDetail';
import { version } from '../package.json';

const nav = [
  { to: '/',        label: 'Dashboard' },
  { to: '/team-am', label: 'Team AM' },
  { to: '/jobs',    label: 'Job Board' },
  { to: '/new-job', label: '+ New Job'  },
  { to: '/evaluation-detail', label: 'Evaluation Lookup' },
];

export default function App() {
  return (
    <div className="min-h-screen flex flex-col bg-neutral-50">
      {/* Top bar — Clean, professional header */}
      <header className="bg-white border-b border-neutral-200 px-6 py-4 flex items-center gap-8 shadow-sm">
        <span className="flex items-center gap-1.5">
          {/* Light-background horizontal wordmark per the brand guide —
              true aspect ratio (1970x928, 2.123:1), scaled by height only. */}
          <img src="/logo-horizontal.png" alt="alis" className="h-7 w-auto" />
          <span className="font-bold text-xl text-accent-500">hub</span>
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
          v{version}
        </div>
      </header>

      {/* Page content — With proper spacing */}
      <main className="flex-1 px-6 py-8">
        <div className="container-wide">
          <Routes>
            <Route path="/"                    element={<AccountHealthDashboard />} />
            <Route path="/team-am"             element={<TeamAmDashboard />} />
            <Route path="/jobs"                element={<Dashboard />} />
            <Route path="/new-job"             element={<NewJob />}    />
            <Route path="/jobs/:id"            element={<JobDetail />} />
            <Route path="/form-markup/:jobId"  element={<FormMarkupApproval />} />
            <Route path="/qbr/:jobId"          element={<KpiDashboard />} />
            <Route path="/wellness/:jobId"     element={<WellnessScorecard />} />
            <Route path="/usage-audit/:jobId"  element={<UsageAuditDashboard />} />
            <Route path="/audit-history/:jobId" element={<AuditHistory />} />
            <Route path="/evaluation-detail" element={<EvaluationDetail />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
