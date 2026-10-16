import fs from "fs/promises";
import path from "path";
import sharp from "sharp";
import { fileURLToPath } from "url";
import { detect, status as detectorStatus, VEHICLE_LABELS } from "./detector.js";
import { cameraDefs, applyScan, getSettings, getCameraSource, getCamera } from "../data/store.js";

// non-violation objects worth drawing on the camera tile
export const objectsOf = (raw) =>
  raw.filter((d) => VEHICLE_LABELS.includes(d.label) || d.label === "Cell_phone" || d.label === "Head");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets", "cameras");

let scanning = null; // in-flight promise, so concurrent callers share one scan

async function scanOne(def) {
  // a user-uploaded image/video frame replaces the default camera frame
  const custom = getCameraSource(def.id);
  const buf = custom ? custom.jpeg : await fs.readFile(path.join(ASSETS, path.basename(def.image)));
  const meta = await sharp(buf).metadata();
  const result = await detect(buf, getSettings(), { zones: getCamera(def.id)?.zones });
  applyScan(def.id, {
    violations: result.violations,
    summary: result.summary,
    faces: result.faces,
    objects: objectsOf(result.raw_detections),
    imageWidth: meta.width,
    imageHeight: meta.height,
    source: custom ? "upload" : "scan"
  });
  return result.violations.length;
}

/** Re-scan a single camera (used when its custom media is removed). */
export async function scanCamera(cameraId) {
  const def = cameraDefs.find((d) => d.id === cameraId);
  if (!def || !detectorStatus().ready) return false;
  await scanOne(def);
  return true;
}

/** Run the model over every camera frame (sequentially: memory-friendly). */
export function scanAllCameras() {
  if (!detectorStatus().ready) return Promise.resolve({ scanned: 0, skipped: "model-not-ready" });
  if (scanning) return scanning;

  scanning = (async () => {
    const t0 = Date.now();
    let scanned = 0;
    let violations = 0;
    for (const def of cameraDefs) {
      try {
        violations += await scanOne(def);
        scanned++;
      } catch (err) {
        console.error(`[scanner] ${def.id} failed:`, err.message);
      }
    }
    console.log(`[scanner] ${scanned}/${cameraDefs.length} cameras scanned, ${violations} violations, ${Date.now() - t0} ms`);
    return { scanned, violations, ms: Date.now() - t0 };
  })().finally(() => {
    scanning = null;
  });

  return scanning;
}
