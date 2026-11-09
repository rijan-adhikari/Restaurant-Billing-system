import axios from "axios";

// The production container serves the UI and proxies /api to FastAPI.
// Vite development uses the same relative URL through its dev-server proxy.
const baseURL = import.meta.env.VITE_API_BASE_URL ?? "";

export const api = axios.create({ baseURL });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem("token");
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

const socketProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
export const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL || `${socketProtocol}//${window.location.host}`;
