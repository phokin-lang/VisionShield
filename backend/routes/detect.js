import { Router } from "express";
import multer from "multer";
import { detect, status, BusyError } from "../services/detector.js";
import sharp from "sharp";
import { applyScan, setCameraSource, getCamera, getSettings } from "../data/store.js";
import { objectsOf } from "../services/cameraScanner.js";
import { rateLimit } from "../middleware/rateLimit.js";

const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 8);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|bmp|gif|tiff)$/i.test(file.mimetype)) {
      return cb(Object.assign(new Error("Only JPEG, PNG, WebP, BMP, GIF or TIFF images are accepted."), { status: 415 }));
    }
    cb(null, true);
  }
});

const router = Router();

function singleUpload(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (!err) return next();
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: `Image too large (max ${MAX_UPLOAD_MB} MB).` });
    }
    return res.status(err.status || 400).json({ error: err.message });
  });
}

// POST /api/detect  (multipart: image, optional cameraId, optional zoneCameraId)
//   cameraId      log the result to that camera (its tile shows this image)
//   zoneCameraId  only use that camera's danger zones (video analysis frames)
// Runs the PPE model (Hard_hat, Vest) + COCO detector and returns
// { raw_detections, violations, summary, meta }.
router.post("/", rateLimit({ windowMs: 60_000, max: Number(process.env.DETECT_RATE_PER_MIN || 180), name: "detect" }), singleUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No image uploaded (field name: 'image')" });
  }

  const cameraId = req.body?.cameraId;
  if (cameraId && !getCamera(cameraId)) {
    return res.status(404).json({ error: "Camera not found" });
  }
  const zoneCamera = getCamera(cameraId || req.body?.zoneCameraId);

  try {
    const result = await detect(req.file.buffer, getSettings(), { zones: zoneCamera?.zones });

    // "Log violations to <camera>": the uploaded image / best video frame REPLACES that camera's
    // feed on the dashboard and Live cameras, together with its detections and alerts.
    if (cameraId) {
      const { data, info } = await sharp(req.file.buffer, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(960, 960, { fit: "inside" })
        .jpeg({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      const label = String(req.body?.sourceLabel || "Uploaded media").slice(0, 80);
      setCameraSource(cameraId, data, label);
      applyScan(cameraId, {
        violations: result.violations,
        summary: result.summary,
        faces: result.faces,
        objects: objectsOf(result.raw_detections),
        imageWidth: info.width,
        imageHeight: info.height,
        source: "upload"
      });
    }
    res.json({ modelReady: true, logged: Boolean(cameraId), ...result });
  } catch (err) {
    if (err instanceof BusyError) {
      res.set("Retry-After", "3");
      return res.status(429).json({ error: err.message });
    }
    if (err.code === "NOT_READY") {
      return res.status(503).json({
        modelReady: false,
        error: "Model is not loaded.",
        detail: status().error || "The detector is still starting up — try again in a few seconds."
      });
    }
    // sharp: unsupported / corrupt image, or too many pixels
    if (/Input|pixel|unsupported|corrupt|VipsJpeg|bad seek|decode/i.test(err.message)) {
      return res.status(400).json({ error: "Could not read that image. Try a different JPEG or PNG." });
    }
    console.error("[detect] inference failed:", err);
    res.status(500).json({ error: "Inference failed" });
  }
});

export default router;
