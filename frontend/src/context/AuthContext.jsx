import { createContext, useContext, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../services/api";
import { useNavigate } from "react-router-dom";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("evacway_user");
    return saved ? JSON.parse(saved) : null;
  });

  const navigate = useNavigate();
  const queryClient = useQueryClient();

  async function login(email, password) {
    const data = await api.login(email, password);
    const sameAccount = user && data.user && (
      user.id != null && data.user.id != null
        ? String(user.id) === String(data.user.id)
        : user.email?.trim().toLowerCase() === data.user.email?.trim().toLowerCase()
    );
    if (!sameAccount) queryClient.clear();
    localStorage.setItem("evacway_token", data.access_token);
    localStorage.setItem("evacway_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    console.log("LOGOUT FIRING");
    queryClient.clear();
    navigate("/");
    console.log("AFTER NAVIGATE, location is:", window.location.pathname);
    localStorage.removeItem("evacway_token");
    localStorage.removeItem("evacway_user");
    setUser(null);
  }

  function updateUser(updatedUser) {
    localStorage.setItem("evacway_user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
