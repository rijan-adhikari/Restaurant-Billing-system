import React, { useEffect, useState } from "react";
import { api } from "../api/client";

interface OpenOrder { id: string; order_number: string; table_name: string; subtotal: string; grand_total: string; tax_amount: string; tax_percent: string; service_charge_amount: string; service_charge_percent: string; cabin_fee?: string; service_type?: string; customer_name?: string | null; phone?: string | null; delivery_address?: string | null; delivery_fee?: string; items: Array<{ name: string; quantity: number; unit_price: string; total: string }>; }
interface Customer { id: string; name: string; phone?: string | null; }

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function Billing() {
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orderId, setOrderId] = useState("");
  const [method, setMethod] = useState("cash");
  const [amount, setAmount] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");
  const [discountAmount, setDiscountAmount] = useState("0");
  const [loyaltyPoints, setLoyaltyPoints] = useState("0");
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [pointValue, setPointValue] = useState(1);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [result, setResult] = useState<any>(null);
  const [preview, setPreview] = useState<{ order: OpenOrder; discountPercentAmount: string; fixedDiscountAmount: string; loyaltyDiscount: string; loyaltyPoints: string; totalDiscountAmount: string; taxAmount: string; serviceAmount: string; grandTotal: string; amountReceived: string; remainingCredit: string; changeDue: string } | null>(null);
  const [error, setError] = useState("");

  const loadData = async () => {
    const [orderResponse, customerResponse, loyaltyResponse] = await Promise.all([
      api.get("/api/orders/open"),
      api.get("/api/customers"),
      api.get("/api/admin/loyalty/settings"),
    ]);
    setOrders(orderResponse.data);
    setCustomers(customerResponse.data);
    setLoyaltyEnabled(!!loyaltyResponse.data.enabled);
    setPointValue(Number(loyaltyResponse.data.point_value || 0));
  };

  useEffect(() => {
    loadData().catch(() => setError("Could not load open orders and customers."));
  }, []);

  useEffect(() => {
    if (!customerId) { setLoyaltyBalance(0); setLoyaltyPoints("0"); setPreview(null); return; }
    api.get(`/api/admin/loyalty/customers/${customerId}`)
      .then((response) => setLoyaltyBalance(Number(response.data.points_balance || 0)))
      .catch(() => setLoyaltyBalance(0));
  }, [customerId]);

  const selectOrder = (id: string) => {
    setOrderId(id);
    const order = orders.find((candidate) => candidate.id === id);
    setAmount(method === "credit" ? "0" : (order?.grand_total || ""));
    setResult(null);
    setPreview(null);
  };

  const previewBill = () => {
    setError("");
    const selectedOrder = orders.find((order) => order.id === orderId);
    const percent = Number(discountPercent || 0);
    if (!selectedOrder || percent < 0 || percent > 100) {
      setError("Select an open order and enter a discount between 0% and 100%.");
      return;
    }
    const subtotal = Number(selectedOrder.subtotal);
    const percentDiscountAmount = roundMoney(subtotal * percent / 100);
    const fixedDiscountAmount = Number(discountAmount || 0);
    if (!Number.isFinite(fixedDiscountAmount) || fixedDiscountAmount < 0) {
      setError("Enter a valid fixed discount amount.");
      return;
    }
    const points = Number(loyaltyPoints || 0);
    if (!Number.isFinite(points) || points < 0 || (points > 0 && (!loyaltyEnabled || !customerId || points > loyaltyBalance))) {
      setError("Check the customer, loyalty status and available points before redeeming.");
      return;
    }
    const loyaltyDiscount = roundMoney(points * pointValue);
    const totalDiscountAmount = roundMoney(percentDiscountAmount + fixedDiscountAmount + loyaltyDiscount);
    if (totalDiscountAmount > subtotal) {
      setError("Discounts and loyalty redemption cannot exceed the bill subtotal.");
      return;
    }
    const taxableSubtotal = roundMoney(subtotal - totalDiscountAmount);
    const taxAmount = roundMoney(taxableSubtotal * Number(selectedOrder.tax_percent || 0) / 100);
    const serviceAmount = roundMoney(taxableSubtotal * Number(selectedOrder.service_charge_percent || 0) / 100);
    const grandTotal = roundMoney(taxableSubtotal + taxAmount + serviceAmount);
    const amountReceived = method === "credit" ? 0 : Number(amount || 0);
    if (!Number.isFinite(amountReceived) || amountReceived < 0) {
      setError("Enter a valid amount received.");
      return;
    }
    if (amountReceived > grandTotal && method !== "cash") {
      setError("Overpayment/change is supported for cash payments only.");
      return;
    }
    const remainingCredit = Math.max(0, grandTotal - amountReceived);
    const changeDue = Math.max(0, amountReceived - grandTotal);
    if (remainingCredit > 0.001 && !customerId) {
      setError("Select a customer so the remaining amount can be added to Credit.");
      return;
    }
    setPreview({ order: selectedOrder, discountPercentAmount: percentDiscountAmount.toFixed(2), fixedDiscountAmount: fixedDiscountAmount.toFixed(2), loyaltyDiscount: loyaltyDiscount.toFixed(2), loyaltyPoints: points.toFixed(0), totalDiscountAmount: totalDiscountAmount.toFixed(2),
      taxAmount: taxAmount.toFixed(2), serviceAmount: serviceAmount.toFixed(2),
      grandTotal: grandTotal.toFixed(2), amountReceived: amountReceived.toFixed(2),
      remainingCredit: remainingCredit.toFixed(2), changeDue: changeDue.toFixed(2) });
  };

  const addCustomer = async () => {
    if (!newCustomerName.trim()) return;
    try {
      const response = await api.post("/api/customers", { name: newCustomerName, phone: newCustomerPhone || null });
      setCustomers((current) => [...current, response.data]);
      setCustomerId(response.data.id);
      setNewCustomerName("");
      setNewCustomerPhone("");
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Could not save customer.");
    }
  };

  const submit = async () => {
    setError("");
    setResult(null);
    try {
      const selectedOrder = orders.find((order) => order.id === orderId);
      if (!preview || !selectedOrder || (method !== "credit" && (!amount || Number(amount) <= 0))) {
        setError("Preview the bill before generating it.");
        return;
      }
      if (!selectedOrder || (method !== "credit" && (!amount || Number(amount) <= 0))) {
        setError("Select an open order and enter the amount received.");
        return;
      }
      if (method === "credit" && !customerId) {
        setError("Select a customer for a credit sale.");
        return;
      }
      const res = await api.post("/api/bills", {
        order_id: orderId,
        customer_id: customerId || null,
        discount_percent: Number(discountPercent || 0),
        discount_amount: Number(discountAmount || 0),
        loyalty_points_redeemed: Number(loyaltyPoints || 0),
        payments: [{ method, amount: method === "credit" ? 0 : Number(amount) }],
      });
      setResult(res.data);
      setPreview(null);
      setLoyaltyPoints("0");
      await loadData();
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Failed to create bill");
    }
  };

  const selectedCustomer = customers.find((customer) => customer.id === customerId);
  const matchingCustomers = customers.filter((customer) =>
    `${customer.name} ${customer.phone || ""}`.toLowerCase().includes(customerSearch.toLowerCase())
  );

  const updateCustomerSearch = (value: string) => {
    setCustomerSearch(value);
    setPreview(null);
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      setCustomerId("");
      return;
    }
    const exact = customers.find((customer) =>
      [customer.name, customer.phone || ""].some((field) => field.trim().toLowerCase() === normalized)
    );
    setCustomerId(exact ? exact.id : "");
  };

  const printBill = () => window.print();

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Billing</h1>
      <div className="bg-white rounded-xl shadow p-5 space-y-3">
        <label className="block text-sm font-medium">Open order</label>
        <select className="w-full border rounded-lg px-3 py-2" value={orderId} onChange={(e) => selectOrder(e.target.value)}>
          <option value="">Select an open order</option>
          {orders.map((order) => <option key={order.id} value={order.id}>{order.service_type && order.service_type !== "dine_in" ? order.table_name : "Table " + order.table_name} - Rs. {order.grand_total}</option>)}
        </select>

        <label className="block text-sm font-medium">Payment method</label>
          <select className="w-full border rounded-lg px-3 py-2" value={method} onChange={(e) => { setMethod(e.target.value); setPreview(null); const selected = orders.find((o) => o.id === orderId); setAmount(e.target.value === "credit" ? "0" : (selected?.grand_total || "")); }}>
          <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option><option value="qr">QR Payment</option><option value="credit">Credit</option>
        </select>

        <label className="block text-sm font-medium">Amount received now</label>
          <input type="number" min="0" step="0.01" disabled={method === "credit"} className="w-full border rounded-lg px-3 py-2 disabled:bg-neutral-100" value={amount} onChange={(e) => { setAmount(e.target.value); setPreview(null); }} />

        <label className="block text-sm font-medium">Redeem loyalty points</label>
          <input type="number" min="0" step="1" disabled={!customerId || !loyaltyEnabled} className="w-full border rounded-lg px-3 py-2 disabled:bg-neutral-100" value={loyaltyPoints} onChange={(e) => { setLoyaltyPoints(e.target.value); setPreview(null); }} />
          <p className="text-xs text-neutral-500">{!customerId ? "Select a customer to use loyalty points." : loyaltyEnabled ? `Available: ${loyaltyBalance} points · NPR ${pointValue} per point` : "Customer loyalty is disabled."}</p>

        <label className="block text-sm font-medium">Discount (%)</label>
          <input type="number" min="0" max="100" step="0.01" className="w-full border rounded-lg px-3 py-2" value={discountPercent} onChange={(e) => { setDiscountPercent(e.target.value); setPreview(null); }} />
        <label className="block text-sm font-medium">Discount amount (NPR)</label>
          <input type="number" min="0" step="0.01" className="w-full border rounded-lg px-3 py-2" value={discountAmount} onChange={(e) => { setDiscountAmount(e.target.value); setPreview(null); }} placeholder="Enter fixed discount in rupees" />

        <p className="text-xs text-neutral-500">For a partial payment, the unpaid remainder is automatically added to the selected customer&apos;s Credit account.</p>
        <label className="block text-sm font-medium">Customer for outstanding balance</label>
        <input className="w-full border rounded-lg px-3 py-2" placeholder="Search customer by name or phone" value={customerSearch} onChange={(e) => updateCustomerSearch(e.target.value)} />
        {customerSearch && <div className="border rounded-lg divide-y max-h-40 overflow-y-auto">
          {matchingCustomers.map((customer) => <button type="button" key={customer.id} onClick={() => { setCustomerId(customer.id); setCustomerSearch(customer.name); setPreview(null); }} className={`block w-full text-left px-3 py-2 text-sm hover:bg-neutral-50 ${customer.id === customerId ? "bg-green-50" : ""}`}><span className="font-medium">{customer.name}</span>{customer.phone && <span className="text-neutral-500"> - {customer.phone}</span>}</button>)}
          {matchingCustomers.length === 0 && <p className="px-3 py-2 text-sm text-neutral-500">No customer found.</p>}
        </div>}
        {selectedCustomer && <p className="text-xs text-neutral-500">Customer ID: {selectedCustomer.id}</p>}

        <div className="border-t pt-3">
          <p className="text-sm font-medium mb-2">Add new customer</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input className="border rounded-lg px-3 py-2" placeholder="Customer name" value={newCustomerName} onChange={(e) => setNewCustomerName(e.target.value)} />
            <input className="border rounded-lg px-3 py-2" placeholder="Phone" value={newCustomerPhone} onChange={(e) => setNewCustomerPhone(e.target.value)} />
          </div>
          <button onClick={addCustomer} className="mt-2 border rounded-lg px-3 py-2 text-sm">Save customer</button>
        </div>

        <button onClick={previewBill} className="w-full border border-brand text-brand rounded-lg py-2 font-medium">Preview bill</button>
          {preview && <div className="border-2 border-dashed border-brand/40 rounded-lg p-4 space-y-3"><div className="text-center"><img src="/images/logo.png" alt="Restaurant logo" className="mx-auto w-16 h-16 object-contain rounded-full" /><p className="font-semibold">{preview.order.order_number} - {preview.order.service_type && preview.order.service_type !== "dine_in" ? preview.order.table_name : "Table " + preview.order.table_name}</p><p className="text-sm text-neutral-500">Preview only - not yet added to sales</p></div><div className="space-y-1 text-sm">{preview.order.items.map((item) => <div key={item.name} className="flex justify-between"><span>{item.quantity} x {item.name} (Rs. {item.unit_price})</span><span>Rs. {item.total}</span></div>)}{preview.order.cabin_fee && Number(preview.order.cabin_fee) > 0 && <div className="flex justify-between"><span>Cabin fee</span><span>Rs. {preview.order.cabin_fee}</span></div>}{Number(preview.order.delivery_fee || 0) > 0 && <div className="flex justify-between"><span>Delivery fee</span><span>Rs. {preview.order.delivery_fee}</span></div>}{preview.order.delivery_address && <p className="text-xs text-neutral-500">Delivery to: {preview.order.delivery_address}</p>}</div><div className="border-t pt-2 text-sm space-y-1"><p className="flex justify-between"><span>Subtotal</span><span>Rs. {preview.order.subtotal}</span></p><p className="flex justify-between"><span>Discount ({discountPercent}%)</span><span>- Rs. {preview.discountPercentAmount}</span></p>{Number(preview.fixedDiscountAmount) > 0 && <p className="flex justify-between"><span>Discount amount</span><span>- Rs. {preview.fixedDiscountAmount}</span></p>}{Number(preview.loyaltyDiscount) > 0 && <p className="flex justify-between"><span>Loyalty ({preview.loyaltyPoints} points)</span><span>- Rs. {preview.loyaltyDiscount}</span></p>}<p className="flex justify-between font-medium"><span>Total discounts</span><span>- Rs. {preview.totalDiscountAmount}</span></p><p className="flex justify-between"><span>Tax</span><span>Rs. {preview.taxAmount}</span></p><p className="flex justify-between"><span>Service charge</span><span>Rs. {preview.serviceAmount}</span></p><p className="flex justify-between font-semibold"><span>Grand total</span><span>Rs. {preview.grandTotal}</span></p><p className="flex justify-between"><span>Amount tendered</span><span>Rs. {preview.amountReceived}</span></p>{Number(preview.changeDue) > 0 && <p className="flex justify-between font-semibold text-emerald-700"><span>Change due</span><span>Rs. {preview.changeDue}</span></p>}<p className="flex justify-between font-semibold text-amber-700"><span>Remaining credit</span><span>Rs. {preview.remainingCredit}</span></p><p className="flex justify-between"><span>Payment method</span><span>{method}</span></p>{selectedCustomer && <p className="flex justify-between"><span>Customer</span><span>{selectedCustomer.name}</span></p>}</div><button onClick={submit} className="w-full bg-brand text-white rounded-lg py-2 font-medium">Generate Bill and add to sales</button></div>}
        {error && <p className="text-red-600 text-sm">{error}</p>}
        {result && (
          <div id="printable-bill" className="text-sm border-t pt-4 mt-2 space-y-3">
            <div className="text-center border-b pb-3">
              <img src="/images/logo.png" alt="Restaurant logo" className="mx-auto w-20 h-20 object-contain rounded-full mb-2" />
              <p className="font-semibold text-lg">{result.restaurant?.name || "Restaurant"}</p>
              <p className="text-neutral-500">{result.restaurant?.address || "Location not configured"}</p>
              {result.restaurant?.phone && <p className="text-neutral-500">{result.restaurant.phone}</p>}{result.customer_name && <p className="text-neutral-500">Customer: {result.customer_name} · {result.phone || ""}</p>}{result.delivery_address && <p className="text-neutral-500">Delivery: {result.delivery_address}</p>}
              <p className="mt-2">Bill {result.bill_number} - {result.service_type && result.service_type !== "dine_in" ? result.table_name : "Table " + result.table_name}</p>
            </div>
            <div className="space-y-1">
              {result.items?.map((item: { name: string; quantity: number; unit_price: string; total: string }) => (
                <div key={item.name} className="flex justify-between"><span>{item.quantity} x {item.name} <span className="text-neutral-500">(Rs. {item.unit_price})</span></span><span>Rs. {item.total}</span></div>
              ))}
              {Number(result.cabin_fee || 0) > 0 && <div className="flex justify-between"><span>Cabin fee</span><span>Rs. {result.cabin_fee}</span></div>}
            </div>
            <div className="border-t pt-2 space-y-1">
              <p className="flex justify-between"><span>Subtotal</span><span>Rs. {result.subtotal}</span></p>
              <p className="flex justify-between"><span>Discount ({result.discount_percent}%)</span><span>- Rs. {result.discount_percent_amount || "0.00"}</span></p>{Number(result.fixed_discount_amount || 0) > 0 && <p className="flex justify-between"><span>Discount amount</span><span>- Rs. {result.fixed_discount_amount}</span></p>}{Number(result.loyalty_discount_amount || 0) > 0 && <p className="flex justify-between"><span>Loyalty redemption ({result.loyalty_points_redeemed} points)</span><span>- Rs. {result.loyalty_discount_amount}</span></p>}
              <p className="flex justify-between"><span>Tax ({result.tax_percent}%)</span><span>Rs. {result.tax_amount}</span></p>
              <p className="flex justify-between"><span>Service charge ({result.service_charge_percent}%)</span><span>Rs. {result.service_charge_amount}</span></p>
              <p className="flex justify-between border-t pt-2 font-semibold"><span>Grand total</span><span>Rs. {result.grand_total}</span></p>
              <p className="flex justify-between"><span>Payment ({result.payments?.[0]?.method || method})</span><span>Rs. {result.amount_paid}</span></p>
              {Number(result.change_due || 0) > 0 && <p className="flex justify-between font-semibold text-emerald-700"><span>Change due</span><span>Rs. {result.change_due}</span></p>}
              <p className="flex justify-between"><span>Outstanding</span><span>Rs. {result.outstanding_amount}</span></p>
            </div>
            <p className="text-center text-neutral-600 pt-3">{result.restaurant?.receipt_footer || "Thankyou For Visiting Us."}</p>
            <button type="button" onClick={printBill} className="print:hidden w-full border border-brand text-brand rounded-lg py-2 font-medium">Print bill</button>
          </div>
        )}
      </div>
    </div>
  );
}
