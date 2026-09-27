import React, { createContext, useContext, useState } from "react";
import { api } from "../api/client";

type Role = "admin" | "manager" | "waiter" | "cashier" | "kitchen" | "bar";

interface AuthState {
  token: string | null;
  role: Role | null;
  fullName: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem("token"));
  const [role, setRole] = useState<Role | null>(localStorage.getItem("role") as Role | null);
  const [fullName, setFullName] = useState<string | null>(localStorage.getItem("fullName"));

  const login = async (username: string, password: string) => {
    const form = new URLSearchParams();
    form.append("username", username);
    form.append("password", password);
    const res = await api.post("/api/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    localStorage.setItem("token", res.data.access_token);
    localStorage.setItem("role", res.data.role);
    localStorage.setItem("fullName", res.data.full_name);
    setToken(res.data.access_token);
    setRole(res.data.role);
    setFullName(res.data.full_name);
  };

  const logout = () => {
    localStorage.clear();
    setToken(null);
    setRole(null);
    setFullName(null);
  };

  return (
    <AuthContext.Provider value={{ token, role, fullName, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
