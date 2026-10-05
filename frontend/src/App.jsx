import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";

import ResidentHome from "./pages/resident/ResidentHome";
import LguDashboard from "./pages/lgu/LguDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";
import PasswordSetup from "./pages/auth/PasswordSetup";
import NetworkStatus from "./components/NetworkStatus";

function App() {
  return (
    
    <BrowserRouter>
      <AuthProvider>
        <NetworkStatus />
        <Routes>
          {/* Public — no login required, per the proposal */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/map" element={<ResidentHome />} />
          <Route path="/set-password" element={<PasswordSetup />} />

          {/* LGU Personnel only */}
          <Route
            path="/lgu"
            element={
              <ProtectedRoute allowedRoles={["lgu_personnel"]}>
                <LguDashboard />
              </ProtectedRoute>
            }
          />

          {/* Admin only */}
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={["admin"]}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
