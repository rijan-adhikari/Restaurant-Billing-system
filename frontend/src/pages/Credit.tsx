import React, { useEffect, useState } from "react";
import { api } from "../api/client";

interface Balance { id: string; bill_id: string; original_amount: string; remaining_amount: string; created_at: string; }
interface CreditCustomer { customer_id: string; name: string; phone?: string | null; total_due: string; balances: Balance[]; }

export default function Credit() {
  const [search, setSearch] = useState("");
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [repayAmounts, setRepayAmounts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const response = await api.get(`/api/credit?search=${encodeURIComponent(search)}`);
    setCustomers(response.data);
    if (selectedId && !response.data.some((customer: CreditCustomer) => customer.customer_id === selectedId)) setSelectedId(null);
  };

  useEffect(() => {
    load().catch(() => setError("Could not load credit accounts."));
  }, [search]);

  const repay = async (balanceId: string) => {
    const amount = Number(repayAmounts[balanceId]);
    if (!amount || amount <= 0) return;
    try {
      await api.post("/api/outstanding/repay", { customer_balance_id: balanceId, amount });
      setRepayAmounts((current) => ({ ...current, [balanceId]: "" }));
      setMessage("Credit payment recorded.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not record payment.");
    }
  };

  const selected = customers.find((customer) => customer.customer_id === selectedId);
  const formatDateTime = (value: string) => new Date(value).toLocaleString();

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold mb-1">Credit</h1>
      <p className="text-neutral-500 mb-5">Search customers and record due payments.</p>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <section className="bg-white rounded-xl shadow p-5">
          <input className="w-full border rounded-lg px-3 py-2 mb-4" placeholder="Search customer by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="space-y-2">
            {customers.map((customer) => <button type="button" key={customer.customer_id} onClick={() => setSelectedId(customer.customer_id)} className={`w-full text-left border rounded-lg p-3 ${selectedId === customer.customer_id ? "border-brand bg-green-50" : ""}`}><div className="flex justify-between gap-2"><span className="font-medium">{customer.name}</span><span className="font-semibold">Rs. {customer.total_due}</span></div><p className="text-xs text-neutral-500">{customer.phone || "No phone"}</p></button>)}
            {customers.length === 0 && <p className="text-sm text-neutral-500">No matching customers.</p>}
          </div>
        </section>
        <section className="bg-white rounded-xl shadow p-5">
          {!selected && <p className="text-sm text-neutral-500">Select a customer to view credit details.</p>}
          {selected && <div><div className="flex flex-wrap justify-between gap-3 border-b pb-4 mb-4"><div><h2 className="font-semibold text-lg">{selected.name}</h2><p className="text-sm text-neutral-500">{selected.phone || "No phone"} · Customer ID: {selected.customer_id}</p></div><p className="font-semibold text-lg">Due: Rs. {selected.total_due}</p></div>{selected.balances.length === 0 && <p className="text-sm text-neutral-500">This customer has no outstanding credit.</p>}<div className="space-y-4">{selected.balances.map((balance) => <div key={balance.id} className="border rounded-lg p-4"><div className="flex flex-wrap justify-between gap-2 text-sm"><span>Bill: {balance.bill_id}</span><span>{formatDateTime(balance.created_at)}</span></div><p className="text-sm mt-2">Original credit: Rs. {balance.original_amount}</p><p className="font-semibold">Remaining due: Rs. {balance.remaining_amount}</p><div className="flex gap-2 mt-3"><input type="number" min="0" step="0.01" placeholder="Payment amount" className="border rounded-lg px-3 py-2" value={repayAmounts[balance.id] || ""} onChange={(e) => setRepayAmounts((current) => ({ ...current, [balance.id]: e.target.value }))} /><button type="button" onClick={() => repay(balance.id)} className="bg-brand text-white rounded-lg px-3 py-2">Record payment</button></div></div>)}</div></div>}
          {message && <p className="text-sm text-green-700 mt-4">{message}</p>}
          {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
        </section>
      </div>
    </div>
  );
}
