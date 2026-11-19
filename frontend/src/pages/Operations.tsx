import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, apiErrorMessage } from "../api/client";
import { useLanguage } from "../context/LanguageContext";
import { useAuth } from "../context/AuthContext";
import AdminControl from "./AdminControl";

type Tab = "inventory" | "recipes" | "expenses" | "reports" | "staff" | "reservations" | "cash" | "loyalty";
const tabs: Tab[] = ["expenses", "inventory", "recipes", "reports", "cash", "loyalty", "staff", "reservations"];
const units = ["kg", "g", "litre", "ml", "dozen", "pcs", "bottle", "packet", "box"];
const field = "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm";
const button = "rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white";
const money = (n: any) => "Rs. " + Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

export default function Operations() {
  const { t } = useLanguage();
  const { role } = useAuth();
  const visibleTabs = role === "admin" ? tabs : tabs.filter((item) => item !== "staff");
  const [tab, setTab] = useState<Tab>("expenses");
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const requested = searchParams.get("tab") as Tab | null;
    if (requested && visibleTabs.includes(requested)) setTab(requested);
  }, [searchParams, role]);
  const [data, setData] = useState<any>({ inventory: [], recipes: [], expenses: [], staff: [], attendance: [], payroll: [], reservations: [], menuItems: [], tables: [] });
  const [report, setReport] = useState<any>(null);
  const [start, setStart] = useState(today().slice(0, 7) + "-01");
  const [end, setEnd] = useState(today());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stock, setStock] = useState({ name: "", unit: "kg", quantity: "0", reorder_level: "0", total_cost: "0", expiry_date: "" });
  const [recipe, setRecipe] = useState({ menu_item_id: "", items: [{ item_id: "", quantity: "1" }], yield_quantity: "1", instructions: "" });
  const [expense, setExpense] = useState({ description: "", amount: "" });
  const [reservation, setReservation] = useState({ customer_name: "", phone: "", party_size: "2", reserved_for: "", table_id: "", notes: "" });
  const [movement, setMovement] = useState({ item_id: "", movement_type: "waste", quantity: "", notes: "" });
  const [payrollForm, setPayrollForm] = useState({ user_id: "", period_start: today().slice(0, 8) + "01", period_end: today(), gross_pay: "", deductions: "0", notes: "" });

  const load = async () => {
    const requests: [string, string][] = [
      ["inventory", "/api/operations/inventory"], ["recipes", "/api/operations/recipes"],
      ["expenses", "/api/operations/expenses"], ["reservations", "/api/operations/reservations"],
      ["menuItems", "/api/menu-items"], ["tables", "/api/tables"],
      ...(role === "admin" ? ([["staff", "/api/users"], ["attendance", "/api/operations/staff/attendance"], ["payroll", "/api/operations/staff/payroll"]] as [string, string][]) : []),
    ];
    const results = await Promise.allSettled(requests.map(([, url]) => api.get(url)));
    setData((old: any) => {
      const next = { ...old };
      results.forEach((result, index) => { if (result.status === "fulfilled") next[requests[index][0]] = result.value.data; });
      return next;
    });
  };
  useEffect(() => { load().catch(() => setError("Could not load operations data.")); }, []);
  const run = async (fn: () => Promise<any>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await fn(); setMessage(t(success)); await load(); }
    catch (e: any) { setError(t(apiErrorMessage(e, "Restaurant operations request failed"))); }
    finally { setBusy(false); }
  };
  const cashoutPayroll = async (p: any) => {
    const remaining = Number(p.remaining_balance ?? (Number(p.gross_pay) - Number(p.deductions)));
    const amountText = window.prompt("Remaining salary: " + money(remaining) + "\nEnter amount to cash out (NPR):", String(remaining));
    if (amountText === null) return;
    const amount = Number(amountText);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      setError("Enter a valid amount within the remaining salary balance.");
      return;
    }
    const notes = window.prompt("Cash-out notes (optional):", "");
    if (notes === null) return;
    await run(() => api.post("/api/operations/staff/payroll/" + p.id + "/cashout", {
      amount, payment_date: today(), notes
    }), "Salary cash-out recorded.");
  };
  const deletePayroll = async (p: any) => {
    if (!window.confirm("Delete payroll record for " + p.full_name + " (" + money(Number(p.gross_pay)-Number(p.deductions)) + ")? This cannot be undone.")) return;
    await run(() => api.delete("/api/operations/staff/payroll/" + p.id), "Payroll record deleted.");
  };
  const lowStock = data.inventory.filter((x: any) => x.low_stock);
  const input = (label: string, value: string, change: (v: string) => void, type = "text", required = true) => <label className="block text-xs font-medium text-neutral-600">{t(label)}<input className={field + " mt-1"} type={type} required={required} value={value} onChange={(e) => change(e.target.value)} /></label>;
  const panel = "rounded-xl border border-neutral-200 bg-white p-4 shadow-sm";
  const heading = (title: string, subtitle: string) => <div className="mb-4"><h2 className="text-lg font-semibold">{t(title)}</h2><p className="text-sm text-neutral-500">{t(subtitle)}</p></div>;

  return <div className="mx-auto max-w-7xl space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-widest text-brand">{t("Royal Skye · Management Suite")}</p><h1 className="mt-1 text-2xl font-bold">{t("Restaurant Operations")}</h1><p className="text-sm text-neutral-500">{t("Expenses, inventory, recipes, reports and staff operations.")}</p></div><button className={button} disabled={busy} onClick={() => load()}>{busy ? t("Working...") : t("Refresh data")}</button></header>
    {message && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">{[["Expenses recorded", data.expenses.length], ["Total expenses", money(data.expenses.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0))], ["Stock items", data.inventory.length], ["Low stock", lowStock.length]].map((x) => <div className={panel} key={x[0]}><p className="text-xs text-neutral-500">{t(x[0])}</p><p className="mt-1 text-2xl font-bold">{x[1]}</p></div>)}</div>
    <nav className="flex gap-2 overflow-x-auto border-b pb-2">{visibleTabs.map((tabName) => <button key={tabName} onClick={() => setTab(tabName)} className={"shrink-0 rounded-lg px-3 py-2 text-sm font-medium capitalize " + (tab === tabName ? "bg-brand text-white" : "bg-white text-neutral-600")}>{t(tabName)}</button>)}</nav>

    {tab === "inventory" && <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <section className={panel}>{heading("Add stock item", "Enter the item, expiry, cost and stock quantity.")}<form className="space-y-3" onSubmit={(e) => {
        e.preventDefault();
        const quantity = Number(stock.quantity);
        const totalCost = Number(stock.total_cost);
        if (quantity === 0 && totalCost > 0) {
          setError(t("Enter a quantity greater than zero when total cost is provided."));
          return;
        }
        run(async () => {
          await api.post("/api/operations/inventory", {
            name: stock.name,
            sku: null,
            category: "General",
            unit: stock.unit,
            quantity,
            reorder_level: Number(stock.reorder_level),
            average_cost: quantity > 0 ? totalCost / quantity : 0,
            supplier_id: null,
            expiry_date: stock.expiry_date || null,
          });
        }, "Inventory item created.");
      }}>
        {input("Item name", stock.name, (v) => setStock({ ...stock, name: v }))}
        {input("Expiry date", stock.expiry_date, (v) => setStock({ ...stock, expiry_date: v }), "date", false)}
        <label className="block text-xs font-medium text-neutral-600">{t("Total cost (NPR)")}<input className={field + " mt-1"} type="number" min="0" step="0.01" required value={stock.total_cost} onChange={(e) => setStock({ ...stock, total_cost: e.target.value })} /></label>
        <div className="grid grid-cols-2 gap-2"><label className="block text-xs font-medium text-neutral-600">{t("Unit")}<select className={field + " mt-1"} value={stock.unit} onChange={(e) => setStock({ ...stock, unit: e.target.value })}><option value="kg">kg</option><option value="g">{t("Gram (g)")}</option><option value="litre">{t("Litre")}</option><option value="pcs">{t("Pieces (pcs)")}</option></select></label><label className="block text-xs font-medium text-neutral-600">{t("Quantity")}<input className={field + " mt-1"} type="number" min="0" step="any" required value={stock.quantity} onChange={(e) => setStock({ ...stock, quantity: e.target.value })} /></label></div>
        <label className="block text-xs font-medium text-neutral-600">{t("Reorder level")}<input className={field + " mt-1"} type="number" min="0" step="any" required value={stock.reorder_level} onChange={(e) => setStock({ ...stock, reorder_level: e.target.value })} /></label>
        <button className={button} disabled={busy}>{t("Add item")}</button>
      </form></section>
      <section className={panel}>{heading("Stock register", "Quantity, valuation and low-stock alerts.")}{lowStock.length > 0 && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{lowStock.length} {t("item(s) at or below reorder level.")}</p>}
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-neutral-500"><th className="py-2">{t("Item name")}</th><th>{t("Quantity")}</th><th>{t("Reorder level")}</th><th>{t("Total cost (NPR)")}</th><th>{t("Expiry date")}</th><th>{t("Status")}</th></tr></thead><tbody>{data.inventory.map((i: any) => <tr key={i.id} className="border-b"><td className="py-3 font-medium">{i.name}</td><td>{i.quantity} {i.unit}</td><td>{i.reorder_level} {i.unit}</td><td>{money(i.stock_value)}</td><td>{i.expiry_date || "—"}</td><td className={i.low_stock ? "text-amber-700" : "text-emerald-700"}>{i.low_stock ? t("Low") : t("OK")}</td></tr>)}</tbody></table></div>
        <form className="mt-4 grid gap-2 rounded-lg bg-neutral-50 p-3 md:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => api.post("/api/operations/inventory/" + movement.item_id + "/movements", { ...movement, quantity: Number(movement.quantity) }), "Stock movement recorded."); }}>
          <select className={field} required value={movement.item_id} onChange={(e) => setMovement({ ...movement, item_id: e.target.value })}><option value="">{t("Select item")}</option>{data.inventory.map((i: any) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
          <select className={field} value={movement.movement_type} onChange={(e) => setMovement({ ...movement, movement_type: e.target.value })}><option value="waste">{t("Wastage")}</option><option value="consumption">{t("Consumption")}</option><option value="return">{t("Return")}</option><option value="adjustment">{t("Stock count adjustment")}</option></select>
          <input className={field} type="number" min={movement.movement_type === "adjustment" ? "0" : "0.001"} step="0.001" required placeholder={movement.movement_type === "adjustment" ? t("Counted stock quantity") : t("Quantity")} value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: e.target.value })} /><button className={button}>{t("Record movement")}</button>
        </form>
      </section>
    </div>}

    {tab === "recipes" && <div className="grid gap-4 lg:grid-cols-[380px_1fr]"><section className={panel}>{heading("Recipe builder", "Build a complete ingredient list for each menu item.")}<form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api.post("/api/operations/recipes", { menu_item_id: recipe.menu_item_id, yield_quantity: Number(recipe.yield_quantity), instructions: recipe.instructions, items: recipe.items.filter((line) => line.item_id && Number(line.quantity) > 0).map((line) => ({ item_id: line.item_id, quantity: Number(line.quantity) })) }), "Recipe saved."); }}><label className="block text-xs">{t("Menu item")}<select className={field} required value={recipe.menu_item_id} onChange={(e) => setRecipe({ ...recipe, menu_item_id: e.target.value })}><option value="">{t("Choose menu item")}</option>{data.menuItems.map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>{recipe.items.map((line, index) => <div key={index} className="grid grid-cols-[1fr_110px_auto] gap-2 items-end"><label className="block text-xs">{t("Ingredient")}<select className={field} required value={line.item_id} onChange={(e) => setRecipe({ ...recipe, items: recipe.items.map((x, i) => i === index ? { ...x, item_id: e.target.value } : x) })}><option value="">{t("Choose ingredient")}</option>{data.inventory.map((i: any) => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}</select></label><label className="block text-xs">{t("Quantity")}<input className={field} type="number" min="0.001" step="0.001" required value={line.quantity} onChange={(e) => setRecipe({ ...recipe, items: recipe.items.map((x, i) => i === index ? { ...x, quantity: e.target.value } : x) })} /></label><button type="button" className="rounded-lg border px-3 py-2 text-sm" disabled={recipe.items.length === 1} onClick={() => setRecipe({ ...recipe, items: recipe.items.filter((_, i) => i !== index) })}>{t("Remove")}</button></div>)}<button type="button" className="rounded-lg border px-3 py-2 text-sm" onClick={() => setRecipe({ ...recipe, items: [...recipe.items, { item_id: "", quantity: "1" }] })}>{t("+ Add ingredient")}</button>{input("Yield quantity", recipe.yield_quantity, (v) => setRecipe({ ...recipe, yield_quantity: v }), "number")}{input("Instructions", recipe.instructions, (v) => setRecipe({ ...recipe, instructions: v }), "text", false)}<button className={button}>{t("Save recipe")}</button></form><p className="mt-3 text-xs text-neutral-500">{t("Configured recipe ingredients are deducted automatically when the bill is finalized. Stock is checked before the bill is committed.")}</p></section><section className={panel}>{heading("Recipe costs", "Calculated from current average ingredient cost.")}{data.recipes.map((r: any) => <div key={r.id} className="border-b py-3"><div className="flex justify-between"><b>{r.menu_item_name}</b><b>{money(r.recipe_cost)}</b></div><p className="text-xs text-neutral-500">{t("Yield:")} {r.yield_quantity}</p><p className="mt-1 text-xs">{(r.ingredients || []).map((i: any) => i.item_name + ": " + i.quantity + " " + i.unit).join(" · ")}</p></div>)}</section></div>}

    {tab === "expenses" && <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <section className={panel}>{heading("Add expense", "Record purchases and other restaurant expenses in one place.")}<form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post("/api/operations/expenses", { category: "General", description: expense.description.trim(), amount: Number(expense.amount), expense_date: today() + "T12:00:00", department: "General", payment_status: "paid", supplier_id: null, receipt_reference: null, notes: null }); setExpense({ description: "", amount: "" }); }, "Expense recorded."); }}>
        {input("Item name", expense.description, (v) => setExpense({ ...expense, description: v }))}
        {input("Price (NPR)", expense.amount, (v) => setExpense({ ...expense, amount: v }), "number")}
        <button className={button} disabled={busy || !expense.description.trim() || !expense.amount || Number(expense.amount) <= 0}>{t("Add expense")}</button>
      </form></section>
      <section className={panel}>{heading("Expenses dashboard", "All recorded purchases and expenses.")}<div className="mb-3 rounded-lg bg-neutral-50 p-4"><p className="text-xs text-neutral-500">{t("Total recorded expenses")}</p><p className="text-2xl font-bold text-red-700">{money(data.expenses.reduce((sum: number, item: any) => sum + Number(item.amount || 0), 0))}</p></div>
        {data.expenses.length === 0 ? <p className="py-6 text-center text-sm text-neutral-500">{t("No expenses recorded yet.")}</p> : data.expenses.map((item: any) => <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-3 text-sm"><div><p className="font-medium">{item.description || item.category}</p><p className="text-xs text-neutral-500">{item.expense_date?.slice(0, 10) || "—"}</p></div><strong className="text-red-700">{money(item.amount)}</strong></div>)}
      </section>
    </div>}

    {tab === "reports" && <section className={panel}>{heading("Profit & loss", "Net sales, estimated recipe-based COGS and operating expenses.")}<div className="flex flex-wrap items-end gap-3"><label className="text-xs">{t("From")}<input className={field} type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label className="text-xs">{t("To")}<input className={field} type="date" value={end} onChange={(e) => setEnd(e.target.value)} /></label><button className={button} onClick={() => run(async () => { const r = await api.get("/api/operations/reports/profit-loss", { params: { start, end } }); setReport(r.data); }, "Report generated.")}>{t("Generate report")}</button><a className="rounded-lg border px-4 py-2 text-sm" href={api.defaults.baseURL + "/api/operations/reports/stock.csv"} target="_blank" rel="noreferrer">{t("Export stock CSV")}</a></div>{report && <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Net sales", report.net_sales], ["Estimated COGS", report.cost_of_goods_sold_estimate], ["Estimated gross profit", report.gross_profit_estimate], ["Estimated operating profit", report.operating_profit_estimate]].map((x) => <div key={x[0]} className="rounded-lg bg-neutral-50 p-4"><p className="text-xs text-neutral-500">{t(x[0])}</p><p className="text-xl font-bold">{money(x[1])}</p></div>)}<p className="col-span-full rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{report.note}</p></div>}</section>}

    {tab === "cash" && <AdminControl visibleTabs={["cash"]} embedded />}
    {tab === "loyalty" && <AdminControl visibleTabs={["loyalty"]} embedded />}
    {role === "admin" && tab === "staff" && <div className="grid gap-4 lg:grid-cols-2"><section className={panel}>{heading("Attendance", "Clock staff in and out.")}<div className="flex gap-2"><select id="staff-clock" className={field}><option value="">{t("Select staff")}</option>{data.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select><button className={button} onClick={() => { const id = (document.getElementById("staff-clock") as HTMLSelectElement).value; if (id) run(() => api.post("/api/operations/staff/clock-in", { user_id: id }), "Clocked in."); }}>{t("Clock in")}</button></div>{data.attendance.map((a: any) => <div key={a.id} className="flex justify-between border-b py-3 text-sm"><span>{a.full_name} · {new Date(a.clock_in).toLocaleString()}</span>{!a.clock_out && <button className="text-brand" onClick={() => run(() => api.post("/api/operations/staff/" + a.id + "/clock-out"), "Clocked out.")}>{t("Clock out")}</button>}</div>)}</section><section className={panel}>{heading("Payroll register", "Record salary periods, partial cash-outs and remaining balances.")}<form className="grid gap-2 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => api.post("/api/operations/staff/payroll", { ...payrollForm, gross_pay: Number(payrollForm.gross_pay), deductions: Number(payrollForm.deductions) }), "Payroll entry created."); }}><label className="block text-xs">{t("Staff member")}<select className={field} required value={payrollForm.user_id} onChange={(e) => setPayrollForm({ ...payrollForm, user_id: e.target.value })}><option value="">{t("Select staff")}</option>{data.staff.map((s: any) => <option key={s.id} value={s.id}>{s.full_name}</option>)}</select></label>{input("Gross salary (NPR)", payrollForm.gross_pay, (v) => setPayrollForm({ ...payrollForm, gross_pay: v }), "number")}{input("Period start", payrollForm.period_start, (v) => setPayrollForm({ ...payrollForm, period_start: v }), "date")}{input("Period end", payrollForm.period_end, (v) => setPayrollForm({ ...payrollForm, period_end: v }), "date")}{input("Deductions (NPR)", payrollForm.deductions, (v) => setPayrollForm({ ...payrollForm, deductions: v }), "number")}{input("Notes", payrollForm.notes, (v) => setPayrollForm({ ...payrollForm, notes: v }), "text", false)}<div className="sm:col-span-2"><button className={button} disabled={busy}>{t("Create payroll record")}</button></div></form><div className="mt-5">{data.payroll.map((p: any) => <div key={p.id} className="border-b py-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-medium">{p.full_name}</p><p className="text-xs text-neutral-500">{p.period_start} {t("to")} {p.period_end} · {t("Gross")} {money(p.gross_pay)} · {t("Deductions")} {money(p.deductions)}</p><p className="font-semibold">{money(Number(p.gross_pay)-Number(p.deductions))} {t("net")} · Paid {money(p.total_paid)} · Remaining {money(p.remaining_balance)} {Number(p.remaining_balance)<=0 ? "· Fully paid" : "· Balance due"}</p></div><div className="flex gap-2">{Number(p.remaining_balance)>0 && <button disabled={busy} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white" onClick={() => cashoutPayroll(p)}>{t("Cash out")}</button>}<button disabled={busy || (p.payments || []).length>0} title={(p.payments || []).length>0 ? "Cannot delete a payroll record with payment history" : "Delete payroll record"} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-40" onClick={() => deletePayroll(p)}>{t("Delete")}</button></div></div>{(p.payments || []).length>0 && <div className="mt-2 rounded-lg bg-neutral-50 p-2"><p className="mb-1 text-xs font-semibold text-neutral-600">Cash-out history</p>{p.payments.map((payment: any) => <p key={payment.id} className="text-xs text-neutral-600">{payment.payment_date} · {money(payment.amount)}{payment.notes ? " · "+payment.notes : ""}</p>)}</div>}</div>)}</div></section></div>}

    {tab === "reservations" && <div className="grid gap-4 lg:grid-cols-[340px_1fr]"><section className={panel}>{heading("Book a table", "Create a future reservation.")}<form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api.post("/api/operations/reservations", { ...reservation, table_id: reservation.table_id || null, party_size: Number(reservation.party_size), reserved_for: new Date(reservation.reserved_for).toISOString() }), "Reservation created."); }}>{input("Customer name", reservation.customer_name, (v) => setReservation({ ...reservation, customer_name: v }))}{input("Phone", reservation.phone, (v) => setReservation({ ...reservation, phone: v }), "text", false)}{input("Party size", reservation.party_size, (v) => setReservation({ ...reservation, party_size: v }), "number")}{input("Date and time", reservation.reserved_for, (v) => setReservation({ ...reservation, reserved_for: v }), "datetime-local")}<label className="block text-xs">{t("Assign table (optional)")}<select className={field} value={reservation.table_id} onChange={(e) => setReservation({ ...reservation, table_id: e.target.value })}><option value="">{t("No table assigned")}</option>{data.tables.map((t: any) => <option key={t.id} value={t.id}>{t.name} · {t.capacity} seats</option>)}</select></label><button className={button}>{t("Create reservation")}</button></form></section><section className={panel}>{heading("Reservations", "Upcoming and recent bookings.")}{data.reservations.map((r: any) => <div key={r.id} className="flex flex-wrap justify-between border-b py-3 text-sm"><span>{r.customer_name} · {r.party_size} guests · {new Date(r.reserved_for).toLocaleString()}</span><select className="rounded border p-1" value={r.status} onChange={(e) => run(() => api.patch("/api/operations/reservations/" + r.id + "/status", null, { params: { status: e.target.value } }), "Reservation updated.")}><option value="booked">{t("Booked")}</option><option value="seated">{t("Seated")}</option><option value="completed">{t("Completed")}</option><option value="cancelled">{t("Cancelled")}</option></select></div>)}</section></div>}
  </div>;
}
