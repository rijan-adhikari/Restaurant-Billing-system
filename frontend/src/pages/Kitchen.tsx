import React, { useEffect, useState } from "react";
import { api, wsBaseUrl } from "../api/client";

interface KOTItemView { id: string; quantity: number; notes: string; menu_item_name: string; }
interface KOTView { id: string; kot_number: string; status: string; order_number: string; table_name: string; customer_name?: string | null; phone?: string | null; delivery_address?: string | null; items: KOTItemView[]; }

const STATION = "kitchen"; // Bar.tsx uses the same component pattern with "bar"

export default function Kitchen() {
  const [kots, setKots] = useState<KOTView[]>([]);

  const load = () => {
    api.get(`/api/kots?station=${STATION}`).then((res) => setKots(res.data));
  };

  useEffect(() => {
    load();
    const ws = new WebSocket(`${wsBaseUrl}/api/ws/updates`);
    ws.onmessage = () => load();
    return () => ws.close();
  }, []);

  const advance = async (id: string, status: string) => {
    await api.patch(`/api/kots/${id}/status`, { status });
    load();
  };

  const next: Record<string, string> = { new: "accepted", accepted: "preparing", preparing: "ready", ready: "served" };

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Kitchen Display</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kots.filter((k) => k.status !== "served" && k.status !== "cancelled").map((k) => (
          <div key={k.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex justify-between text-sm text-neutral-500 mb-2">
              <span>{k.kot_number} - {k.table_name}</span>
              <span className="capitalize font-medium text-brand">{k.status}</span>
            </div>
            {(k.customer_name || k.delivery_address) && <div className="mb-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900"><p className="font-semibold">{k.customer_name || "Service order"} {k.phone ? "· " + k.phone : ""}</p>{k.delivery_address && <p>{k.delivery_address}</p>}</div>}
            <ul className="text-sm mb-3 space-y-1">
              {k.items.map((i) => (
                <li key={i.id}>
                  {i.quantity}x {i.menu_item_name} {i.notes && <span className="text-neutral-400">({i.notes})</span>}
                </li>
              ))}
            </ul>
            {next[k.status] && (
              <button
                onClick={() => advance(k.id, next[k.status])}
                className="w-full bg-brand text-white rounded-lg py-1.5 text-sm"
              >
                Mark {next[k.status]}
              </button>
            )}
          </div>
        ))}
        {kots.filter((k) => k.status !== "served" && k.status !== "cancelled").length === 0 && <p className="text-neutral-400">No active KOTs.</p>}
      </div>
    </div>
  );
}
