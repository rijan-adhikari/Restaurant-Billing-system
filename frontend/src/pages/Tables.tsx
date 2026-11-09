import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";

interface Floor { id: string; name: string; }
interface TableRow { id: string; floor_id: string; name: string; status: string; capacity: number; }

const statusColors: Record<string, string> = {
  available: "bg-green-100 text-green-800 border-green-300",
  occupied: "bg-red-100 text-red-800 border-red-300",
  billing: "bg-amber-100 text-amber-800 border-amber-300",
  reserved: "bg-blue-100 text-blue-800 border-blue-300",
  cleaning: "bg-neutral-200 text-neutral-700 border-neutral-300",
};

export default function Tables() {
  const [floors, setFloors] = useState<Floor[]>([]);
  const [tables, setTables] = useState<TableRow[]>([]);
  const [activeFloor, setActiveFloor] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get("/api/floors").then((res) => {
      const fetchedFloors = res.data as Floor[];
      setFloors(fetchedFloors);
      const groundFloor = fetchedFloors.find((f) => /ground/i.test(f.name));
      if (groundFloor) setActiveFloor(groundFloor.id);
    });
    api.get("/api/tables").then((res) => setTables(res.data));
  }, []);

  const cabinTable = tables.find((t) => /cabin/i.test(t.name));
  const groundFloor = floors.find((f) => /ground/i.test(f.name));

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Select service type</h1>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <button onClick={() => navigate("/pos?service=takeaway")} className="rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm transition hover:border-brand/40 hover:shadow-md"><p className="text-lg font-semibold">Takeaway</p><p className="mt-1 text-sm text-neutral-500">Create a pickup order without assigning a dining table.</p></button>
        <button onClick={() => navigate("/pos?service=delivery")} className="rounded-xl border border-neutral-200 bg-white p-5 text-left shadow-sm transition hover:border-brand/40 hover:shadow-md"><p className="text-lg font-semibold">Delivery</p><p className="mt-1 text-sm text-neutral-500">Capture customer contact, delivery address and delivery fee.</p></button>
      </div>
      <h2 className="text-lg font-semibold mb-3">Dine-in tables</h2>
      <div className="flex gap-2 mb-6 flex-wrap">
        {floors.map((f) => (
          <button
            key={f.id}
            onClick={() => setActiveFloor(f.id)}
            className={`px-4 py-2 rounded-lg border ${
              activeFloor === f.id ? "bg-brand text-white border-brand" : "bg-white"
            }`}
          >
            {f.name}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        {tables
          .filter((t) => t.floor_id === activeFloor && !/cabin|service orders/i.test(t.name))
          .map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/pos?table=${t.id}`)}
              className={`rounded-xl border-2 p-4 text-center font-medium ${statusColors[t.status]}`}
            >
              <div className="text-lg">{t.name}</div>
              <div className="text-xs capitalize">{t.status}</div>
            </button>
          ))}
      </div>

      {activeFloor === groundFloor?.id && cabinTable && (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          <button
            onClick={() => navigate(`/pos?table=${cabinTable.id}`)}
            className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5 text-left shadow-sm hover:shadow-md transition"
          >
            <div className="text-xl font-semibold text-amber-900">Cabin Room</div>
            <div className="mt-2 text-sm text-amber-800">Use this cabin for private dining and meals priced with the cabin surcharge.</div>
          </button>
        </div>
      )}
    </div>
  );
}
