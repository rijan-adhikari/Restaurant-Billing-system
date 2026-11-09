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
  daily_estimated_cogs: string;
  monthly_estimated_cogs: string;
  yearly_estimated_cogs: string;
  outstanding: string;
  pending_kots: number;
  occupied_tables: number;
}

const emptySummary: Summary = {
  daily_sales: "0", monthly_sales: "0", yearly_sales: "0",
  daily_expenses: "0", monthly_expenses: "0", yearly_expenses: "0",
  daily_profit: "0", monthly_profit: "0", yearly_profit: "0",
  daily_estimated_cogs: "0", monthly_estimated_cogs: "0", yearly_estimated_cogs: "0",
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
    ["Estimated daily profit / loss", summary.daily_profit], ["Estimated monthly profit / loss", summary.monthly_profit], ["Estimated yearly profit / loss", summary.yearly_profit],
    ["Daily estimated COGS", summary.daily_estimated_cogs], ["Monthly estimated COGS", summary.monthly_estimated_cogs], ["Yearly estimated COGS", summary.yearly_estimated_cogs],
    ["Outstanding credit", summary.outstanding], ["Pending KOTs", String(summary.pending_kots)], ["Occupied tables", String(summary.occupied_tables)],
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-end">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Royal Skye · Overview</p><h1 className="mt-1 text-2xl font-bold">Good to see you, {fullName}</h1><p className="text-sm text-neutral-500 capitalize">{role} dashboard · Sales and operations snapshot</p></div>
        <label className="text-sm">Report date<input type="date" className="block border rounded-lg px-3 py-2 mt-1" value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5"><p className="text-sm text-neutral-500">{label}</p><p className={`text-2xl font-semibold mt-1 ${label.toLowerCase().includes("profit") && Number(value) < 0 ? "text-red-700" : ""}`}>Rs. {value}</p></div>)}
      </div>
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {role === "admin" && <section className="bg-white rounded-xl shadow p-5 border border-red-100"><h2 className="font-semibold text-red-800">Clear sales data</h2><p className="text-sm text-neutral-600 mt-1 mb-3">This removes bills, payments, credit balances, and completed/open order state. Menu, customers, staff, and expenses are preserved.</p><div className="flex flex-wrap gap-2"><input className="border rounded-lg px-3 py-2" placeholder="Type CLEAR SALES" value={clearText} onChange={(e) => setClearText(e.target.value)} /><button type="button" onClick={clearSales} className="bg-red-700 text-white rounded-lg px-4 py-2 font-medium">Clear all sales</button></div></section>}
    </div>
  );
}
