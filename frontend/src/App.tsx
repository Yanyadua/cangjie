import React from 'react';
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import ImportPage from './pages/ImportPage';
import HistoryPage from './pages/HistoryPage';
import DraftGraphPage from './pages/DraftGraphPage';
import InsertionProposalPage from './pages/InsertionProposalPage';
import GlobalGraphPage from './pages/GlobalGraphPage';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';

const navItems = [
  { to: '/import', label: '导入' },
  { to: '/history', label: '历史' },
  { to: '/graph', label: '全局图谱' },
  { to: '/search', label: '搜索' },
  { to: '/ask', label: '问答' },
];

export default function App() {
  return (
    <BrowserRouter>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* Navigation */}
        <nav style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
          height: 56,
          borderBottom: '1px solid #e2e8f0',
          background: '#fff',
        }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b', marginRight: 24 }}>
            Personal KB
          </div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              style={({ isActive }) => ({
                padding: '6px 12px',
                textDecoration: 'none',
                color: isActive ? '#3b82f6' : '#64748b',
                fontWeight: isActive ? 600 : 400,
                fontSize: 14,
                borderRadius: 4,
                background: isActive ? '#eff6ff' : 'transparent',
              })}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Content */}
        <main style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<ImportPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/draft/:id" element={<DraftGraphPage />} />
            <Route path="/proposal/:id" element={<InsertionProposalPage />} />
            <Route path="/graph" element={<GlobalGraphPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/ask" element={<AskPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
