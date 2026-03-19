import { BrowserRouter, Routes, Route } from "react-router-dom";

import DashboardPage from "./pages/DashboardPage";
import MeasurePage from "./pages/MeasurePage";
import CameraPage from "./pages/CameraPage";
import CalibrationPage from "./pages/CalibrationPage";
import ConverterPage from "./pages/ConverterPage";
import ReportsPage from "./pages/ReportsPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import HelpPage from "./pages/HelpPage";

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/measure" element={<MeasurePage />} />
        <Route path="/camera" element={<CameraPage />} />
        <Route path="/calibration" element={<CalibrationPage />} />
        <Route path="/converter" element={<ConverterPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/help" element={<HelpPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;