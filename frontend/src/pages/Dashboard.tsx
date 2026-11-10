import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { useLanguage } from "../context/LanguageContext";

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
  const { t } = useLanguage();
  const [reportDate, setReportDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Summary>(emptySummary);
  const [clearText, setClearText] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [dailySales, setDailySales] = useState<any[]>([]);
  const [showDailySales, setShowDailySales] = useState(false);
  const [salesLoading, setSalesLoading] = useState(false);

  const load = () => api.get(`/api/dashboard/summary?report_date=${reportDate}`).then((response) => setSummary(response.data));

  useEffect(() => {
    load().catch(() => setError("Could not load dashboard metrics."));
    api.get("/api/dashboard/low-stock").then((response) => setLowStockItems(response.data)).catch(() => setLowStockItems([]));
  }, [reportDate, role]);

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

  const openDailySales = async () => {
    setShowDailySales(true);
    setSalesLoading(true);
    try {
      const response = await api.get(`/api/dashboard/daily-sales?report_date=${reportDate}`);
      setDailySales(response.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not load daily sales details.");
    } finally {
      setSalesLoading(false);
    }
  };

  const downloadDashboardPdf = async () => {
    try {
      const response = await api.get(`/api/dashboard/summary.pdf?report_date=${reportDate}`, { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dashboard-${reportDate}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not download dashboard PDF.");
    }
  };

  const cards = [
    [t("Daily sales"), summary.daily_sales], [t("Monthly sales"), summary.monthly_sales], [t("Yearly sales"), summary.yearly_sales],
    [t("Daily expenses"), summary.daily_expenses], [t("Monthly expenses"), summary.monthly_expenses], [t("Yearly expenses"), summary.yearly_expenses],
    [t("Estimated daily profit / loss"), summary.daily_profit], [t("Estimated monthly profit / loss"), summary.monthly_profit], [t("Estimated yearly profit / loss"), summary.yearly_profit],
    [t("Daily estimated COGS"), summary.daily_estimated_cogs], [t("Monthly estimated COGS"), summary.monthly_estimated_cogs], [t("Yearly estimated COGS"), summary.yearly_estimated_cogs],
    [t("Outstanding credit"), summary.outstanding], [t("Pending KOTs"), String(summary.pending_kots)], [t("Occupied tables"), String(summary.occupied_tables)],
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap justify-between gap-3 items-end">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">{t("Royal Skye · Overview")}</p><h1 className="mt-1 text-2xl font-bold">{t("Good to see you,")} {fullName}</h1><p className="text-sm text-neutral-500 capitalize">{role} · {t("Sales and operations snapshot")}</p></div>
        <div className="flex flex-wrap items-end gap-2"><label className="text-sm">{t("Report date")}<input type="date" className="block border rounded-lg px-3 py-2 mt-1" value={reportDate} onChange={(e) => setReportDate(e.target.value)} /></label><button type="button" onClick={downloadDashboardPdf} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white">{t("Download dashboard PDF")}</button></div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {cards.map(([label, value]) => label === t("Daily sales") ? <button type="button" key={label} onClick={openDailySales} className="rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm hover:border-brand md:p-5"><p className="text-sm text-neutral-500">{label} · {t("View details")}</p><p className="text-2xl font-semibold mt-1">Rs. {value}</p></button> : label === t("Daily expenses") ? <Link key={label} to="/operations?tab=expenses" className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm hover:border-brand md:p-5"><p className="text-sm text-neutral-500">{label} · {t("View details")}</p><p className="text-2xl font-semibold mt-1">Rs. {value}</p></Link> : <div key={label} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5"><p className="text-sm text-neutral-500">{label}</p><p className={`text-2xl font-semibold mt-1 ${label.toLowerCase().includes("profit") && Number(value) < 0 ? "text-red-700" : ""}`}>Rs. {value}</p></div>)}
      </div>
      {(role === "admin" || role === "manager") && <div className="grid gap-3 sm:grid-cols-2">
        <Link to="/operations?tab=inventory" className="rounded-xl border bg-white p-4 shadow-sm hover:border-brand"><p className="font-semibold">{t("Inventory")}</p><p className="text-sm text-neutral-500">{t("Open stock register and manage stock levels")}</p></Link>
        <Link to="/operations?tab=expenses" className="rounded-xl border bg-white p-4 shadow-sm hover:border-brand"><p className="font-semibold">{t("Expenses")}</p><p className="text-sm text-neutral-500">{t("Open expense register and record expenses")}</p></Link>
      </div>}
      {lowStockItems.length > 0 && <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-amber-900">{t("Low stock alert")}</h2><span className="rounded-full bg-amber-200 px-3 py-1 text-sm font-semibold text-amber-900">{lowStockItems.length}</span></div>
        <p className="mt-1 text-sm text-amber-900">{t("These items are at or below their reorder level. This alert appears whenever you open the dashboard until stock is replenished.")}</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{lowStockItems.map((item) => <div key={item.id} className="rounded-lg border border-amber-200 bg-white p-3 text-sm"><p className="font-semibold">{item.name}</p><p>{t("On hand")}: {item.quantity} {item.unit}</p><p>{t("Reorder")}: {item.reorder_level} {item.unit}</p></div>)}</div>
        <Link to="/operations?tab=inventory" className="mt-3 inline-block text-sm font-semibold text-amber-900 underline">{t("Open inventory")}</Link>
      </section>}
      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {showDailySales && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3" onClick={() => setShowDailySales(false)}>
        <section className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{t("Daily sales details")}</h2><p className="text-sm text-neutral-500">{reportDate}</p></div><button type="button" onClick={() => setShowDailySales(false)} className="rounded-lg border px-3 py-2">{t("Close")}</button></div>
          {salesLoading ? <p className="py-8 text-center">{t("Loading...")}</p> : dailySales.length === 0 ? <p className="py-8 text-center text-sm text-neutral-500">{t("No sales recorded for this date.")}</p> : <div className="mt-4 space-y-4">{dailySales.map((bill) => <article key={bill.id} className="rounded-xl border p-4"><div className="flex flex-wrap justify-between gap-2"><div><p className="font-semibold">{bill.bill_number} · {bill.customer_name}</p><p className="text-xs text-neutral-500">{bill.customer_phone || t("No phone")} · {bill.table_name} · {new Date(bill.created_at).toLocaleString()}</p></div><div className="text-right text-sm"><p className="font-semibold">Rs. {bill.grand_total}</p><p className="text-neutral-500">{t("Paid")}: Rs. {bill.amount_paid} · {t("Outstanding")}: Rs. {bill.outstanding_amount}</p></div></div><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">{t("Food")}</th><th>{t("Quantity")}</th><th>{t("Price")}</th><th>{t("Total")}</th></tr></thead><tbody>{bill.items.map((item: any, index: number) => <tr key={index} className="border-b last:border-0"><td className="py-2">{item.name}</td><td>{item.quantity}</td><td>Rs. {item.unit_price}</td><td>Rs. {item.total}</td></tr>)}</tbody></table></div></article>)}</div>}
        </section>
      </div>}
      {role === "admin" && <section className="bg-white rounded-xl shadow p-5 border border-red-100"><h2 className="font-semibold text-red-800">{t("Clear sales data")}</h2><p className="text-sm text-neutral-600 mt-1 mb-3">{t("This removes bills, payments, credit balances, and completed/open order state. Menu, customers, staff, and expenses are preserved.")}</p><div className="flex flex-wrap gap-2"><input className="border rounded-lg px-3 py-2" placeholder={t("Type CLEAR SALES")} value={clearText} onChange={(e) => setClearText(e.target.value)} /><button type="button" onClick={clearSales} className="bg-red-700 text-white rounded-lg px-4 py-2 font-medium">{t("Clear all sales")}</button></div></section>}
    </div>
  );
}
