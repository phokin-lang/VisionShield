import { Router } from "express";
import { getSettings, updateSettings } from "../data/store.js";
import { scanAllCameras } from "../services/cameraScanner.js";
import { lineConfigured, pushLine } from "../services/line.js";

const router = Router();
const ALLOWED = ["hardhat", "vest", "line", "blur", "danger_zone", "vehicle_proximity", "fall", "crowding", "phone_use"];
// numeric thresholds: [min, max, integer?]
const NUMERIC = {
  proximity_ratio: [0.1, 3, false],
  crowd_max: [1, 100, true],
  fall_ratio: [1, 4, false],
  fall_min_height: [1, 50, false]
};
// changing any of these re-evaluates the camera frames
const RULE_KEYS = [...ALLOWED.filter((k) => k !== "line" && k !== "blur"), ...Object.keys(NUMERIC)];

const view = (s) => ({ ...s, lineConfigured: lineConfigured() });

// GET /api/settings — current toggle state
router.get("/", (req, res) => {
  res.json(view(getSettings()));
});

// PUT /api/settings — persist a settings change from the Settings page
router.put("/", (req, res) => {
  const patch = req.body || {};
  const clean = {};
  for (const [k, v] of Object.entries(patch)) {
    if (ALLOWED.includes(k) && typeof v === "boolean") clean[k] = v;
    if (NUMERIC[k]) {
      const [min, max, int] = NUMERIC[k];
      const n = Number(v);
      if (typeof v === "boolean" || v === null || v === "" || !Number.isFinite(n) || n < min || n > max || (int && !Number.isInteger(n))) {
        return res.status(400).json({ error: `${k} must be ${int ? "a whole number" : "a number"} between ${min} and ${max}` });
      }
      clean[k] = n;
    }
  }
  const before = getSettings();
  const saved = updateSettings(clean);

  // detection rules changed -> re-evaluate the camera frames in the background
  if (RULE_KEYS.some((k) => saved[k] !== before[k])) {
    scanAllCameras().catch((e) => console.error("[settings] rescan failed:", e.message));
  }
  res.json(view(saved));
});

// POST /api/settings/line-test — send a test message so the user can verify the LINE setup
router.post("/line-test", async (req, res) => {
  try {
    const r = await pushLine("✅ VisionShield: LINE notifications are working.", { force: true });
    res.json(r);
  } catch (e) {
    res.status(502).json({ sent: false, reason: "network", error: e.message });
  }
});

export default router;
