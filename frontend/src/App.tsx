import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import ImportPage from './pages/ImportPage';
import ExtractionWizardPage from './pages/ExtractionWizardPage';
import HistoryPage from './pages/HistoryPage';
import DraftGraphPage from './pages/DraftGraphPage';
import InsertionProposalPage from './pages/InsertionProposalPage';
import GlobalGraphPage from './pages/GlobalGraphPage';
import SearchPage from './pages/SearchPage';
import AskPage from './pages/AskPage';
import ClusteringProposalPage from './pages/ClusteringProposalPage';
import PartitionsPage from './pages/PartitionsPage';
import MergePage from './pages/MergePage';
import EvaluationLabPage from './pages/EvaluationLabPage';

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/" element={<ImportPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/extract/:documentId" element={<ExtractionWizardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/draft/:id" element={<DraftGraphPage />} />
          <Route path="/proposal/:id" element={<InsertionProposalPage />} />
          <Route path="/clustering/:id" element={<ClusteringProposalPage />} />
          <Route path="/graph" element={<GlobalGraphPage />} />
          <Route path="/partitions" element={<PartitionsPage />} />
          <Route path="/merge" element={<MergePage />} />
          <Route path="/eval" element={<EvaluationLabPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/ask" element={<AskPage />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
