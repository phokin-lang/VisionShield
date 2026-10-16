// Thin wrapper around the backend REST API.
// In dev, Vite proxies /api -> http://localhost:4000 (see vite.config.js).
// In production, set VITE_API_URL to the deployed backend's base URL
// (e.g. https://artisafesight-backend.onrender.com/api).
const BASE = import.meta.env.VITE_API_URL || "/api";

// Session expired / token rejected -> back to the login screen.
function handleUnauthorized(path) {
  if (path.startsWith("/auth/") || !localStorage.getItem("token")) return;
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.reload();
}

async function request(path, options = {}) {
  const token = localStorage.getItem("token");
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...options
  });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized(path);
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

// Phone photos are 5-12 MB. Shrink to max 1280px JPEG before upload: ~10x faster on
// a cold Render instance, and the model only looks at 640px anyway. Detection boxes are
// percentages, so they stay correct after resizing.
async function downscaleImage(file, maxSide = 1280) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) {
      bmp.close?.();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
    return blob ? new File([blob], "upload.jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

export const api = {
  getCameras: () => request("/cameras"),
  getCamera: (id) => request(`/cameras/${id}`),
  getAlerts: (severity = "all") => request(`/alerts?severity=${severity}`),
  acknowledgeAlert: (id) =>
    request(`/alerts/${id}/acknowledge`, { method: "PATCH" }),
  getStats: () => request("/stats"),
  getSettings: () => request("/settings"),
  updateSettings: (patch) =>
    request("/settings", { method: "PUT", body: JSON.stringify(patch) }),
  scanCameras: () => request("/cameras/scan", { method: "POST" }),
  restoreCamera: (id) => request(`/cameras/${id}/source`, { method: "DELETE" }),
  saveZones: (id, zones) =>
    request(`/cameras/${id}/zones`, { method: "PUT", body: JSON.stringify({ zones }) }),
  // custom frame shown on a camera tile (needs the auth header, so fetch -> blob)
  getCameraSource: async (id) => {
    const token = localStorage.getItem("token");
    const res = await fetch(`${BASE}/cameras/${id}/source`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) throw new Error("No custom media");
    return res.blob();
  },
  notifyViolation: (payload) =>
    request("/alerts/notify", { method: "POST", body: JSON.stringify(payload) }),
  testLine: () => request("/settings/line-test", { method: "POST" }),
  analyzeImage: async (file, cameraId, opts = {}) => {
    const token = localStorage.getItem("token");
    const form = new FormData();
    form.append("image", opts.skipDownscale ? file : await downscaleImage(file), "frame.jpg");
    if (cameraId) {
      form.append("cameraId", cameraId);
      if (opts.sourceLabel) form.append("sourceLabel", opts.sourceLabel);
    } else if (opts.zoneCameraId) {
      // analyse with that camera's danger zones without logging the result to it
      form.append("zoneCameraId", opts.zoneCameraId);
    }
    const res = await fetch(`${BASE}/detect`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) handleUnauthorized("/detect");
    if (res.status === 429) throw new Error(body.error || "Server is busy — try again in a few seconds.");
    if (!res.ok && res.status !== 503) throw new Error(body.error || `Request failed: ${res.status}`);
    return body;
  }
};

export const authApi = {
  register: (data) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(data) }),
  login: (data) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(data) })
};