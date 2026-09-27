import React, { useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Tables from "./pages/Tables";
import POS from "./pages/POS";
import Kitchen from "./pages/Kitchen";
import Bar from "./pages/Bar";
import Billing from "./pages/Billing";
import Admin from "./pages/Admin";
import Credit from "./pages/Credit";

function Shell({ children }: { children: React.ReactNode }) {
  const { fullName, role, logout } = useAuth();
  const location = useLocation();
  const [logoAvailable, setLogoAvailable] = useState(true);

  const nav = [
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/dashboard", label: "Dashboard" }] : []),
    { to: "/tables", label: "Tables / POS" },
    ...(["admin", "manager"].includes(role || "") ? [{ to: "/kitchen", label: "Kitchen" }, { to: "/bar", label: "Bar" }] : []),
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/billing", label: "Billing" }] : []),
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/credit", label: "Credit" }] : []),
    ...(role === "admin" ? [{ to: "/admin", label: "Master Panel" }] : []),
  ];

  return (
    <div className="min-h-screen flex">
      <aside className="w-56 bg-brand-dark text-white flex flex-col p-4">
        <div className="flex items-center gap-2 font-semibold mb-1">
          {logoAvailable && <img src="/images/logo.png" alt="" className="w-8 h-8 object-contain rounded-full" onError={() => setLogoAvailable(false)} />}
          <span>Royal Skye Birds</span>
        </div>
        <div className="text-xs text-white/60 mb-6">{fullName} - {role}</div>
        <nav className="flex-1 space-y-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`block px-3 py-2 rounded-lg text-sm ${
                location.pathname === n.to ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="text-sm text-white/70 hover:text-white text-left">
          Log out
        </button>
      </aside>
      <main className="relative flex-1 p-6 bg-neutral-100 overflow-hidden flex flex-col">
        {logoAvailable && <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"><img src="/images/logo.png" alt="" className="max-w-[42%] max-h-[42%] object-contain rounded-full opacity-75" onError={() => setLogoAvailable(false)} /></div>}
        <div className="relative z-10 flex-1">{children}</div>
        <footer className="relative z-10 text-center text-xs text-neutral-500 pt-6">DEVELOPED BY RIJAN ADHIKARI</footer>
      </main>
    </div>
  );
}

export default function App() {
  const { token } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/dashboard" /> : <Login />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager", "cashier"]}>
            <Shell><Dashboard /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/tables"
        element={
          <ProtectedRoute>
            <Shell><Tables /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pos"
        element={
          <ProtectedRoute>
            <Shell><POS /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/kitchen"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager", "kitchen"]}>
            <Shell><Kitchen /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/bar"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager", "bar"]}>
            <Shell><Bar /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/billing"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager", "cashier"]}>
            <Shell><Billing /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/credit"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager", "cashier"]}>
            <Shell><Credit /></Shell>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute allowedRoles={["admin"]}>
            <Shell><Admin /></Shell>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to={token ? "/dashboard" : "/login"} />} />
    </Routes>
  );
}
