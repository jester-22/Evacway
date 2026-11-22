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

  function logout() {
    queryClient.clear();
    localStorage.removeItem("evacway_token");
    localStorage.removeItem("evacway_user");
    setUser(null);
    navigate("/", { replace: true });
  }

  function updateUser(updatedUser) {
    localStorage.setItem("evacway_user", JSON.stringify(updatedUser));
    setUser(updatedUser);
  }

  return (
    <AuthContext.Provider value={{ user, loginResident, loginStaff, completeStaffLogin, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
