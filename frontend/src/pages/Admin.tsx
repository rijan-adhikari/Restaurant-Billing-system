import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../context/LanguageContext";

interface Category { id: string; name: string; }
interface Staff { id: string; username: string; full_name: string; role: string; is_active: boolean; }
interface Customer { id: string; name: string; phone?: string | null; }
interface Expense { id: string; category: string; description: string; amount: string; expense_date: string; }
interface CustomerHistory {
  customer_id: string;
  name: string;
  phone?: string | null;
  total_spent: string;
  visit_count: number;
  bills: Array<{
    id: string;
    bill_number: string;
    created_at: string;
    table_name: string;
    grand_total: string;
    amount_paid: string;
    outstanding_amount: string;
    items: Array<{ name: string; quantity: number; unit_price: string; total: string }>;
  }>;
}
const staffRoles = ["admin", "manager", "waiter", "cashier", "kitchen", "bar"] as const;

export default function Admin() {
  const { t } = useLanguage();
  const [categories, setCategories] = useState<Category[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [expenseForm, setExpenseForm] = useState({ category: "General", description: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) });
  const [history, setHistory] = useState<CustomerHistory[]>([]);
  const [historyCustomerId, setHistoryCustomerId] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [staffForm, setStaffForm] = useState({ username: "", full_name: "", password: "", role: "waiter" });
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; password: string } | null>(null);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [categoryResponse, itemResponse, staffResponse, customerResponse, expenseResponse] = await Promise.all([
      api.get("/api/categories"),
      api.get("/api/users"),
      api.get("/api/customers"),
      api.get("/api/expenses"),
    ]);
    setCategories(categoryResponse.data);
    setStaff(staffResponse.data);
    setCustomers(customerResponse.data);
    setExpenses(expenseResponse.data);
  };

  const searchHistory = async () => {
    setHistoryLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (historyCustomerId) params.set("customer_id", historyCustomerId);
      if (historyFrom) params.set("date_from", historyFrom);
      if (historyTo) params.set("date_to", historyTo);
      const response = await api.get(`/api/customers/history?${params.toString()}`);
      setHistory(response.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not load customer history.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const formatDateTime = (value: string) => new Date(value).toLocaleString();

  const addStaff = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setCreatedCredentials(null);
    try {
      await api.post("/api/users", staffForm);
      setCreatedCredentials({ username: staffForm.username, password: staffForm.password });
      setStaffForm({ username: "", full_name: "", password: "", role: "waiter" });
      setMessage("Staff account created. Save the temporary password now; it cannot be recovered later.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not create staff account.");
    }
  };

  const addExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    try {
      await api.post("/api/expenses", { ...expenseForm, amount: Number(expenseForm.amount), expense_date: `${expenseForm.expense_date}T00:00:00` });
      setExpenseForm({ category: "General", description: "", amount: "", expense_date: new Date().toISOString().slice(0, 10) });
      setMessage("Expense added.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not add expense.");
    }
  };

  const deleteExpense = async (id: string) => {
    if (!window.confirm("Delete this expense? This action is recorded in the audit log.")) return;
    try { await api.delete(`/api/expenses/${id}`); setMessage("Expense deleted."); await load(); }
    catch (e: any) { setError(e?.response?.data?.detail || "Could not delete expense."); }
  };


  const removeAllDishes = async () => {
    if (!window.confirm(t("Remove every dish from the POS menu? Categories and past order history will be kept."))) return;
    try {
      const response = await api.delete("/api/menu-items");
      setMessage(t("All dishes have been removed. Categories are still available.") + ` ${response.data?.removed ?? 0} removed, ${response.data?.archived ?? 0} historical items hidden.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not remove dishes.");
    }
  };

  const deleteCategory = async (category: Category) => {
    if (!window.confirm(`Delete category "${category.name}"? Categories containing food items cannot be deleted.`)) return;
    try {
      await api.delete(`/api/categories/${category.id}`);
      setMessage("Category deleted.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not delete category.");
    }
  };

  const deleteCustomer = async (customer: Customer) => {
    if (!window.confirm(`Delete customer "${customer.name}"? Customers with bill or credit history are protected.`)) return;
    try {
      await api.delete(`/api/customers/${customer.id}`);
      setMessage("Customer deleted.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not delete customer.");
    }
  };

  const changePassword = async (userId: string) => {
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await api.patch(`/api/users/${userId}/password`, { password: newPassword });
      setPasswordUserId(null);
      setNewPassword("");
      setError("");
      setMessage("Password changed. The user must use the new password at next login.");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not change password.");
    }
  };

  const updateStaff = async (userId: string, changes: { role?: string; is_active?: boolean }) => {
    try {
      await api.patch(`/api/users/${userId}`, changes);
      setMessage("Staff account updated.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not update staff account.");
    }
  };

  const removeStaff = async (userId: string) => {
    if (!window.confirm("Remove this user account? The account will be disabled.")) return;
    try {
      await api.delete(`/api/users/${userId}`);
      setMessage("User account removed.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not remove user.");
    }
  };

  useEffect(() => {
    load().catch(() => setError("Could not load menu data."));
  }, []);


  const addCategory = async () => {
    if (!categoryName.trim()) return;
    try {
      await api.post("/api/categories", { name: categoryName.trim() });
      setCategoryName("");
      setMessage("Category added.");
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not add category.");
    }
  };


  return (
    <div className="max-w-6xl flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t("Master Panel")}</h1>
        <p className="text-sm text-neutral-500 mt-1">{t("Manage categories, staff, customers, and expenses.")}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      </div>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-4">{t("Staff accounts")}</h2>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form onSubmit={addStaff} className="space-y-3">
            <input required placeholder={t("Username")} className="w-full border rounded-lg px-3 py-2" value={staffForm.username} onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })} />
            <input required placeholder={t("Full name")} className="w-full border rounded-lg px-3 py-2" value={staffForm.full_name} onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })} />
            <input required minLength={8} type="password" placeholder={t("Temporary password (8+ characters)")} className="w-full border rounded-lg px-3 py-2" value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
            <select className="w-full border rounded-lg px-3 py-2" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}>
              {staffRoles.map((role) => <option key={role} value={role}>{t(role)}</option>)}
            </select>
            <button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-medium">{t("Add staff account")}</button>
            {createdCredentials && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm"><p className="font-medium">{t("Temporary login")}</p><p>{t("Username:")} {createdCredentials.username}</p><p>{t("Password:")} {createdCredentials.password}</p><p className="text-xs text-amber-800 mt-1">This password is shown once and is not stored for display.</p></div>}
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b"><th className="py-2">{t("Name")}</th><th>{t("Username")}</th><th>{t("Role")}</th><th>{t("Status")}</th><th>{t("Actions")}</th></tr></thead>
              <tbody>{staff.map((member) => <tr key={member.id} className="border-b last:border-0"><td className="py-2">{member.full_name}</td><td>{member.username}</td><td><select className="border rounded px-2 py-1 capitalize" value={member.role} onChange={(e) => updateStaff(member.id, { role: e.target.value })}>{staffRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></td><td><button type="button" onClick={() => updateStaff(member.id, { is_active: !member.is_active })} className={member.is_active ? "text-emerald-700" : "text-red-700"}>{member.is_active ? t("Active · disable") : t("Inactive · enable")}</button></td><td><div className="flex gap-2"><button type="button" onClick={() => { setPasswordUserId(member.id); setNewPassword(""); }} className="text-brand">{t("Change password")}</button><button type="button" onClick={() => removeStaff(member.id)} className="text-red-700">{t("Disable")}</button></div>{passwordUserId === member.id && <div className="flex gap-2 mt-2"><input type="password" minLength={8} placeholder={t("New password")} className="border rounded px-2 py-1" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><button type="button" onClick={() => changePassword(member.id)} className="bg-brand text-white rounded px-2 py-1">{t("Save")}</button></div>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="font-semibold">{t("Categories")}</h2>
            <p className="text-sm text-neutral-500 mt-1">{t("Keep your categories ready. Dishes can be added later when needed.")}</p>
          </div>
          <button type="button" onClick={removeAllDishes} className="rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50">{t("Remove all dishes")}</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <input className="min-w-0 flex-1 border rounded-lg px-3 py-2" placeholder={t("New category name")} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} />
          <button type="button" onClick={addCategory} className="border border-brand text-brand rounded-lg px-4 py-2 text-sm font-medium">{t("Add category")}</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {categories.map((category) => <span key={category.id} className="inline-flex items-center gap-2 rounded-lg bg-neutral-100 px-3 py-2 text-sm">{category.name}<button type="button" aria-label={`Delete ${category.name}`} onClick={() => deleteCategory(category)} className="font-medium text-red-700">{t("Delete")}</button></span>)}
          {categories.length === 0 && <p className="text-sm text-neutral-500">{t("No categories yet. Add your first category above.")}</p>}
        </div>
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-4">{t("Expenses")}</h2>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form onSubmit={addExpense} className="space-y-3">
            <input required placeholder={t("Category")} className="w-full border rounded-lg px-3 py-2" value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
            <input required placeholder={t("Description")} className="w-full border rounded-lg px-3 py-2" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
            <input required min="0" step="0.01" type="number" placeholder={t("Amount")} className="w-full border rounded-lg px-3 py-2" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
            <input required type="date" className="w-full border rounded-lg px-3 py-2" value={expenseForm.expense_date} onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} />
            <button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-medium">{t("Add expense")}</button>
          </form>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2">{t("Date")}</th><th>{t("Category")}</th><th>{t("Description")}</th><th>{t("Amount")}</th><th /></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id} className="border-b last:border-0"><td className="py-2">{formatDateTime(expense.expense_date)}</td><td>{expense.category}</td><td>{expense.description}</td><td>Rs. {expense.amount}</td><td><button type="button" onClick={() => deleteExpense(expense.id)} className="text-red-700">{t("Delete")}</button></td></tr>)}</tbody></table>{expenses.length === 0 && <p className="text-sm text-neutral-500 mt-3">{t("No expenses recorded.")}</p>}</div>
        </div>
      </section>

      {(message || error) && <div className="rounded-lg bg-white p-4 shadow-sm">{message && <p className="text-sm text-green-700">{message}</p>}{error && <p className="text-sm text-red-600">{error}</p>}</div>}

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-3">{t("Customer records")}</h2>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">{t("Name")}</th><th>{t("Phone")}</th><th>{t("Actions")}</th></tr></thead><tbody>{customers.map((customer) => <tr key={customer.id} className="border-b last:border-0"><td className="py-2">{customer.name}</td><td>{customer.phone || "—"}</td><td><button type="button" onClick={() => deleteCustomer(customer)} className="text-red-700">{t("Delete")}</button></td></tr>)}</tbody></table>{customers.length === 0 && <p className="mt-3 text-sm text-neutral-500">{t("No customer records.")}</p>}</div>
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-1">{t("Customer history")}</h2>
        <p className="text-sm text-neutral-500 mb-4">{t("See what each customer ordered and spent during a selected date range.")}</p>
        <div className="grid gap-3 md:grid-cols-4 items-end">
          <label className="text-sm">{t("Customer")}
            <select className="w-full border rounded-lg px-3 py-2 mt-1" value={historyCustomerId} onChange={(e) => setHistoryCustomerId(e.target.value)}>
              <option value="">{t("All customers")}</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` - ${customer.phone}` : ""}</option>)}
            </select>
          </label>
          <label className="text-sm">{t("From date")}<input type="date" className="w-full border rounded-lg px-3 py-2 mt-1" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} /></label>
          <label className="text-sm">{t("To date")}<input type="date" className="w-full border rounded-lg px-3 py-2 mt-1" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} /></label>
          <button type="button" onClick={searchHistory} className="bg-brand text-white rounded-lg px-4 py-2 font-medium">{historyLoading ? t("Loading...") : t("Search history")}</button>
        </div>
        <div className="mt-5 space-y-4">
          {history.map((customer) => (
            <div key={customer.customer_id} className="border rounded-lg p-4">
              <div className="flex flex-wrap justify-between gap-2 mb-3"><div><p className="font-medium">{customer.name}</p><p className="text-xs text-neutral-500">{customer.phone || "No phone"} · ID: {customer.customer_id}</p></div><p className="text-sm font-semibold">Total spent: Rs. {customer.total_spent} · {customer.visit_count} visit(s)</p></div>
              <div className="space-y-3">{customer.bills.map((bill) => <div key={bill.id} className="border-t pt-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><span>{bill.bill_number} · Table {bill.table_name} · {formatDateTime(bill.created_at)}</span><span className="font-medium">Rs. {bill.grand_total}</span></div><div className="text-neutral-600">{bill.items.map((item) => `${item.quantity} x ${item.name} (Rs. ${item.unit_price})`).join(", ")}</div><div className="text-xs text-neutral-500">Paid: Rs. {bill.amount_paid} · Outstanding: Rs. {bill.outstanding_amount}</div></div>)}</div>
            </div>
          ))}
          {history.length === 0 && <p className="text-sm text-neutral-500">Choose filters and click Search history to view customer visits.</p>}
        </div>
      </section>
    </div>
  );
}
