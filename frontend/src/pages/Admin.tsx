import React, { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useLanguage } from "../context/LanguageContext";

interface Category { id: string; name: string; }
interface MenuItem { id: string; category_id: string; name: string; description: string; price: string; destination: string; is_available: boolean; }
interface Staff { id: string; username: string; full_name: string; role: string; is_active: boolean; }
interface Customer { id: string; name: string; phone?: string | null; }
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
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuEditingId, setMenuEditingId] = useState<string | null>(null);
  const [showUnavailableMenuItems, setShowUnavailableMenuItems] = useState(false);
  const menuFormRef = useRef<HTMLFormElement>(null);
  const [menuForm, setMenuForm] = useState({ category_id: "", name: "", description: "", price: "", destination: "kitchen", is_available: true });
  const [staff, setStaff] = useState<Staff[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
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
    const [categoryResponse, staffResponse, customerResponse, menuResponse] = await Promise.all([
      api.get("/api/categories"),
      api.get("/api/users"),
      api.get("/api/customers"),
      api.get("/api/menu-items"),
    ]);
    setCategories(categoryResponse.data);
    setStaff(staffResponse.data);
    setCustomers(customerResponse.data);
    setMenuItems(menuResponse.data);
    if (!menuForm.category_id && categoryResponse.data.length) setMenuForm((current) => ({ ...current, category_id: categoryResponse.data[0].id }));
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

  const saveMenuItem = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!menuForm.category_id) { setError("Add a category before adding food."); return; }
    try {
      const payload = { ...menuForm, price: Number(menuForm.price) };
      if (!Number.isFinite(payload.price) || payload.price < 0) { setError("Enter a valid food price."); return; }
      if (menuEditingId) await api.patch(`/api/menu-items/${menuEditingId}`, payload);
      else await api.post("/api/menu-items", payload);
      setMessage(menuEditingId ? "Food item updated." : "Food item added.");
      setMenuEditingId(null);
      setMenuForm({ category_id: categories[0]?.id || "", name: "", description: "", price: "", destination: "kitchen", is_available: true });
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save food item.");
    }
  };

  const editMenuItem = (item: MenuItem) => {
    setMenuEditingId(item.id);
    setMenuForm({ category_id: item.category_id, name: item.name, description: item.description || "", price: String(item.price), destination: item.destination, is_available: item.is_available });
    window.requestAnimationFrame(() => menuFormRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  const deleteMenuItem = async (item: MenuItem) => {
    if (!window.confirm(`Delete "${item.name}" from the food menu? Historical sales will be preserved.`)) return;
    try {
      const response = await api.delete(`/api/menu-items/${item.id}`);
      setMessage(response.data?.archived
        ? `"${item.name}" was removed from the active menu. Previous sales are preserved in history.`
        : `"${item.name}" was permanently deleted.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not delete food item.");
    }
  };

  const downloadFoodMenu = async () => {
    try {
      const response = await api.get("/api/menu-items/export.pdf", { responseType: "blob" });
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = "royal-skye-food-menu.pdf";
      link.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not download food menu.");
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
        <p className="text-sm text-neutral-500 mt-1">{t("Manage categories, staff, and customers.")}</p>
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

      {(message || error) && <div className="rounded-lg bg-white p-4 shadow-sm">{message && <p className="text-sm text-green-700">{message}</p>}{error && <p className="text-sm text-red-600">{error}</p>}</div>}

      <section className="bg-white rounded-xl shadow p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h2 className="font-semibold">{t("Food menu")}</h2><p className="text-sm text-neutral-500 mt-1">{t("Add and manage dishes, prices, categories and kitchen/bar routing.")}</p></div>
          <button type="button" onClick={downloadFoodMenu} className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand">{t("Download food menu PDF")}</button>
        </div>
        <form ref={menuFormRef} onSubmit={saveMenuItem} className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">{t("Food name")}<input required maxLength={128} className="mt-1 w-full border rounded-lg px-3 py-2" value={menuForm.name} onChange={(e) => setMenuForm({ ...menuForm, name: e.target.value })} /></label>
          <label className="text-sm">{t("Category")}<select required className="mt-1 w-full border rounded-lg px-3 py-2" value={menuForm.category_id} onChange={(e) => setMenuForm({ ...menuForm, category_id: e.target.value })}><option value="">{t("Select category")}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
          <label className="text-sm">{t("Price (NPR)")}<input required type="number" min="0" step="0.01" className="mt-1 w-full border rounded-lg px-3 py-2" value={menuForm.price} onChange={(e) => setMenuForm({ ...menuForm, price: e.target.value })} /></label>
          <label className="text-sm">{t("Send order to")}<select className="mt-1 w-full border rounded-lg px-3 py-2" value={menuForm.destination} onChange={(e) => setMenuForm({ ...menuForm, destination: e.target.value })}><option value="kitchen">{t("Kitchen")}</option><option value="bar">{t("Bar")}</option></select></label>
          <label className="text-sm md:col-span-2">{t("Description")}<textarea className="mt-1 w-full border rounded-lg px-3 py-2" rows={2} value={menuForm.description} onChange={(e) => setMenuForm({ ...menuForm, description: e.target.value })} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={menuForm.is_available} onChange={(e) => setMenuForm({ ...menuForm, is_available: e.target.checked })} />{t("Available for POS orders")}</label>
          <div className="flex gap-2 md:col-span-2"><button type="submit" className="bg-brand text-white rounded-lg px-4 py-2 font-medium">{menuEditingId ? t("Save changes") : t("Add food item")}</button>{menuEditingId && <button type="button" onClick={() => { setMenuEditingId(null); setMenuForm({ category_id: categories[0]?.id || "", name: "", description: "", price: "", destination: "kitchen", is_available: true }); }} className="border rounded-lg px-4 py-2">{t("Cancel")}</button>}</div>
          {categories.length === 0 && <p className="text-sm text-red-700 md:col-span-2">{t("Add a category first, then you can add dishes.")}</p>}
        </form>
        <div className="mt-5 flex items-center justify-between gap-3"><p className="text-sm text-neutral-500">{showUnavailableMenuItems ? t("Showing available and unavailable dishes") : t("Showing available dishes only")}</p><button type="button" onClick={() => setShowUnavailableMenuItems((value) => !value)} className="text-sm font-medium text-brand underline">{showUnavailableMenuItems ? t("Hide unavailable items") : t("Show unavailable items")}</button></div>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2">{t("Food")}</th><th>{t("Category")}</th><th>{t("Price")}</th><th>{t("Send order to")}</th><th>{t("Status")}</th><th>{t("Actions")}</th></tr></thead><tbody>{menuItems.filter((item) => showUnavailableMenuItems || item.is_available).map((item) => <tr key={item.id} className="border-b last:border-0"><td className="py-2"><div className="font-medium">{item.name}</div>{item.description && <div className="text-xs text-neutral-500">{item.description}</div>}</td><td>{categories.find((category) => category.id === item.category_id)?.name || "—"}</td><td>Rs. {Number(item.price).toFixed(2)}</td><td className="capitalize">{t(item.destination)}</td><td>{item.is_available ? t("Available") : t("Unavailable")}</td><td><div className="flex gap-3"><button type="button" onClick={() => editMenuItem(item)} className="text-brand">{t("Edit")}</button><button type="button" onClick={() => deleteMenuItem(item)} className="text-red-700">{t("Delete")}</button></div></td></tr>)}</tbody></table>{menuItems.filter((item) => showUnavailableMenuItems || item.is_available).length === 0 && <p className="py-4 text-sm text-neutral-500">{showUnavailableMenuItems ? t("No food items yet. Add your first dish above.") : t("No available dishes. Use Show unavailable items to view archived dishes.")}</p>}</div>
      </section>

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
