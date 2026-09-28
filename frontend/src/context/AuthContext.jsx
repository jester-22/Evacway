import { createContext, useContext, useState } from "react";
import { api } from "../services/api";
import { useNavigate } from "react-router-dom";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem("evacway_user");
    return saved ? JSON.parse(saved) : null;
  });

  const navigate = useNavigate();

  async function login(email, password) {
    const data = await api.login(email, password);
    localStorage.setItem("evacway_token", data.access_token);
    localStorage.setItem("evacway_user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    console.log("LOGOUT FIRING");
    navigate("/");
    console.log("AFTER NAVIGATE, location is:", window.location.pathname);
    localStorage.removeItem("evacway_token");
    localStorage.removeItem("evacway_user");
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
