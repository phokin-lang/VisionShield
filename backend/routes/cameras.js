import { Router } from "express";
import { listCameras, getCamera, addDetection, getCameraSource, clearCameraSource, setCameraZones } from "../data/store.js";
import { scanAllCameras, scanCamera } from "../services/cameraScanner.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

// GET /api/cameras — all feeds with the latest model-derived detections
router.get("/", (req, res) => {
  res.json(listCameras());
});

// POST /api/cameras/scan — re-run the PPE model on every camera frame
router.post("/scan", rateLimit({ windowMs: 60_000, max: 6, name: "scan" }), async (req, res) => {
  const result = await scanAllCameras();
  res.json({ ...result, cameras: listCameras() });
});

// GET /api/cameras/:id/source — the user-uploaded frame shown on this camera (JPEG)
router.get("/:id/source", (req, res) => {
  const src = getCameraSource(req.params.id);
  if (!src) return res.status(404).json({ error: "No custom media on this camera" });
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=300" });
  res.send(src.jpeg);
});

// DELETE /api/cameras/:id/source — go back to the default feed and re-analyse it
router.delete("/:id/source", async (req, res) => {
  if (!clearCameraSource(req.params.id)) return res.status(404).json({ error: "Camera not found" });
  await scanCamera(req.params.id).catch((e) => console.error("[cameras] rescan failed:", e.message));
  res.json(getCamera(req.params.id));
});

// PUT /api/cameras/:id/zones — replace the camera's danger zones, then re-analyse its frame
// body: { zones: [{ name?, points: [[x%, y%], ...] }] }  (3-30 points each, up to 10 zones)
const MAX_ZONES = 10;
const MAX_POINTS = 30;
router.put("/:id/zones", async (req, res) => {
  if (!getCamera(req.params.id)) return res.status(404).json({ error: "Camera not found" });
  const input = req.body?.zones;
  if (!Array.isArray(input) || input.length > MAX_ZONES) {
    return res.status(400).json({ error: `zones must be an array of at most ${MAX_ZONES} polygons` });
  }
  const pct = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100;
  const zones = [];
  for (const [i, z] of input.entries()) {
    const pts = z?.points;
    if (!Array.isArray(pts) || pts.length < 3 || pts.length > MAX_POINTS || !pts.every((p) => Array.isArray(p) && p.length === 2 && pct(p[0]) && pct(p[1]))) {
      return res.status(400).json({ error: `zone ${i + 1}: needs 3-${MAX_POINTS} points, each [x, y] in 0-100 (% of the image)` });
    }
    zones.push({
      id: typeof z.id === "string" && z.id.length <= 40 ? z.id : `z${Date.now().toString(36)}${i}`,
      name: String(z.name || `Zone ${i + 1}`).slice(0, 40),
      points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10])
    });
  }
  setCameraZones(req.params.id, zones);
  await scanCamera(req.params.id).catch((e) => console.error("[cameras] rescan failed:", e.message));
  res.json(getCamera(req.params.id));
});

// GET /api/cameras/:id — single camera detail
router.get("/:id", (req, res) => {
  const camera = getCamera(req.params.id);
  if (!camera) return res.status(404).json({ error: "Camera not found" });
  res.json(camera);
});

// POST /api/cameras/:id/detections — push an external detection (e.g. from an edge device)
router.post("/:id/detections", (req, res) => {
  const { label, severity, box } = req.body || {};
  if (!label || !severity) {
    return res.status(400).json({ error: "label and severity are required" });
  }
  const detection = addDetection(req.params.id, { label, severity, box });
  if (!detection) return res.status(404).json({ error: "Camera not found" });
  res.status(201).json(detection);
});

export default router;
