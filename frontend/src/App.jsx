import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute/ProtectedRoute";

import ResidentHome from "./pages/resident/ResidentHome";
import LguDashboard from "./pages/lgu/LguDashboard";
import AdminDashboard from "./pages/admin/AdminDashboard";

import Login from "./pages/auth/Login";
import ForgotPassword from "./pages/auth/ForgotPassword";
import PasswordSetup from "./pages/auth/PasswordSetup";
import NetworkStatus from "./components/NetworkStatus/NetworkStatus";
import Dashboard from "./components/Dashboard/Dashboard";

import ManageProfile from "./pages/profile/ManageProfile";
import AdminMap from "./pages/admin/AdminMap";
import ErrorBoundary from "./components/ErrorBoundary/ErrorBoundary";
import DataPrivacyNotice from "./pages/DataPrivacyNotice";

function getRoleHomePath(role) {
  if (role === "admin" || role === "lgu_personnel") return "/dashboard";
  return "/map";
}

function GuestOnlyRoute({ children }) {
  const { user } = useAuth();
  if (user) {
    return <Navigate to={getRoleHomePath(user.role)} replace />;
  }
  return children;
}

function ResidentOrGuestRoute({ children }) {
  const { user } = useAuth();
  if (user && (user.role === "admin" || user.role === "lgu_personnel")) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}

function App() {
  return (

    <BrowserRouter>
      <AuthProvider>
        <NetworkStatus />
        <ErrorBoundary>
          <Routes>
            {/* Public — no login required, per the proposal */}
            <Route
              path="/"
              element={
                <GuestOnlyRoute>
                  <LandingPage />
                </GuestOnlyRoute>
              }
            />
            <Route
              path="/map"
              element={
                <ResidentOrGuestRoute>
                  <ResidentHome />
                </ResidentOrGuestRoute>
              }
            />
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/set-password" element={<PasswordSetup />} />
            <Route path="/data-privacy-notice" element={<DataPrivacyNotice />} />
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
            <Route
              path="/admin/evacuation-centers/:centerId"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/evacuation-centers/:centerId/buildings/:buildingId"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/evacuation-centers/:centerId/rooms/:roomId"
              element={
                <ProtectedRoute allowedRoles={["admin"]}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lgu/evacuation-centers/:centerId/buildings/:buildingId"
              element={
                <ProtectedRoute allowedRoles={["lgu_personnel"]}>
                  <LguDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lgu/evacuation-centers/:centerId"
              element={
                <ProtectedRoute allowedRoles={["lgu_personnel"]}>
                  <LguDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/lgu/evacuation-centers/:centerId/rooms/:roomId"
              element={
                <ProtectedRoute allowedRoles={["lgu_personnel"]}>
                  <LguDashboard />
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
