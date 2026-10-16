// Store for cameras, alerts and settings.
//
// Detections are NOT hand-written anymore: services/cameraScanner.js runs the
// PPE model on each camera frame and calls applyScan() below. The exported
// function signatures are all the routes use.
//
// Everything is served from memory. When MONGODB_URI is set, initStore() loads
// the saved state on boot and every change is written back in the background:
//   cameras         one doc per camera (live state, not the fixed name/zone/image)
//   camera_sources  the uploaded JPEG shown on a camera tile
//   state           { _id: "settings" } and { _id: "alerts", items: [...] }
import { getDb, persist } from "./db.js";

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

// ---- MongoDB persistence (all no-ops without MONGODB_URI) ----

const DEF_FIELDS = ["id", "name", "zone", "image"]; // always taken from CAMERA_DEFS, never from the DB

function saveCamera(camera) {
  persist(`camera:${camera.id}`, (db) => {
    const doc = { ...camera };
    for (const k of DEF_FIELDS) delete doc[k];
    return db.collection("cameras").replaceOne({ _id: camera.id }, doc, { upsert: true });
  });
}

function saveAlerts() {
  persist("alerts", (db) => db.collection("state").replaceOne({ _id: "alerts" }, { items: alerts }, { upsert: true }));
}

function saveSettings() {
  persist("settings", (db) => db.collection("state").replaceOne({ _id: "settings" }, settings, { upsert: true }));
}

function saveSource(cameraId) {
  persist(`source:${cameraId}`, (db) => {
    const src = sources.get(cameraId);
    const col = db.collection("camera_sources");
    return src ? col.replaceOne({ _id: cameraId }, src, { upsert: true }) : col.deleteOne({ _id: cameraId });
  });
}

/** Load saved cameras, alerts, settings and tile media from MongoDB. Call once on boot. */
export async function initStore() {
  const db = getDb();
  if (!db) return;

  const [camDocs, srcDocs, stateDocs] = await Promise.all([
    db.collection("cameras").find({}).toArray(),
    db.collection("camera_sources").find({}).toArray(),
    db.collection("state").find({}).toArray()
  ]);

  for (const { _id, ...saved } of camDocs) {
    const camera = getCamera(_id);
    if (!camera) continue; // camera no longer defined in CAMERA_DEFS
    for (const k of DEF_FIELDS) delete saved[k];
    Object.assign(camera, saved);
  }
  for (const { _id, jpeg, label, version } of srcDocs) {
    if (getCamera(_id)) sources.set(_id, { jpeg: Buffer.isBuffer(jpeg) ? jpeg : Buffer.from(jpeg.buffer), label, version });
  }
  for (const { _id, ...doc } of stateDocs) {
    if (_id === "settings") settings = { ...settings, ...doc };
    if (_id === "alerts") alerts = (doc.items || []).slice(0, MAX_ALERTS);
  }
  console.log(`[db] loaded ${camDocs.length} camera(s), ${srcDocs.length} tile image(s), ${alerts.length} alert(s)`);
}

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
  saveCamera(camera);
  saveAlerts();
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
  saveCamera(camera);
  saveAlerts();
  return newDetection;
}

export function acknowledgeAlert(id) {
  const alert = alerts.find((a) => a.id === id);
  if (!alert) return null;
  alert.acknowledged = true;
  saveAlerts();
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
  saveSettings();
  return settings;
}

export function setCameraSource(cameraId, jpeg, label) {
  const camera = getCamera(cameraId);
  if (!camera) return null;
  const version = Date.now();
  sources.set(cameraId, { jpeg, label: label || "Uploaded media", version });
  camera.sourceLabel = label || "Uploaded media";
  camera.sourceVersion = version;
  saveSource(cameraId);
  saveCamera(camera);
  return camera;
}

export function clearCameraSource(cameraId) {
  const camera = getCamera(cameraId);
  if (!camera) return null;
  sources.delete(cameraId);
  camera.sourceLabel = null;
  camera.sourceVersion = null;
  saveSource(cameraId);
  saveCamera(camera);
  return camera;
}

export function getCameraSource(cameraId) {
  return sources.get(cameraId) || null;
}
