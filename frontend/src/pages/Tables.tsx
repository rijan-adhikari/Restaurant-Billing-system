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
      setFloors(res.data);
      if (res.data.length) setActiveFloor(res.data[0].id);
    });
    api.get("/api/tables").then((res) => setTables(res.data));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Select a Table</h1>
      <div className="flex gap-2 mb-6">
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
          .filter((t) => t.floor_id === activeFloor)
          .map((t) => (
            <button
              key={t.id}
              onClick={() => navigate(`/pos?table=${t.id}`)}
              className={`rounded-xl border-2 p-4 text-center font-medium ${statusColors[t.status]}`}
            >
              <div className="text-lg">{t.name}</div>
              <div className="text-xs capitalize">{t.status}</div>
              <div className="text-xs">{t.capacity} seats</div>
            </button>
          ))}
      </div>
    </div>
  );
}
