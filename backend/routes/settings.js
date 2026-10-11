import { Router } from "express";
import { getSettings, updateSettings } from "../data/store.js";
import { scanAllCameras } from "../services/cameraScanner.js";
import { lineConfigured, pushLine } from "../services/line.js";

const router = Router();
const ALLOWED = ["hardhat", "vest", "line", "blur"];

const view = (s) => ({ ...s, lineConfigured: lineConfigured() });

// GET /api/settings — current toggle state
router.get("/", (req, res) => {
  res.json(view(getSettings()));
});

// PUT /api/settings — persist a settings change from the Settings page
router.put("/", (req, res) => {
  const patch = req.body || {};
  const clean = Object.fromEntries(
    Object.entries(patch).filter(([k, v]) => ALLOWED.includes(k) && typeof v === "boolean")
  );
  const before = getSettings();
  const saved = updateSettings(clean);

  // detection rules changed -> re-evaluate the camera frames in the background
  if (saved.hardhat !== before.hardhat || saved.vest !== before.vest) {
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
