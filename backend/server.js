import "dotenv/config";
import express from "express";
import cors from "cors";
import camerasRouter from "./routes/cameras.js";
import alertsRouter from "./routes/alerts.js";
import statsRouter from "./routes/stats.js";
import authRouter from "./routes/auth.js";
import settingsRouter from "./routes/settings.js";
import detectRouter from "./routes/detect.js";
import { requireAuth } from "./middleware/auth.js";
import { loadModels, status as detectorStatus } from "./services/detector.js";
import { scanAllCameras } from "./services/cameraScanner.js";
import { seedAdmin } from "./data/users.js";

const app = express();
const PORT = process.env.PORT || 4000;
const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.JWT_SECRET) {
  console.warn("[security] JWT_SECRET is not set — using an insecure default. Set it in Render > Environment!");
}

// Render sits behind a proxy: needed so req.ip (rate limiting) is the real client.
app.set("trust proxy", 1);
app.disable("x-powered-by");

// CORS_ORIGIN accepts one origin or a comma-separated list (e.g. prod + preview URLs).
const origins = (process.env.CORS_ORIGIN || "*").split(",").map((s) => s.trim().replace(/\/$/, ""));
app.use(
  cors({
    origin: origins.includes("*") ? "*" : (origin, cb) => cb(null, !origin || origins.includes(origin)),
    maxAge: 86400
  })
);

app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer"
  });
  next();
});

app.use(express.json({ limit: "100kb" }));

app.use((req, res, next) => {
  if (req.path !== "/api/health") console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  next();
});


// Public: used by Render's health check AND to see model/memory state at a glance.
app.get("/api/health", (req, res) => {
  const m = process.memoryUsage();
  const det = detectorStatus();
  res.status(det.ready ? 200 : 503).json({
    status: det.ready ? "ok" : "starting",
    service: "artisafesight-backend",
    time: new Date().toISOString(),
    model: det,
    memory: { rssMB: Math.round(m.rss / 1048576), heapUsedMB: Math.round(m.heapUsed / 1048576) }
  });
});

app.use("/api/auth", authRouter);

app.use("/api/cameras", requireAuth, camerasRouter);
app.use("/api/alerts", requireAuth, alertsRouter);
app.use("/api/stats", requireAuth, statsRouter);
app.use("/api/settings", requireAuth, settingsRouter);
app.use("/api/detect", requireAuth, detectRouter);

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Invalid JSON body" });
  console.error("[error]", err);
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`ArtiSafeSight backend listening on :${PORT}`);
  // Bind the port first (Render needs it fast), then load models + scan in the background.
  (async () => {
    await seedAdmin();
    await loadModels();
    await scanAllCameras();
    const m = process.memoryUsage();
    console.log(`[boot] ready — rss ${Math.round(m.rss / 1048576)} MB`);
  })().catch((e) => console.error("[boot] failed:", e));
});

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e));
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down");
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
});
