import { createContext, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useNavigate } from "react-router-dom";

function isJwtExpired(token) {
  if (!token || typeof token !== "string") return true;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(window.atob(padded));
    if (typeof payload.exp === "number" && Date.now() >= payload.exp * 1000) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

const DEFAULT_AUTH_CONTEXT = {
  user: null,
  loginResident: async () => null,
  loginStaff: async () => null,
  completeStaffLogin: () => null,
  logout: () => {},
  clearSession: () => {},
  updateUser: () => {},
};

// Preserve the same Context identity across Vite HMR updates so consumers
// never read a stale/null default context during dev reloads.
const AuthContext =
  (import.meta.hot && import.meta.hot.data && import.meta.hot.data.AuthContext) ||
  createContext(DEFAULT_AUTH_CONTEXT);

if (import.meta.hot) {
  import.meta.hot.data.AuthContext = AuthContext;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      const saved = localStorage.getItem("evacway_user");
      const token = localStorage.getItem("evacway_token");
      if (!saved || !token || isJwtExpired(token)) {
        localStorage.removeItem("evacway_token");
        localStorage.removeItem("evacway_user");
        return null;
      }
      return JSON.parse(saved);
    } catch {
      localStorage.removeItem("evacway_token");
      localStorage.removeItem("evacway_user");
      return null;
    }
  });

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    function handleAuthExpired() {
      const wasStaff = user?.role === "admin" || user?.role === "lgu_personnel";
      queryClient.clear();
      localStorage.removeItem("evacway_token");
      localStorage.removeItem("evacway_user");
      setUser(null);
      navigate(wasStaff ? "/login" : "/", { replace: true });
    }
    window.addEventListener("evacway:auth-expired", handleAuthExpired);
    return () => window.removeEventListener("evacway:auth-expired", handleAuthExpired);
  }, [navigate, queryClient, user?.role]);

  function saveLoginSession(data) {
    const sameAccount = Boolean(
      user &&
      data.user &&
      user.role === data.user.role &&
      (user.id != null && data.user.id != null
        ? String(user.id) === String(data.user.id)
        : user.email?.trim().toLowerCase() === data.user.email?.trim().toLowerCase())
    );
    if (!sameAccount) queryClient.clear();
    localStorage.setItem("evacway_token", data.access_token);
    localStorage.setItem("evacway_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function loginResident(email, password) {
    return saveLoginSession(await api.residentLogin(email, password));
  }

  async function loginStaff(email, password) {
    const response = await api.staffLogin(email, password);
    return response.access_token ? saveLoginSession(response) : response;
  }

  function completeStaffLogin(response) {
    return saveLoginSession(response);
  }

  function clearSession() {
    queryClient.clear();
    localStorage.removeItem("evacway_token");
    localStorage.removeItem("evacway_user");
    setUser(null);
  }

  function logout() {
    clearSession();
    navigate("/", { replace: true });
  }

  function updateUser(updatedUser) {
    localStorage.setItem("evacway_user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider value={{ user, loginResident, loginStaff, completeStaffLogin, logout, clearSession, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext) || DEFAULT_AUTH_CONTEXT;
}
