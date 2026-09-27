import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";

interface Summary {
  daily_sales: string;
  monthly_sales: string;
  yearly_sales: string;
  daily_expenses: string;
  monthly_expenses: string;
  yearly_expenses: string;
  daily_profit: string;
  monthly_profit: string;
  yearly_profit: string;
  outstanding: string;
  pending_kots: number;
  occupied_tables: number;
}

const emptySummary: Summary = {
  daily_sales: "0", monthly_sales: "0", yearly_sales: "0",
  daily_expenses: "0", monthly_expenses: "0", yearly_expenses: "0",
  daily_profit: "0", monthly_profit: "0", yearly_profit: "0",
  outstanding: "0", pending_kots: 0, occupied_tables: 0,
};

export default function Dashboard() {
  const { fullName, role } = useAuth();
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [clearText, setClearText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = () => api.get(`/api/dashboard/summary?report_date=${reportDate}`).then((response) => setSummary(response.data));

  useEffect(() => {
    load().catch(() => setError("Could not load dashboard metrics."));
  }, [reportDate]);

  const clearSales = async () => {
    if (clearText !== "CLEAR SALES") {
      setError("Type CLEAR SALES exactly to continue.");
      return;
    }
    if (!window.confirm("This permanently removes all bills, payments, and credit balances. Continue?")) return;
    try {
      await api.delete("/api/dashboard/sales");
      setClearText("");
      setMessage("Sales data cleared.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not clear sales data.");
    }
  };

  const cards = [
    ["Daily sales", summary.daily_sales], ["Monthly sales", summary.monthly_sales], ["Yearly sales", summary.yearly_sales],
    ["Daily expenses", summary.daily_expenses], ["Monthly expenses", summary.monthly_expenses], ["Yearly expenses", summary.yearly_expenses],
    ["Daily profit / loss", summary.daily_profit], ["Monthly profit / loss", summary.monthly_profit], ["Yearly profit / loss", summary.yearly_profit],
    ["Outstanding credit", summary.outstanding], ["Pending KOTs", String(summary.pending_kots)], ["Occupied tables", String(summary.occupied_tables)],
  ];

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-end">
        <div><h1 className="text-2xl font-semibold mb-1">Welcome, {fullName}</h1><p className="text-neutral-500 capitalize">{role} dashboard</p></div>
        <label className="text-sm">Report date<input type="date" className="block border rounded-lg px-3 py-2 mt-1" value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map(([label, value]) => <div key={label} className="bg-white rounded-xl shadow p-5"><p className="text-sm text-neutral-500">{label}</p><p className={`text-2xl font-semibold mt-1 ${label.includes("profit") && Number(value) < 0 ? "text-red-700" : ""}`}>Rs. {value}</p></div>)}
      </div>
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {role === "admin" && <section className="bg-white rounded-xl shadow p-5 border border-red-100"><h2 className="font-semibold text-red-800">Clear sales data</h2><p className="text-sm text-neutral-600 mt-1 mb-3">This removes bills, payments, credit balances, and completed/open order state. Menu, customers, staff, and expenses are preserved.</p><div className="flex flex-wrap gap-2"><input className="border rounded-lg px-3 py-2" placeholder="Type CLEAR SALES" value={clearText} onChange={(e) => setClearText(e.target.value)} /><button type="button" onClick={clearSales} className="bg-red-700 text-white rounded-lg px-4 py-2 font-medium">Clear all sales</button></div></section>}
    </div>
  );
}
