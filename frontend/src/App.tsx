import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardPage   from './pages/DashboardPage';
import CalibrationPage from './pages/CalibrationPage';
import ConverterPage   from './pages/ConverterPage';
import HistoryPage     from './pages/HistoryPage';
import HelpPage        from './pages/HelpPage';
import ReportsPage     from './pages/ReportsPage';
import SettingsPage    from './pages/SettingsPage';
import MeasurePage     from './pages/MeasurePage';
import CameraPage      from './pages/CameraPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"            element={<DashboardPage />} />
        <Route path="/measurement" element={<MeasurePage />} />
        <Route path="/live"        element={<CameraPage />} />
        <Route path="/reports"     element={<ReportsPage />} />
        <Route path="/history"     element={<HistoryPage />} />
        <Route path="/converter"   element={<ConverterPage />} />
        <Route path="/calibration" element={<CalibrationPage />} />
        <Route path="/settings"    element={<SettingsPage />} />
        <Route path="/help"        element={<HelpPage />} />
        <Route path="*"            element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}