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


export function apiErrorMessage(error: any, fallback = "The request failed.") {
  const response = error?.response;
  const detail = response?.data?.detail ?? response?.data?.message;
  const detailText = Array.isArray(detail)
    ? detail.map((item: any) => item?.msg || JSON.stringify(item)).join("; ")
    : typeof detail === "string" ? detail : detail ? JSON.stringify(detail) : "";
  if (detailText) return detailText;
  if (response) return `${fallback} (HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}).`;
  if (error?.request) return `${fallback} No response from the server; check that the backend and API proxy are running.`;
  return error?.message || fallback;
}
