import React, { Suspense, lazy, useState } from "react";
import { Routes, Route, Navigate, Link, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { useLanguage } from "./context/LanguageContext";
import ProtectedRoute from "./components/ProtectedRoute";
const Login = lazy(() => import("./pages/Login"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Tables = lazy(() => import("./pages/Tables"));
const POS = lazy(() => import("./pages/POS"));
const Billing = lazy(() => import("./pages/Billing"));
const Credit = lazy(() => import("./pages/Credit"));
const Operations = lazy(() => import("./pages/Operations"));

function Shell({ children }: { children: React.ReactNode }) {
  const { fullName, role, logout } = useAuth();
  const { language, setLanguage, t } = useLanguage();
  const location = useLocation();
  const [logoAvailable, setLogoAvailable] = useState(true);

  const nav = [
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/dashboard", label: t("Dashboard") }] : []),
    { to: "/tables", label: t("Tables / POS") },
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/billing", label: t("Billing") }] : []),
    ...(["admin", "manager", "cashier"].includes(role || "") ? [{ to: "/credit", label: t("Credit") }] : []),
    ...(["admin", "manager"].includes(role || "") ? [{ to: "/operations", label: t("Restaurant Operations") }] : []),
  ];

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#f5f6f8]">
      <aside className="w-full md:w-60 md:min-h-screen bg-brand-dark text-white flex flex-col p-4 md:p-5 shadow-xl md:sticky md:top-0 md:self-start">
        <div className="flex items-center gap-2 font-semibold mb-1">
          {logoAvailable && <img src="/images/logo.png" alt="" className="w-8 h-8 object-contain rounded-full" onError={() => setLogoAvailable(false)} />}
          <span>Royal Skye Birds</span>
        </div>
        <div className="text-xs text-white/60 mb-4 md:mb-7">{fullName} · <span className="capitalize">{role}</span></div>
        <nav className="flex flex-row md:flex-col gap-1 overflow-x-auto md:overflow-visible flex-1">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={`shrink-0 px-3 py-2.5 rounded-xl text-sm transition-colors ${
                location.pathname === n.to ? "bg-white/10" : "hover:bg-white/5"
              }`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={logout} className="mt-3 md:mt-6 shrink-0 rounded-xl border border-white/15 px-3 py-2.5 text-sm text-white/75 hover:bg-white/10 hover:text-white text-left">
          {t("Log out")}
        </button>
      </aside>
      <main className="relative min-w-0 flex-1 p-4 md:p-7 overflow-hidden flex flex-col">
        {logoAvailable && <div className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center"><img src="/images/logo.png" alt="" className="max-w-[42%] max-h-[42%] object-contain rounded-full opacity-[0.035]" onError={() => setLogoAvailable(false)} /></div>}
        <div className="relative z-10 flex-1 w-full"><div className="flex justify-end mb-4"><label className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm shadow-sm"><span className="text-neutral-500">{t("Language")}</span><select aria-label="Select language" className="bg-transparent font-medium outline-none" value={language} onChange={(event) => setLanguage(event.target.value as "en" | "ne")}><option value="en">English</option><option value="ne">नेपाली</option></select></label></div>{children}</div>
        <footer className="relative z-10 text-center text-[11px] tracking-[0.18em] text-neutral-400 pt-8">ROYAL SKYE · DEVELOPED BY RIJAN ADHIKARI</footer>
      </main>
    </div>
  );
}

export default function App() {
  const { token } = useAuth();

  return (
    <Suspense fallback={<div className="min-h-[40vh] flex items-center justify-center text-sm text-neutral-500">Loading...</div>}><Routes>
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
        path="/operations"
        element={
          <ProtectedRoute allowedRoles={["admin", "manager"]}>
            <Shell><Operations /></Shell>
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to={token ? "/dashboard" : "/login"} />} />
    </Routes></Suspense>
  );
}
