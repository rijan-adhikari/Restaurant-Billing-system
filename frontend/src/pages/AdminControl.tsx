import React, { useEffect, useState } from "react";
import { api } from "../api/client";

type Tab = "cash" | "refunds" | "suppliers" | "loyalty" | "audit" | "settings";
const tabs: { id: Tab; label: string }[] = [
  { id: "cash", label: "Cash drawer" }, { id: "refunds", label: "Refunds" },
  { id: "suppliers", label: "Supplier ledger" }, { id: "loyalty", label: "Loyalty" },
  { id: "audit", label: "Audit trail" }, { id: "settings", label: "Business settings" },
];
const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const primary = "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const panel = "rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm";
const money = (v: any) => "Rs. " + Number(v || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AdminControl() {
  const [tab, setTab] = useState<Tab>("cash");
  const [data, setData] = useState<any>({ shifts: [], refunds: [], bills: [], suppliers: [], inventory: [], ledger: [], loyalty: [], audit: [] });
  const [shift, setShift] = useState<any>(null);
  const [tax, setTax] = useState<any>({ tax_enabled: true, tax_percent: "14", service_charge_enabled: false, service_charge_percent: "0" });
  const [restaurant, setRestaurant] = useState<any>({ name: "", email: "", phone: "", address: "", pan: "", vat: "", currency: "NPR", logo_path: "", qr_image_path: "", receipt_footer: "" });
  const [loyalty, setLoyalty] = useState<any>({ enabled: true, spend_per_point: "100", point_value: "1" });
  const [openFloat, setOpenFloat] = useState("0");
  const [countedCash, setCountedCash] = useState("");
  const [cashEntry, setCashEntry] = useState({ entry_type: "cash_in", amount: "", reference: "", notes: "" });
  const [refund, setRefund] = useState({ bill_id: "", amount: "", reason: "", method: "cash" });
  const [supplierEntry, setSupplierEntry] = useState({ supplier_id: "", entry_type: "payment", amount: "", reference: "", notes: "" });
  const [supplierReturn, setSupplierReturn] = useState({ supplier_id: "", item_id: "", quantity: "", unit_cost: "", reference: "", notes: "" });
  const [adjustment, setAdjustment] = useState({ customer_id: "", points: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const requests = [
      ["current", "/api/admin/cash-shifts/current"], ["shifts", "/api/admin/cash-shifts"],
      ["refunds", "/api/admin/refunds"], ["bills", "/api/admin/refundable-bills"],
      ["suppliers", "/api/operations/suppliers"], ["inventory", "/api/operations/inventory"], ["ledger", "/api/admin/suppliers/ledger"],
      ["loyalty", "/api/admin/loyalty/accounts"], ["loyaltySettings", "/api/admin/loyalty/settings"],
      ["audit", "/api/admin/audit"], ["customers", "/api/customers"], ["tax", "/api/settings/tax"], ["restaurant", "/api/settings/restaurant"],
    ] as const;
    const results = await Promise.allSettled(requests.map(([, url]) => api.get(url)));
    const next: any = {};
    results.forEach((result, index) => {
      if (result.status === "fulfilled") next[requests[index][0]] = result.value.data;
    });
    setShift(next.current ?? null);
    setData((old: any) => ({ ...old, ...next }));
    if (next.loyaltySettings) setLoyalty(next.loyaltySettings);
    if (next.tax) setTax(next.tax);
    if (next.restaurant) setRestaurant(next.restaurant);
  };

  useEffect(() => { load().catch(() => setError("Could not load administration data.")); }, []);

  const run = async (action: () => Promise<any>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); setMessage(success); await load(); }
    catch (e: any) { setError(e?.response?.data?.detail || "The operation failed. Check the values and try again."); }
    finally { setBusy(false); }
  };

  const openShift = () => run(() => api.post("/api/admin/cash-shifts/open", { opening_float: Number(openFloat) }), "Cash drawer shift opened.");
  const closeShift = () => {
    if (!shift || !countedCash.trim()) return;
    run(() => api.post(`/api/admin/cash-shifts/${shift.id}/close`, { counted_cash: Number(countedCash) }), "Shift closed and variance recorded.");
  };
  const addCashEntry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!shift) return;
    run(() => api.post(`/api/admin/cash-shifts/${shift.id}/entries`, { ...cashEntry, amount: Number(cashEntry.amount) }), "Cash movement recorded.");
    setCashEntry({ entry_type: "cash_in", amount: "", reference: "", notes: "" });
  };
  const createRefund = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api.post("/api/admin/refunds", { ...refund, amount: Number(refund.amount) }), "Refund recorded.");
    setRefund({ bill_id: "", amount: "", reason: "", method: "cash" });
  };
  const addSupplierEntry = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api.post("/api/admin/suppliers/ledger", { ...supplierEntry, amount: Number(supplierEntry.amount) }), "Supplier ledger entry saved.");
    setSupplierEntry({ ...supplierEntry, amount: "", reference: "", notes: "" });
  };
  const returnStockToSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api.post("/api/operations/supplier-returns", {
      ...supplierReturn, quantity: Number(supplierReturn.quantity), unit_cost: Number(supplierReturn.unit_cost),
    }), "Supplier return posted; stock and supplier ledger updated.");
    setSupplierReturn({ supplier_id: "", item_id: "", quantity: "", unit_cost: "", reference: "", notes: "" });
  };
  const adjustPoints = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => api.post("/api/admin/loyalty/adjust", { ...adjustment, points: Number(adjustment.points) }), "Loyalty points adjusted.");
    setAdjustment({ customer_id: "", points: "", notes: "" });
  };
  const saveSettings = async () => {
    await run(async () => {
      await api.put("/api/settings/restaurant", restaurant);
      await api.put("/api/settings/tax", { ...tax, tax_percent: Number(tax.tax_percent), service_charge_percent: Number(tax.service_charge_percent) });
      await api.put("/api/admin/loyalty/settings", { ...loyalty, spend_per_point: Number(loyalty.spend_per_point), point_value: Number(loyalty.point_value) });
    }, "Business settings saved.");
  };

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Royal Skye · Administration</p><h1 className="mt-1 text-3xl font-bold">Control centre</h1><p className="text-sm text-neutral-500">Financial controls, business configuration, customer rewards and accountability.</p></div>
      <button className={primary} disabled={busy} onClick={() => load()}>{busy ? "Working…" : "Refresh"}</button>
    </header>
    {message && <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</p>}
    {error && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <nav className="flex gap-2 overflow-x-auto border-b pb-2">{tabs.map(t => <button key={t.id} onClick={() => setTab(t.id)} className={"shrink-0 rounded-lg px-3 py-2 text-sm font-medium " + (tab === t.id ? "bg-brand text-white" : "bg-white text-neutral-600")}>{t.label}</button>)}</nav>

    {tab === "cash" && <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <section className={panel}>
        <h2 className="font-semibold text-lg">Cash drawer session</h2>
        {shift ? <div className="mt-3 space-y-3">
          <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">OPEN SHIFT · {shift.opened_by_name}</p><p className="mt-1 text-2xl font-bold">{money(shift.expected_cash)}</p><p className="text-xs text-neutral-500">Expected cash in drawer</p></div>
          <form onSubmit={addCashEntry} className="space-y-2">
            <label className="block text-xs">Movement<select className={field} value={cashEntry.entry_type} onChange={e => setCashEntry({ ...cashEntry, entry_type: e.target.value })}><option value="cash_in">Cash in</option><option value="cash_out">Cash out</option><option value="payout">Payout</option></select></label>
            <input required type="number" min="0.01" step="0.01" className={field} placeholder="Amount (NPR)" value={cashEntry.amount} onChange={e => setCashEntry({ ...cashEntry, amount: e.target.value })} />
            <input className={field} placeholder="Reference" value={cashEntry.reference} onChange={e => setCashEntry({ ...cashEntry, reference: e.target.value })} />
            <input className={field} placeholder="Notes" value={cashEntry.notes} onChange={e => setCashEntry({ ...cashEntry, notes: e.target.value })} />
            <button className={primary} disabled={busy}>Record movement</button>
          </form>
          <div className="border-t pt-3 space-y-2"><label className="block text-xs">Counted cash at close<input required type="number" min="0" step="0.01" className={field + " mt-1"} value={countedCash} onChange={e => setCountedCash(e.target.value)} /></label><button className="w-full rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white" disabled={busy || !countedCash} onClick={closeShift}>Close shift & reconcile</button></div>
        </div> : <div className="mt-3 space-y-3"><p className="text-sm text-neutral-500">No drawer session is currently open.</p><label className="block text-xs">Opening float (NPR)<input type="number" min="0" step="0.01" className={field + " mt-1"} value={openFloat} onChange={e => setOpenFloat(e.target.value)} /></label><button className={primary} disabled={busy} onClick={openShift}>Open cash drawer</button></div>}
      </section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Recent shift reconciliation</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Opened</th><th>Staff</th><th>Status</th><th>Expected</th><th>Counted</th><th>Variance</th></tr></thead><tbody>{data.shifts.map((s: any) => <tr key={s.id} className="border-b"><td className="py-2">{new Date(s.opened_at).toLocaleString()}</td><td>{s.opened_by_name}</td><td className="capitalize">{s.status}</td><td>{s.expected_cash == null ? "—" : money(s.expected_cash)}</td><td>{s.counted_cash == null ? "—" : money(s.counted_cash)}</td><td className={Number(s.cash_difference) < 0 ? "text-red-700" : "text-emerald-700"}>{s.cash_difference == null ? "—" : money(s.cash_difference)}</td></tr>)}</tbody></table></div></section>
    </div>}

    {tab === "refunds" && <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Record a refund</h2><form className="space-y-3" onSubmit={createRefund}>
        <label className="block text-xs">Bill<select required className={field + " mt-1"} value={refund.bill_id} onChange={e => setRefund({ ...refund, bill_id: e.target.value })}><option value="">Choose refundable bill</option>{data.bills.map((b: any) => <option key={b.id} value={b.id}>{b.bill_number} · paid {money(b.amount_paid)} · refundable {money(b.refundable_amount)}</option>)}</select></label>
        <input required type="number" min="0.01" step="0.01" className={field} placeholder="Refund amount (NPR)" value={refund.amount} onChange={e => setRefund({ ...refund, amount: e.target.value })} />
        <label className="block text-xs">Refund method<select className={field + " mt-1"} value={refund.method} onChange={e => setRefund({ ...refund, method: e.target.value })}><option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank transfer</option><option value="qr">QR</option></select></label>
        <textarea required minLength={3} className={field} rows={3} placeholder="Reason for refund (required)" value={refund.reason} onChange={e => setRefund({ ...refund, reason: e.target.value })} />
        <button className={primary} disabled={busy}>Save refund</button>
      </form><p className="mt-3 text-xs text-amber-700">Refunds are capped at the bill's paid amount and recorded separately for traceability.</p></section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Refund history</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Date</th><th>Bill</th><th>Reason</th><th>Method</th><th>Amount</th><th>By</th></tr></thead><tbody>{data.refunds.map((r: any) => <tr key={r.id} className="border-b"><td className="py-2">{new Date(r.created_at).toLocaleString()}</td><td>{r.bill_number}</td><td>{r.reason}</td><td className="capitalize">{r.method}</td><td>{money(r.amount)}</td><td>{r.refunded_by}</td></tr>)}</tbody></table></div></section>
    </div>}

    {tab === "suppliers" && <div className="grid gap-4 lg:grid-cols-2">
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Supplier payment / credit adjustment</h2><form onSubmit={addSupplierEntry} className="space-y-3">
        <label className="block text-xs">Supplier<select required className={field + " mt-1"} value={supplierEntry.supplier_id} onChange={e => setSupplierEntry({ ...supplierEntry, supplier_id: e.target.value })}><option value="">Choose supplier</option>{data.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs">Entry type<select className={field + " mt-1"} value={supplierEntry.entry_type} onChange={e => setSupplierEntry({ ...supplierEntry, entry_type: e.target.value })}><option value="payment">Payment made</option><option value="return">Purchase return credit</option><option value="adjustment">Balance adjustment</option></select></label>
        <input required type="number" min="0.01" step="0.01" className={field} placeholder="Amount (NPR)" value={supplierEntry.amount} onChange={e => setSupplierEntry({ ...supplierEntry, amount: e.target.value })} />
        <input className={field} placeholder="Reference / voucher" value={supplierEntry.reference} onChange={e => setSupplierEntry({ ...supplierEntry, reference: e.target.value })} />
        <textarea className={field} rows={2} placeholder="Notes" value={supplierEntry.notes} onChange={e => setSupplierEntry({ ...supplierEntry, notes: e.target.value })} />
        <button className={primary} disabled={busy}>Post supplier entry</button>
      </form><p className="mt-3 text-xs text-neutral-500">Received purchases are posted as supplier liabilities. Payments and credit adjustments are tracked here.</p></section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Return stock to supplier</h2><form onSubmit={returnStockToSupplier} className="space-y-3">
        <label className="block text-xs">Supplier<select required className={field + " mt-1"} value={supplierReturn.supplier_id} onChange={e => setSupplierReturn({ ...supplierReturn, supplier_id: e.target.value })}><option value="">Choose supplier</option>{data.suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="block text-xs">Stock item<select required className={field + " mt-1"} value={supplierReturn.item_id} onChange={e => setSupplierReturn({ ...supplierReturn, item_id: e.target.value })}><option value="">Choose item</option>{data.inventory.map((i: any) => <option key={i.id} value={i.id}>{i.name} · {i.quantity} {i.unit} available</option>)}</select></label>
        <div className="grid grid-cols-2 gap-2"><input required type="number" min="0.001" step="0.001" className={field} placeholder="Quantity" value={supplierReturn.quantity} onChange={e => setSupplierReturn({ ...supplierReturn, quantity: e.target.value })} /><input required type="number" min="0" step="0.01" className={field} placeholder="Unit cost" value={supplierReturn.unit_cost} onChange={e => setSupplierReturn({ ...supplierReturn, unit_cost: e.target.value })} /></div>
        <input className={field} placeholder="Reference / supplier credit note" value={supplierReturn.reference} onChange={e => setSupplierReturn({ ...supplierReturn, reference: e.target.value })} />
        <textarea className={field} rows={2} placeholder="Reason / notes" value={supplierReturn.notes} onChange={e => setSupplierReturn({ ...supplierReturn, notes: e.target.value })} />
        <button className={primary} disabled={busy}>Return stock & update ledger</button>
      </form><p className="mt-3 text-xs text-amber-700">The system checks on-hand quantity, deducts returned stock and records the supplier credit in one transaction.</p></section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Supplier ledger</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Date</th><th>Supplier</th><th>Type</th><th>Reference</th><th>Amount</th></tr></thead><tbody>{data.ledger.map((l: any) => <tr key={l.id} className="border-b"><td className="py-2">{new Date(l.created_at).toLocaleString()}</td><td>{l.supplier_name}</td><td className="capitalize">{l.entry_type}</td><td>{l.reference || "—"}</td><td>{money(l.amount)}</td></tr>)}</tbody></table></div></section>
    </div>}

    {tab === "loyalty" && <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Manual points adjustment</h2><form onSubmit={adjustPoints} className="space-y-3">
        <label className="block text-xs">Customer<select required className={field + " mt-1"} value={adjustment.customer_id} onChange={e => setAdjustment({ ...adjustment, customer_id: e.target.value })}><option value="">Choose customer</option>{(data.customers || []).map((c: any) => <option key={c.id} value={c.id}>{c.name} {c.phone || ""}</option>)}</select></label>
        <input required type="number" step="1" className={field} placeholder="Points (+/-)" value={adjustment.points} onChange={e => setAdjustment({ ...adjustment, points: e.target.value })} />
        <textarea required minLength={3} className={field} rows={2} placeholder="Reason" value={adjustment.notes} onChange={e => setAdjustment({ ...adjustment, notes: e.target.value })} />
        <button className={primary} disabled={busy}>Adjust points</button>
      </form></section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Customer rewards balances</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Customer</th><th>Phone</th><th>Available points</th><th>Lifetime points</th></tr></thead><tbody>{data.loyalty.map((a: any) => <tr key={a.id} className="border-b"><td className="py-2">{a.name}</td><td>{a.phone || "—"}</td><td className="font-semibold">{a.points_balance}</td><td>{a.lifetime_points}</td></tr>)}</tbody></table></div></section>
    </div>}

    {tab === "audit" && <section className={panel}><h2 className="font-semibold text-lg mb-3">Recent administrative activity</h2><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left text-xs text-neutral-500"><th className="py-2">Time</th><th>User</th><th>Action</th><th>Details</th></tr></thead><tbody>{data.audit.map((a: any) => <tr key={a.id} className="border-b"><td className="py-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td><td>{a.full_name || a.username || "System"}</td><td>{a.action}</td><td>{a.details}</td></tr>)}</tbody></table></div></section>}

    {tab === "settings" && <div className="grid gap-4 lg:grid-cols-2">
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Restaurant identity & receipt</h2><div className="space-y-3">
        {(["name","email","phone","address","pan","vat","currency","logo_path","qr_image_path","receipt_footer"] as const).map(k => <label key={k} className="block text-xs capitalize">{k.replaceAll("_"," ")}{k === "address" || k === "receipt_footer" ? <textarea rows={2} className={field + " mt-1"} value={restaurant[k] || ""} onChange={e => setRestaurant({ ...restaurant, [k]: e.target.value })} /> : <input className={field + " mt-1"} value={restaurant[k] || ""} onChange={e => setRestaurant({ ...restaurant, [k]: e.target.value })} />}</label>)}
      </div></section>
      <section className={panel}><h2 className="font-semibold text-lg mb-3">Tax, service charge & loyalty rules</h2><div className="space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!tax.tax_enabled} onChange={e => setTax({ ...tax, tax_enabled: e.target.checked })} /> Enable VAT / tax</label>
        <label className="block text-xs">Tax percent<input type="number" min="0" max="100" step="0.01" className={field + " mt-1"} value={tax.tax_percent} onChange={e => setTax({ ...tax, tax_percent: e.target.value })} /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!tax.service_charge_enabled} onChange={e => setTax({ ...tax, service_charge_enabled: e.target.checked })} /> Enable service charge</label>
        <label className="block text-xs">Service charge percent<input type="number" min="0" max="100" step="0.01" className={field + " mt-1"} value={tax.service_charge_percent} onChange={e => setTax({ ...tax, service_charge_percent: e.target.value })} /></label>
        <div className="border-t pt-3"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!loyalty.enabled} onChange={e => setLoyalty({ ...loyalty, enabled: e.target.checked })} /> Enable customer loyalty</label>
        <label className="block text-xs mt-2">Spend required for 1 point (NPR)<input type="number" min="1" step="0.01" className={field + " mt-1"} value={loyalty.spend_per_point} onChange={e => setLoyalty({ ...loyalty, spend_per_point: e.target.value })} /></label>
        <label className="block text-xs mt-2">Value per point (NPR)<input type="number" min="0" step="0.01" className={field + " mt-1"} value={loyalty.point_value} onChange={e => setLoyalty({ ...loyalty, point_value: e.target.value })} /></label></div>
        <button className={primary} disabled={busy} onClick={saveSettings}>Save all business settings</button>
      </div></section>
    </div>}
  </div>;
}
