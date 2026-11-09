import React, { useEffect, useState } from "react";
import { api } from "../api/client";

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
interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description: string;
  price: string;
  destination: "kitchen" | "bar";
  is_available: boolean;
}

type MenuForm = Omit<MenuItem, "id">;

const emptyForm: MenuForm = {
  category_id: "",
  name: "",
  description: "",
  price: "",
  destination: "kitchen",
  is_available: true,
};

const staffRoles = ["admin", "manager", "waiter", "cashier", "kitchen", "bar"] as const;

export default function Admin() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({});
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
  const [showMenu, setShowMenu] = useState(false);
  const [passwordUserId, setPasswordUserId] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [form, setForm] = useState<MenuForm>(emptyForm);
  const [categoryName, setCategoryName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    const [categoryResponse, itemResponse, staffResponse, customerResponse, expenseResponse] = await Promise.all([
      api.get("/api/categories"),
      api.get("/api/menu-items"),
      api.get("/api/users"),
      api.get("/api/customers"),
      api.get("/api/expenses"),
    ]);
    setCategories(categoryResponse.data);
    setItems(itemResponse.data);
    setStaff(staffResponse.data);
    setCustomers(customerResponse.data);
    setExpenses(expenseResponse.data);
    setForm((current) => ({ ...current, category_id: current.category_id || categoryResponse.data[0]?.id || "" }));
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
    if (!window.confirm("Delete this expense?")) return;
    await api.delete(`/api/expenses/${id}`);
    await load();
  };

  const changePassword = async (userId: string) => {
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters.");
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

  const updateForm = (field: keyof MenuForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

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

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      const payload = { ...form, price: Number(form.price) };
      if (editingId) {
        await api.patch(`/api/menu-items/${editingId}`, payload);
        setMessage("Food item updated.");
      } else {
        await api.post("/api/menu-items", payload);
        setMessage("Food item added to the menu.");
      }
      setEditingId(null);
      setForm({ ...emptyForm, category_id: categories[0]?.id || "" });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save food item.");
    }
  };

  const edit = (item: MenuItem) => {
    setEditingId(item.id);
    setForm({
      category_id: item.category_id,
      name: item.name,
      description: item.description,
      price: item.price,
      destination: item.destination,
      is_available: item.is_available,
    });
    setMessage("");
  };

  const savePrice = async (item: MenuItem) => {
    const price = Number(priceDrafts[item.id] ?? item.price);
    if (!Number.isFinite(price) || price < 0) {
      setError("Enter a valid non-negative price.");
      return;
    }
    try {
      await api.patch(`/api/menu-items/${item.id}`, {
        category_id: item.category_id,
        name: item.name,
        description: item.description,
        price,
        destination: item.destination,
        is_available: item.is_available,
      });
      setMessage(`${item.name} price updated.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not update price.");
    }
  };

  return (
    <div className="max-w-6xl flex flex-col space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Master Panel</h1>
        <p className="text-sm text-neutral-500 mt-1">Manage food, prices, routing, and availability.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      </div>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-4">Staff accounts</h2>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form onSubmit={addStaff} className="space-y-3">
            <input required placeholder="Username" className="w-full border rounded-lg px-3 py-2" value={staffForm.username} onChange={(e) => setStaffForm({ ...staffForm, username: e.target.value })} />
            <input required placeholder="Full name" className="w-full border rounded-lg px-3 py-2" value={staffForm.full_name} onChange={(e) => setStaffForm({ ...staffForm, full_name: e.target.value })} />
            <input required minLength={8} type="password" placeholder="Temporary password (8+ characters)" className="w-full border rounded-lg px-3 py-2" value={staffForm.password} onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })} />
            <select className="w-full border rounded-lg px-3 py-2" value={staffForm.role} onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}>
              {staffRoles.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}
            </select>
            <button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-medium">Add staff account</button>
            {createdCredentials && <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm"><p className="font-medium">Temporary login</p><p>Username: {createdCredentials.username}</p><p>Password: {createdCredentials.password}</p><p className="text-xs text-amber-800 mt-1">This password is shown once and is not stored for display.</p></div>}
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b"><th className="py-2">Name</th><th>Username</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{staff.map((member) => <tr key={member.id} className="border-b last:border-0"><td className="py-2">{member.full_name}</td><td>{member.username}</td><td><select className="border rounded px-2 py-1 capitalize" value={member.role} onChange={(e) => updateStaff(member.id, { role: e.target.value })}>{staffRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select></td><td><button type="button" onClick={() => updateStaff(member.id, { is_active: !member.is_active })} className={member.is_active ? "text-emerald-700" : "text-red-700"}>{member.is_active ? "Active · disable" : "Inactive · enable"}</button></td><td><div className="flex gap-2"><button type="button" onClick={() => { setPasswordUserId(member.id); setNewPassword(""); }} className="text-brand">Change password</button><button type="button" onClick={() => removeStaff(member.id)} className="text-red-700">Disable</button></div>{passwordUserId === member.id && <div className="flex gap-2 mt-2"><input type="password" minLength={6} placeholder="New password" className="border rounded px-2 py-1" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /><button type="button" onClick={() => changePassword(member.id)} className="bg-brand text-white rounded px-2 py-1">Save</button></div>}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Food menu</h2>
          <button type="button" onClick={() => setShowMenu((current) => !current)} className="border rounded-lg px-3 py-1.5 text-sm">
            {showMenu ? "Hide food menu" : "Show food menu"}
          </button>
        </div>
        {showMenu && <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left border-b"><th className="py-2">Food</th><th>Category</th><th>Price</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  <td className="py-3"><div className="font-medium">{item.name}</div><div className="text-xs text-neutral-500">{item.destination}</div></td>
                  <td>{categories.find((category) => category.id === item.category_id)?.name || "-"}</td>
                  <td><div className="flex items-center gap-2"><input type="number" min="0" step="0.01" className="w-24 border rounded px-2 py-1" value={priceDrafts[item.id] ?? item.price} onChange={(e) => setPriceDrafts((current) => ({ ...current, [item.id]: e.target.value }))} /><button type="button" onClick={() => savePrice(item)} className="text-brand font-medium">Save</button></div></td>
                  <td><span className={item.is_available ? "text-green-700" : "text-neutral-400"}>{item.is_available ? "Available" : "Unavailable"}</span></td>
                  <td className="text-right"><button onClick={() => edit(item)} className="text-brand font-medium">Edit</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
        {!showMenu && <p className="text-sm text-neutral-500">Food menu is hidden. Click “Show food menu” to view and edit items.</p>}
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-4">Expenses</h2>
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          <form onSubmit={addExpense} className="space-y-3">
            <input required placeholder="Category" className="w-full border rounded-lg px-3 py-2" value={expenseForm.category} onChange={(e) => setExpenseForm({ ...expenseForm, category: e.target.value })} />
            <input required placeholder="Description" className="w-full border rounded-lg px-3 py-2" value={expenseForm.description} onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })} />
            <input required min="0" step="0.01" type="number" placeholder="Amount" className="w-full border rounded-lg px-3 py-2" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} />
            <input required type="date" className="w-full border rounded-lg px-3 py-2" value={expenseForm.expense_date} onChange={(e) => setExpenseForm({ ...expenseForm, expense_date: e.target.value })} />
            <button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-medium">Add expense</button>
          </form>
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left border-b"><th className="py-2">Date</th><th>Category</th><th>Description</th><th>Amount</th><th /></tr></thead><tbody>{expenses.map((expense) => <tr key={expense.id} className="border-b last:border-0"><td className="py-2">{formatDateTime(expense.expense_date)}</td><td>{expense.category}</td><td>{expense.description}</td><td>Rs. {expense.amount}</td><td><button type="button" onClick={() => deleteExpense(expense.id)} className="text-red-700">Delete</button></td></tr>)}</tbody></table>{expenses.length === 0 && <p className="text-sm text-neutral-500 mt-3">No expenses recorded.</p>}</div>
        </div>
      </section>

      <section className="order-last bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-4">{editingId ? "Edit food item" : "Add food item"}</h2>
        <form onSubmit={save} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 items-end">
          <label className="block text-sm font-medium">Category<select required className="w-full border rounded-lg px-3 py-2 mt-1" value={form.category_id} onChange={(e) => updateForm("category_id", e.target.value)}><option value="">Select category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <div className="flex gap-2"><input className="min-w-0 flex-1 border rounded-lg px-3 py-2" placeholder="New category name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} /><button type="button" onClick={addCategory} className="border border-brand text-brand rounded-lg px-3 py-2 text-sm">Add category</button></div>
          <label className="block text-sm font-medium">Food name<input required className="w-full border rounded-lg px-3 py-2 mt-1" value={form.name} onChange={(e) => updateForm("name", e.target.value)} /></label>
          <label className="block text-sm font-medium">Description<textarea className="w-full border rounded-lg px-3 py-2 mt-1" value={form.description} onChange={(e) => updateForm("description", e.target.value)} /></label>
          <label className="block text-sm font-medium">Price (NPR)<input required min="0" step="0.01" type="number" className="w-full border rounded-lg px-3 py-2 mt-1" value={form.price} onChange={(e) => updateForm("price", e.target.value)} /></label>
          <label className="block text-sm font-medium">Send order to<select className="w-full border rounded-lg px-3 py-2 mt-1" value={form.destination} onChange={(e) => updateForm("destination", e.target.value)}><option value="kitchen">Kitchen</option><option value="bar">Bar</option></select></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.is_available} onChange={(e) => updateForm("is_available", e.target.checked)} /> Available for POS orders</label>
          <div className="flex gap-2"><button type="submit" className="bg-brand text-white rounded-lg py-2 px-5 font-medium">{editingId ? "Save changes" : "Add food"}</button>{editingId && <button type="button" onClick={() => { setEditingId(null); setForm({ ...emptyForm, category_id: categories[0]?.id || "" }); }} className="px-3 border rounded-lg">Cancel</button>}</div>
        </form>
        {message && <p className="text-sm text-green-700 mt-3">{message}</p>}
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </section>

      <section className="bg-white rounded-xl shadow p-5">
        <h2 className="font-semibold mb-1">Customer history</h2>
        <p className="text-sm text-neutral-500 mb-4">See what each customer ordered and spent during a selected date range.</p>
        <div className="grid gap-3 md:grid-cols-4 items-end">
          <label className="text-sm">Customer
            <select className="w-full border rounded-lg px-3 py-2 mt-1" value={historyCustomerId} onChange={(e) => setHistoryCustomerId(e.target.value)}>
              <option value="">All customers</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` - ${customer.phone}` : ""}</option>)}
            </select>
          </label>
          <label className="text-sm">From date<input type="date" className="w-full border rounded-lg px-3 py-2 mt-1" value={historyFrom} onChange={(e) => setHistoryFrom(e.target.value)} /></label>
          <label className="text-sm">To date<input type="date" className="w-full border rounded-lg px-3 py-2 mt-1" value={historyTo} onChange={(e) => setHistoryTo(e.target.value)} /></label>
          <button type="button" onClick={searchHistory} className="bg-brand text-white rounded-lg px-4 py-2 font-medium">{historyLoading ? "Loading..." : "Search history"}</button>
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
