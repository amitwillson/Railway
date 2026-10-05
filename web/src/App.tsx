import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './state/AuthContext';
import AppShell from './components/AppShell';
import { Loading } from './components/ui';
import Login from './pages/Login';
import Home from './pages/Home';
import NewInspection from './pages/NewInspection';
import Inspections from './pages/Inspections';
import InspectionDetail from './pages/InspectionDetail';
import Observations from './pages/Observations';
import ObservationDetail from './pages/ObservationDetail';
import Compliance from './pages/Compliance';
import ModuleLanding from './pages/ModuleLanding';
import Stations from './pages/Stations';
import StationDetail from './pages/StationDetail';
import { Trains, TrainDetail } from './pages/Trains';
import Reports from './pages/Reports';
import Dashboard from './pages/Dashboard';
import Notifications from './pages/Notifications';
import Search from './pages/Search';
import Profile from './pages/Profile';
import SyncQueue from './pages/SyncQueue';
import Admin from './pages/Admin';
import { NoteCompose, NoteDetail, Notes } from './pages/InspectionNote';

export default function App() {
  const { user, ready } = useAuth();
  const location = useLocation();

  if (!ready) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <Loading label="Starting" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace state={{ from: location.pathname }} />} />
      </Routes>
    );
  }

  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="/modules/:code" element={<ModuleLanding />} />
        <Route path="/inspections/new" element={<NewInspection />} />
        <Route path="/inspections" element={<Inspections />} />
        <Route path="/inspections/:id" element={<InspectionDetail />} />
        <Route path="/inspections/:id/note" element={<NoteCompose />} />
        <Route path="/notes" element={<Notes />} />
        <Route path="/notes/new" element={<NoteCompose />} />
        <Route path="/notes/:id" element={<NoteDetail />} />
        <Route path="/observations" element={<Observations />} />
        <Route path="/observations/:id" element={<ObservationDetail />} />
        <Route path="/compliance" element={<Compliance />} />
        <Route path="/stations" element={<Stations />} />
        <Route path="/stations/:id" element={<StationDetail />} />
        <Route path="/trains" element={<Trains />} />
        <Route path="/trains/:id" element={<TrainDetail />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/search" element={<Search />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/sync" element={<SyncQueue />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/admin/:section" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
