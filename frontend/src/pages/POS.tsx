import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

interface Category { id: string; name: string; }
interface MenuItem { id: string; category_id: string; name: string; price: string; is_available: boolean; }
interface CartLine { menu_item_id: string; name: string; price: number; quantity: number; notes: string; }
interface TableRow { id: string; floor_id: string; name: string; status: string; capacity: number; }

export default function POS() {
  const [params] = useSearchParams();
  const tableId = params.get("table") || "";
  const [tables, setTables] = useState<TableRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);

  const cabinTable = tables.find((t) => /cabin/i.test(t.name));
  const isCabinOrder = tableId && cabinTable ? tableId === cabinTable.id : false;

  useEffect(() => {
    api.get("/api/tables").then((res) => setTables(res.data));
    api.get("/api/categories").then((res) => {
      setCategories(res.data);
      if (res.data.length) setActiveCategory(res.data[0].id);
    });
    api.get("/api/menu-items").then((res) => setItems(res.data));
  }, []);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menu_item_id === item.id);
      if (existing) {
        return prev.map((l) => (l.menu_item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { menu_item_id: item.id, name: item.name, price: Number(item.price), quantity: 1, notes: "" }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const total = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);

  const sendKOT = async () => {
    if (!tableId || cart.length === 0) return;
    setSending(true);
    setMessage("");
    try {
      const response = await api.post("/api/orders", {
        table_id: tableId,
        items: cart.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, notes: l.notes })),
      });
      setActiveOrderId(response.data.id);
      setCart([]);
      setMessage("KOT sent to kitchen/bar.");
    } catch {
      setMessage("Failed to send KOT.");
    } finally {
      setSending(false);
    }
  };

  const cancelOrder = async () => {
    if (!activeOrderId || !window.confirm("Cancel this open order?")) return;
    try {
      await api.patch(`/api/orders/${activeOrderId}/cancel`);
      setActiveOrderId(null);
      setCart([]);
      setMessage("Order cancelled.");
    } catch (e: any) {
      setMessage(e?.response?.data?.detail || "Could not cancel order.");
    }
  };

  const visibleItems = items.filter(
    (i) =>
      i.is_available &&
      (!activeCategory || i.category_id === activeCategory) &&
      i.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2">
        <input
          placeholder="Search items..."
          className="w-full border rounded-lg px-3 py-2 mb-3"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 mb-4 flex-wrap">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${
                activeCategory === c.id ? "bg-brand text-white border-brand" : "bg-white"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className="bg-white rounded-xl shadow p-3 text-left hover:shadow-md transition"
            >
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-neutral-500">Rs. {item.price}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-4 h-fit sticky top-4">
        <div className="mb-3">
          {isCabinOrder && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              Cabin Room
            </div>
          )}
        </div>

        <h2 className="font-semibold mb-3">Current Order</h2>
        {cart.length === 0 && <p className="text-sm text-neutral-400">No items yet.</p>}
        <div className="space-y-2 mb-4">
          {cart.map((l) => (
            <div key={l.menu_item_id} className="flex items-center justify-between text-sm">
              <div>
                <div>{l.name}</div>
                <div className="text-neutral-400">Rs. {l.price} x {l.quantity}</div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => changeQty(l.menu_item_id, -1)} className="w-6 h-6 border rounded">-</button>
                <span>{l.quantity}</span>
                <button onClick={() => changeQty(l.menu_item_id, 1)} className="w-6 h-6 border rounded">+</button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between font-semibold border-t pt-3 mb-3">
          <span>Total</span>
          <span>Rs. {total.toFixed(2)}</span>
        </div>
        <button
          disabled={sending || cart.length === 0}
          onClick={sendKOT}
          className="w-full bg-brand hover:bg-brand-light disabled:opacity-50 text-white rounded-lg py-2 font-medium"
        >
          Send KOT
        </button>
        {activeOrderId && (
          <button onClick={cancelOrder} className="w-full border border-red-300 text-red-700 rounded-lg py-2 font-medium mt-2">
            Cancel open order
          </button>
        )}
        {message && <p className="text-sm text-center mt-2 text-neutral-600">{message}</p>}
      </div>
    </div>
  );
}
