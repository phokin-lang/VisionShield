// In-memory store for cameras, alerts and settings.
//
// Detections are NOT hand-written anymore: services/cameraScanner.js runs the
// PPE model on each camera frame and calls applyScan() below. Swap this module
// for a real DB later — the exported function signatures are all the routes use.

const CAMERA_DEFS = [
  { id: "cam-01", name: "North Entrance", zone: "Building A · Ground Floor", image: "ppe/cam1.jpg" },
  { id: "cam-02", name: "Loading Bay", zone: "Building A · Loading Dock", image: "ppe/cam2.jpg" },
  { id: "cam-03", name: "Assembly Floor", zone: "Building B · Zone 2", image: "ppe/cam3.jpg" },
  { id: "cam-04", name: "East Corridor", zone: "Building B · Level 3", image: "ppe/cam4.jpg" },
  { id: "cam-05", name: "Chemical Storage", zone: "Building C · Restricted", image: "ppe/cam5.jpg" },
  { id: "cam-06", name: "South Perimeter", zone: "Building C · Exterior", image: "ppe/cam6.jpg" },
  { id: "cam-07", name: "Warehouse Bay 2", zone: "Building A · Storage", image: "ppe/cam7.jpg" },
  { id: "cam-08", name: "Rooftop Access", zone: "Building B · Level 5", image: "ppe/cam8.jpg" }
];

const MAX_ALERTS = 200;
const nowTime = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok" });

let cameras = CAMERA_DEFS.map((d) => ({
  ...d,
  status: "clear",
  timestamp: null,
  scanned: false,
  imageWidth: null,
  imageHeight: null,
  people: 0,
  faces: [],
  sourceLabel: null,
  sourceVersion: null,
  detections: []
}));

// Media a user chose to show on a camera tile (instead of the default frame).
// Only the best frame is kept, as a small JPEG (~100-200 KB), in memory.
const sources = new Map(); // cameraId -> { jpeg: Buffer, label, version }

let alerts = [];
let seq = 0;
const nextId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

let settings = {
  hardhat: true,
  vest: true,
  line: false, // LINE push notifications (needs LINE_CHANNEL_ACCESS_TOKEN + LINE_TO on the server)
  blur: false // blur worker faces in the UI
};

export const cameraDefs = CAMERA_DEFS;

export function listCameras() {
  return cameras;
}

export function getCamera(id) {
  return cameras.find((c) => c.id === id) || null;
}

export function listAlerts(filter = "all") {
  if (filter === "all") return alerts;
  return alerts.filter((a) => a.severity === filter);
}

function pushAlert(camera, { label, severity }, source, acknowledged = false) {
  alerts.unshift({
    id: nextId("a"),
    title: label,
    location: `${camera.name} · ${camera.id}`,
    severity,
    time: nowTime(),
    createdAt: new Date().toISOString(),
    acknowledged,
    cameraId: camera.id,
    source
  });
  if (alerts.length > MAX_ALERTS) alerts.length = MAX_ALERTS;
}

/** Store the result of running the model on a camera frame. */
export function applyScan(cameraId, { violations, summary, faces, imageWidth, imageHeight, source = "scan" }) {
  const camera = getCamera(cameraId);
  if (!camera) return null;

  // keep "acknowledged" if the same violation type was already acknowledged
  const ackedTitles = new Set(
    alerts.filter((a) => a.cameraId === cameraId && a.acknowledged).map((a) => a.title)
  );
  alerts = alerts.filter((a) => a.cameraId !== cameraId);

  camera.detections = violations.map((v) => ({ id: nextId("d"), ...v }));
  camera.status = violations.length > 0 ? "live" : "clear";
  camera.timestamp = nowTime();
  camera.scanned = true;
  camera.people = summary?.people ?? 0;
  camera.faces = faces || [];
  if (imageWidth) camera.imageWidth = imageWidth;
  if (imageHeight) camera.imageHeight = imageHeight;

  // one alert per violation TYPE per camera (not per person) keeps the feed readable
  const seen = new Set();
  for (const v of violations) {
    if (seen.has(v.label)) continue;
    seen.add(v.label);
    pushAlert(camera, v, source, ackedTitles.has(v.label));
  }
  // newest first
  alerts.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  return camera;
}

/** A violation found on a user-uploaded photo, logged against a camera. */
export function addDetection(cameraId, detection) {
  const camera = getCamera(cameraId);
  if (!camera) return null;
  const newDetection = { id: nextId("d"), ...detection };
  camera.detections.push(newDetection);
  camera.status = "live";
  camera.timestamp = nowTime();
  pushAlert(camera, detection, "upload");
  return newDetection;
}

export function acknowledgeAlert(id) {
  const alert = alerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.acknowledged = true;
  return alert;
}

export function getStats() {
  const totalCameras = cameras.length;
  const activeCameras = cameras.filter((c) => c.scanned).length;
  const acknowledged = alerts.filter((a) => a.acknowledged).length;

  // compliance = share of detected people with NO violation, across all frames
  let people = 0;
  let violating = 0;
  for (const c of cameras) {
    people += c.people || 0;
    const boxes = new Set(c.detections.filter((d) => d.box).map((d) => `${d.box.x},${d.box.y},${d.box.w},${d.box.h}`));
    violating += boxes.size;
  }
  const complianceRate = people > 0 ? Math.max(0, Math.round((1 - violating / people) * 1000) / 10) : 100;

  return {
    activeCameras: { value: activeCameras, total: totalCameras },
    dailyWarnings: { value: alerts.length, deltaVsYesterday: null },
    complianceRate: { value: complianceRate, deltaVsYesterday: null },
    acknowledgedToday: acknowledged
  };
}

export function getSettings() {
  return settings;
}

export function updateSettings(patch) {
  settings = { ...settings, ...patch };
  return settings;
}

export function setCameraSource(cameraId, jpeg, label) {
  const camera = getCamera(cameraId);
  if (!camera) return null;
  const version = Date.now();
  sources.set(cameraId, { jpeg, label: label || "Uploaded media", version });
  camera.sourceLabel = label || "Uploaded media";
  camera.sourceVersion = version;
  return camera;
}

export function clearCameraSource(cameraId) {
  const camera = getCamera(cameraId);
  if (!camera) return null;
  sources.delete(cameraId);
  camera.sourceLabel = null;
  camera.sourceVersion = null;
  return camera;
}

export function getCameraSource(cameraId) {
  return sources.get(cameraId) || null;
}
