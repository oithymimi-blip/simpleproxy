import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import UserPage from './pages/UserPage';
import AdminPage from './pages/AdminPage';

export default function App() {
  const location = useLocation();
  const isAdmin = location.pathname === '/super' || location.pathname.startsWith('/super/');

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Simple Proxy</span>
        {isAdmin && (
          <nav>
            <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
              User Portal
            </NavLink>
            <NavLink to="/super" className={({ isActive }) => (isActive ? 'active' : '')}>
              Admin Dashboard
            </NavLink>
          </nav>
        )}
      </header>
      <main className="content">
        <Routes>
          <Route path="/" element={<UserPage />} />
          <Route path="/super" element={<AdminPage />} />
        </Routes>
      </main>
    </div>
  );
}
