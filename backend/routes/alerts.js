import { Router } from "express";
import { listAlerts, acknowledgeAlert, getSettings } from "../data/store.js";
import { pushLine } from "../services/line.js";
import { buildLineMessage } from "../services/lineMessage.js";

const router = Router();

// GET /api/alerts?severity=critical|high|medium|all
router.get("/", (req, res) => {
  const severity = req.query.severity || "all";
  res.json(listAlerts(severity));
});

// PATCH /api/alerts/:id/acknowledge — mark an alert as reviewed
router.patch("/:id/acknowledge", (req, res) => {
  const alert = acknowledgeAlert(req.params.id);
  if (!alert) return res.status(404).json({ error: "Alert not found" });
  res.json(alert);
});

// POST /api/alerts/notify — called by the web app after it analysed a photo/video that
// contained critical violations. Sends a LINE message only if the LINE toggle is ON.
router.post("/notify", async (req, res) => {
  if (!getSettings().line) return res.json({ sent: false, reason: "disabled" });
  try {
    const r = await pushLine(buildLineMessage(req.body || {}));
    res.json(r);
  } catch (e) {
    res.status(502).json({ sent: false, reason: "network", error: e.message });
  }
});

export default router;
