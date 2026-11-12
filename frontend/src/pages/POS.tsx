import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/client";

interface Category { id: string; name: string; }
interface MenuItem { id: string; category_id: string; name: string; price: string; is_available: boolean; }
interface CartLine { menu_item_id: string; name: string; price: number; quantity: number; notes: string; }
interface SentOrderLine { id: string; menu_item_id: string; name: string; quantity: number; unit_price: string; notes: string; total: string; }
interface TableRow { id: string; floor_id: string; name: string; status: string; capacity: number; }

export default function POS() {
  const [params] = useSearchParams();
  const tableId = params.get("table") || "";
  const serviceType = params.get("service") || "dine_in";
  const isServiceOrder = serviceType !== "dine_in";
  const [tables, setTables] = useState<TableRow[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [activeOrderId, setActiveOrderId] = useState<string | null>(null);
  const [sentOrderItems, setSentOrderItems] = useState<SentOrderLine[]>([]);
  const [taxSettings, setTaxSettings] = useState({ tax_enabled: false, tax_percent: "0", service_charge_enabled: false, service_charge_percent: "0" });
  const [serviceCustomerName, setServiceCustomerName] = useState("");
  const [servicePhone, setServicePhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [businessDate, setBusinessDate] = useState(new Date().toLocaleDateString("en-CA"));

  const selectedTable = tables.find((t) => t.id === tableId);
  const isCabinOrder = Boolean(selectedTable && /cabin/i.test(selectedTable.name));
  const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

  useEffect(() => {
    api.get("/api/tables").then((res) => setTables(res.data));
    api.get("/api/categories").then((res) => {
      setCategories(res.data);
      if (res.data.length) setActiveCategory(res.data[0].id);
    });
    api.get("/api/menu-items").then((res) => setItems(res.data));
    api.get("/api/settings/tax").then((res) => setTaxSettings(res.data)).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!tableId || isServiceOrder) return;
    let cancelled = false;
    api.get("/api/orders/open").then((res) => {
      if (cancelled) return;
      const openOrder = (res.data || []).find((order: any) => order.table_id === tableId);
      if (openOrder) {
        setActiveOrderId(openOrder.id);
        setBusinessDate(openOrder.business_date || new Date().toLocaleDateString("en-CA"));
        setSentOrderItems(openOrder.items || []);
      } else {
        setActiveOrderId(null);
        setSentOrderItems([]);
      }
    }).catch(() => {
      if (!cancelled) setMessage("Could not load the table's current order. Please refresh or contact a manager.");
    });
    return () => { cancelled = true; };
  }, [tableId, isServiceOrder]);

  const addToCart = (item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menu_item_id === item.id);
      if (existing) {
        return prev.map((l) => (l.menu_item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      const basePrice = Number(item.price);
      const effectivePrice = isCabinOrder ? roundMoney(basePrice * 1.05) : basePrice;
      return [...prev, { menu_item_id: item.id, name: item.name, price: effectivePrice, quantity: 1, notes: "" }];
    });
  };

  const changeQty = (id: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
    );
  };

  const itemSubtotal = roundMoney(
    sentOrderItems.reduce((sum, line) => sum + Number(line.total || Number(line.unit_price) * line.quantity), 0) +
    cart.reduce((sum, line) => sum + line.price * line.quantity, 0)
  );
  const cabinFee = isCabinOrder ? 500 : 0;
  const effectiveDeliveryFee = serviceType === "delivery" ? Math.max(0, Number(deliveryFee || 0)) : 0;
  const subtotal = roundMoney(itemSubtotal + cabinFee + effectiveDeliveryFee);
  const taxAmount = taxSettings.tax_enabled ? roundMoney(subtotal * Number(taxSettings.tax_percent) / 100) : 0;
  const serviceAmount = taxSettings.service_charge_enabled ? roundMoney(subtotal * Number(taxSettings.service_charge_percent) / 100) : 0;
  const total = roundMoney(subtotal + taxAmount + serviceAmount);

  const sendKOT = async () => {
    if ((serviceType === "dine_in" && !tableId) || cart.length === 0) return;
    if (serviceType === "delivery" && !deliveryAddress.trim()) { setMessage("Enter the delivery address first."); return; }
    setSending(true);
    setMessage("");
    try {
      const response = await api.post("/api/orders", {
        table_id: tableId || null,
        service_type: serviceType,
        customer_name: serviceCustomerName || null,
        phone: servicePhone || null,
        delivery_address: serviceType === "delivery" ? deliveryAddress : null,
        delivery_fee: effectiveDeliveryFee,
        business_date: businessDate,
        items: cart.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, notes: l.notes })),
      });
      setActiveOrderId(response.data.id);
      setCart([]);
      if (!isServiceOrder) {
        const refreshed = await api.get("/api/orders/open");
        const openOrder = (refreshed.data || []).find((order: any) => order.id === response.data.id);
        setSentOrderItems(openOrder?.items || []);
      }
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
      setSentOrderItems([]);
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
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
      <div className="min-w-0">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-brand">Royal Skye · Point of Sale</p><h1 className="mt-1 text-2xl font-bold">Take an order</h1><p className="text-sm text-neutral-500">{selectedTable ? "Table " + selectedTable.name + " · " + selectedTable.capacity + " seats" : isServiceOrder ? serviceType === "delivery" ? "Delivery order" : "Takeaway order" : "Select a table before opening the POS"}</p></div>{isCabinOrder && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800">Cabin pricing applies</span>}</div>
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3 shadow-sm"><label className="text-xs font-medium text-neutral-600">Business / Sales date<input type="date" className="mt-1 block rounded-lg border px-3 py-2 text-sm" value={businessDate} onChange={e => setBusinessDate(e.target.value)} /></label><p className="text-xs text-neutral-500">This date controls sales reporting. The actual order timestamp remains unchanged.</p></div>
        {isServiceOrder && <div className="mb-4 grid gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm sm:grid-cols-2">
          <label className="block text-xs font-medium text-neutral-600">Customer name<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={serviceCustomerName} onChange={e => setServiceCustomerName(e.target.value)} placeholder="Customer name" /></label>
          <label className="block text-xs font-medium text-neutral-600">Phone<input className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={servicePhone} onChange={e => setServicePhone(e.target.value)} placeholder="Contact number" /></label>
          {serviceType === "delivery" && <>
            <label className="block text-xs font-medium text-neutral-600 sm:col-span-2">Delivery address<input required className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)} placeholder="Full delivery address / landmark" /></label>
            <label className="block text-xs font-medium text-neutral-600">Delivery fee (NPR)<input type="number" min="0" step="0.01" className="mt-1 w-full rounded-lg border px-3 py-2 text-sm" value={deliveryFee} onChange={e => setDeliveryFee(e.target.value)} /></label>
          </>}
        </div>}
        <input
          placeholder="Search items..."
          className="mb-3 w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 shadow-sm focus:border-brand"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-2 mb-4 flex-wrap">
          {categories.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveCategory(c.id)}
              className={`rounded-xl border px-4 py-2 text-sm font-medium transition ${
                activeCategory === c.id ? "bg-brand text-white border-brand" : "bg-white"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              onClick={() => addToCart(item)}
              className="rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-md"
            >
              <div className="font-semibold">{item.name}</div>
              <div className="mt-2 text-sm font-semibold text-brand">Rs. {Number(item.price).toFixed(2)}</div>
              <div className="mt-3 text-xs text-neutral-400">Tap to add to order</div>
            </button>
          ))}
        </div>
      </div>

      <div className="h-fit rounded-2xl border border-neutral-200 bg-white p-5 shadow-lg xl:sticky xl:top-5">
        <div className="mb-3">
          {isCabinOrder && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-medium text-amber-800">
              Cabin Room
            </div>
          )}
        </div>

        <div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-bold">Current order</h2><span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-600">{cart.reduce((sum, line) => sum + line.quantity, 0)} items</span></div>
        {cart.length === 0 && sentOrderItems.length === 0 && <p className="text-sm text-neutral-400">No items yet.</p>}
        <div className="space-y-2 mb-4">
          {sentOrderItems.map((line) => (
            <div key={line.id} className="flex items-center justify-between text-sm rounded-lg bg-emerald-50 px-3 py-2">
              <div>
                <div className="font-medium">{line.name}</div>
                <div className="text-neutral-500">{line.quantity} x Rs. {Number(line.unit_price).toFixed(2)}{line.notes ? " · " + line.notes : ""}</div>
                <div className="text-[11px] font-semibold text-emerald-700">Sent to kitchen/bar</div>
              </div>
              <span>Rs. {Number(line.total).toFixed(2)}</span>
            </div>
          ))}
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
        <div className="mt-4 space-y-2 border-t pt-4 text-sm">
          <div className="flex justify-between"><span className="text-neutral-500">Items subtotal</span><span>Rs. {itemSubtotal.toFixed(2)}</span></div>
          {isCabinOrder && <div className="flex justify-between"><span className="text-neutral-500">Cabin fee</span><span>Rs. {cabinFee.toFixed(2)}</span></div>}{effectiveDeliveryFee > 0 && <div className="flex justify-between"><span className="text-neutral-500">Delivery fee</span><span>Rs. {effectiveDeliveryFee.toFixed(2)}</span></div>}
          <div className="flex justify-between"><span className="text-neutral-500">Subtotal</span><span>Rs. {subtotal.toFixed(2)}</span></div>
          {taxSettings.tax_enabled && <div className="flex justify-between"><span className="text-neutral-500">Tax ({taxSettings.tax_percent}%)</span><span>Rs. {taxAmount.toFixed(2)}</span></div>}
          {taxSettings.service_charge_enabled && <div className="flex justify-between"><span className="text-neutral-500">Service charge ({taxSettings.service_charge_percent}%)</span><span>Rs. {serviceAmount.toFixed(2)}</span></div>}
          <div className="flex justify-between border-t pt-3 text-base font-bold"><span>Estimated total</span><span className="text-brand">Rs. {total.toFixed(2)}</span></div>
          <p className="text-[11px] text-neutral-400">Final amount is confirmed at billing. Discounts and any customer credit are handled at checkout.</p>
        </div>
        <button
          disabled={sending || cart.length === 0 || (serviceType === "dine_in" && !tableId)}
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
