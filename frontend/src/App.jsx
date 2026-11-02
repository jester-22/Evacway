import { BrowserRouter, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import { AuthProvider } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute";

import ResidentHome from "./pages/resident/ResidentHome";
import LguDashboard from "./pages/lgu/LguDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";

import PasswordSetup from "./pages/auth/PasswordSetup";
import NetworkStatus from "./components/NetworkStatus/NetworkStatus";
import Dashboard from "./components/Dashboard/Dashboard";

import ManageProfile from "./pages/profile/ManageProfile";
import AdminMap from "./pages/admin/AdminMap";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";

function App() {
  return (
    
    <BrowserRouter>
      <AuthProvider>
        <NetworkStatus />
        <ErrorBoundary>
          <Routes>
          {/* Public — no login required, per the proposal */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/map" element={<ResidentHome />} />
          <Route path="/set-password" element={<PasswordSetup />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute allowedRoles={["admin", "lgu_personnel"]}>
                <Dashboard />
              </ProtectedRoute>
            }
          />

          <Route
            path="/profile"
            element={
              <ProtectedRoute allowedRoles={["admin", "lgu_personnel"]}>
                <ManageProfile />
              </ProtectedRoute>
            }
          />

          {/* Admin and LGU Map page */}
          <Route
            path="/admin/map"
            element={
              <ProtectedRoute allowedRoles={["admin", "lgu_personnel"]}>
                <AdminMap />
              </ProtectedRoute>
            }
          />
          <Route
            path="/lgu/map"
            element={
              <ProtectedRoute allowedRoles={["admin", "lgu_personnel"]}>
                <AdminMap />
              </ProtectedRoute>
            }
          />

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
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
