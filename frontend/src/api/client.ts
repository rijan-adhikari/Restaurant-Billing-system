import axios from "axios";

// Set VITE_API_BASE_URL in the environment to the server's LAN IP, e.g. http://192.168.1.100:8000
const baseURL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

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

export const wsBaseUrl = import.meta.env.VITE_WS_BASE_URL || "ws://localhost:8000";
