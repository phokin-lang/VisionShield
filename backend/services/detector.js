// Native Node inference for VisionShield — no Python, no PyTorch.
//
// Two YOLOv8-nano ONNX models run back-to-back on ONE shared 640x640 tensor:
//   1. ppe_hat_vest_nano.onnx  — the friend-trained PPE model  (Hard_hat, Vest)
//   2. person_yolov8n.onnx     — stock COCO YOLOv8n, class 0 only (Person)
//   3. face_scrfd_500m.onnx    — SCRFD-500M face detector (2.5 MB), only used for the
//                                "blur worker faces" privacy setting
// A person with no Hard_hat / Vest on their body => compliance violation.
//
// Memory design (Render 512 MB):
//   * onnxruntime-node (CPU only), 1 thread, memory arena + mem-pattern OFF
//   * one preallocated 640x640x3 Float32 tensor reused for every request
//   * sharp cache disabled, 1 libvips thread, hard cap on input pixels
//   * a strict FIFO queue — only ONE inference ever runs at a time
//   * both sessions are loaded + warmed at boot so a memory problem shows up
//     at deploy time instead of in the middle of a user request

import * as ort from "onnxruntime-node";
import sharp from "sharp";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, "..", "models");

const SIZE = 640;
const PPE_CLASSES = ["Hard_hat", "Vest"]; // must match data.yaml of the trained model
const PAD = 114 / 255;

export const CONFIG = {
  ppeConf: Number(process.env.PPE_CONF || 0.5),
  personConf: Number(process.env.PERSON_CONF || 0.4),
  faceConf: Number(process.env.FACE_CONF || 0.45),
  iou: Number(process.env.NMS_IOU || 0.6),
  maxQueue: Number(process.env.MAX_INFERENCE_QUEUE || 4),
  maxPixels: Number(process.env.MAX_INPUT_PIXELS || 40_000_000)
};

sharp.cache(false);
sharp.concurrency(1);

let ppeSession = null;
let personSession = null;
let faceSession = null;
let inputName = { ppe: null, person: null, face: null };
let ready = false;
let loadError = null;

// Single reusable input buffer: [1,3,640,640] float32 = 4.9 MB
const tensorData = new Float32Array(3 * SIZE * SIZE);

const SESSION_OPTS = {
  executionProviders: ["cpu"],
  graphOptimizationLevel: "all",
  intraOpNumThreads: 1,
  interOpNumThreads: 1,
  executionMode: "sequential",
  enableCpuMemArena: false,
  enableMemPattern: false,
  logSeverityLevel: 3
};

// SCRFD wants (x*255 - 127.5) / 128 instead of x in [0,1]; use one extra reusable 4.9 MB buffer.
const faceData = new Float32Array(3 * SIZE * SIZE);
function faceNorm(tensor) {
  const src = tensor.data;
  for (let i = 0; i < src.length; i++) faceData[i] = (src[i] * 255 - 127.5) / 128;
  return new ort.Tensor("float32", faceData, [1, 3, SIZE, SIZE]);
}

// ---------- queue (strict concurrency = 1, bounded backlog) ----------
let tail = Promise.resolve();
let pending = 0;

export class BusyError extends Error {
  constructor() {
    super("Detector is busy, please retry in a moment");
    this.code = "BUSY";
  }
}

function enqueue(task) {
  if (pending >= CONFIG.maxQueue) return Promise.reject(new BusyError());
  pending++;
  const run = tail.then(task, task);
  tail = run.catch(() => {}).finally(() => {
    pending--;
  });
  return run;
}

// ---------- preprocessing ----------
// Letterbox into the shared tensor. Returns the geometry needed to map boxes
// back to % of the ORIGINAL image (percentages don't depend on the scale).
async function preprocess(buffer) {
  const { data, info } = await sharp(buffer, { limitInputPixels: CONFIG.maxPixels, failOn: "error" })
    .rotate() // honour EXIF orientation (phone photos)
    .resize(SIZE, SIZE, { fit: "inside" })
    .removeAlpha()
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const nw = info.width;
  const nh = info.height;
  const padX = Math.floor((SIZE - nw) / 2);
  const padY = Math.floor((SIZE - nh) / 2);

  tensorData.fill(PAD);
  const plane = SIZE * SIZE;
  for (let y = 0; y < nh; y++) {
    const rowOut = (y + padY) * SIZE + padX;
    const rowIn = y * nw * 3;
    for (let x = 0; x < nw; x++) {
      const i = rowIn + x * 3;
      const o = rowOut + x;
      tensorData[o] = data[i] / 255;
      tensorData[plane + o] = data[i + 1] / 255;
      tensorData[2 * plane + o] = data[i + 2] / 255;
    }
  }
  return { nw, nh, padX, padY };
}

// ---------- postprocessing ----------
function iouOf(a, b) {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union <= 0 ? 0 : inter / union;
}

// YOLOv8 head output: [1, 4+nc, 8400] (channel-major): cx,cy,w,h then class scores.
function decode(output, numClasses, classFilter, conf, geo) {
  const data = output.data;
  const n = output.dims[2];
  const candidates = [];

  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestScore = conf;
    for (const c of classFilter) {
      const s = data[(4 + c) * n + i];
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    if (best < 0) continue;
    const cx = data[i];
    const cy = data[n + i];
    const w = data[2 * n + i];
    const h = data[3 * n + i];
    candidates.push({
      cls: best,
      score: bestScore,
      x1: cx - w / 2,
      y1: cy - h / 2,
      x2: cx + w / 2,
      y2: cy + h / 2
    });
  }

  // per-class greedy NMS
  candidates.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of candidates) {
    let drop = false;
    for (const k of kept) {
      if (k.cls === c.cls && iouOf(k, c) > CONFIG.iou) {
        drop = true;
        break;
      }
    }
    if (!drop) kept.push(c);
    if (kept.length >= 100) break;
  }

  // map from 640-letterbox space to % of the original image
  const clampPct = (v) => Math.max(0, Math.min(100, v));
  return kept.map((k) => {
    const x1 = clampPct(((k.x1 - geo.padX) / geo.nw) * 100);
    const y1 = clampPct(((k.y1 - geo.padY) / geo.nh) * 100);
    const x2 = clampPct(((k.x2 - geo.padX) / geo.nw) * 100);
    const y2 = clampPct(((k.y2 - geo.padY) / geo.nh) * 100);
    return {
      cls: k.cls,
      confidence: Math.round(k.score * 1000) / 1000,
      box: {
        x: Math.round(x1 * 10) / 10,
        y: Math.round(y1 * 10) / 10,
        w: Math.round((x2 - x1) * 10) / 10,
        h: Math.round((y2 - y1) * 10) / 10
      }
    };
  });
}

// ---------- compliance rules ----------
const center = (b) => ({ cx: b.x + b.w / 2, cy: b.y + b.h / 2 });

function wearsHat(person, hats) {
  const p = person.box;
  return hats.some((h) => {
    const { cx, cy } = center(h.box);
    // hard hat centre must be inside the person horizontally and in the head zone
    return cx >= p.x && cx <= p.x + p.w && cy >= p.y - 0.12 * p.h && cy <= p.y + 0.45 * p.h;
  });
}

function wearsVest(person, vests) {
  const p = person.box;
  return vests.some((v) => {
    const { cx, cy } = center(v.box);
    // vest centre must be inside the person's torso area
    return cx >= p.x && cx <= p.x + p.w && cy >= p.y + 0.1 * p.h && cy <= p.y + 0.85 * p.h;
  });
}

function evaluate(detections, checks) {
  const people = detections.filter((d) => d.label === "Person");
  const hats = detections.filter((d) => d.label === "Hard_hat");
  const vests = detections.filter((d) => d.label === "Vest");

  const violations = [];
  for (const person of people) {
    // ignore tiny background people — too small for PPE to be judged reliably
    if (person.box.h < 8 || person.box.w < 2) continue;
    if (checks.hardhat && !wearsHat(person, hats)) {
      violations.push({ label: "No Hard Hat Detected", severity: "critical", box: person.box });
    }
    if (checks.vest && !wearsVest(person, vests)) {
      violations.push({ label: "No Safety Vest Detected", severity: "medium", box: person.box });
    }
  }
  return { people: people.length, hats: hats.length, vests: vests.length, violations };
}

// ---------- SCRFD face detector ----------
// 9 outputs: for strides 8/16/32 -> scores [N,1], boxes [N,4] (distances * stride), keypoints [N,10].
// N = (640/stride)^2 * 2 anchors. Input is RGB normalised as (x - 127.5) / 128.
const FACE_STRIDES = [8, 16, 32];

function decodeFaces(outputs, geo, minScore) {
  const groups = new Map(); // N -> { score, bbox }
  for (const out of Object.values(outputs)) {
    const [n, c] = out.dims;
    if (!groups.has(n)) groups.set(n, {});
    if (c === 1) groups.get(n).score = out.data;
    else if (c === 4) groups.get(n).bbox = out.data;
  }

  const cands = [];
  for (const stride of FACE_STRIDES) {
    const g = SIZE / stride;
    const grp = groups.get(g * g * 2);
    if (!grp?.score || !grp?.bbox) continue;
    for (let i = 0; i < g * g * 2; i++) {
      const score = grp.score[i];
      if (score < minScore) continue;
      const loc = i >> 1; // 2 anchors per cell
      const cx = (loc % g) * stride;
      const cy = Math.floor(loc / g) * stride;
      cands.push({
        score,
        x1: cx - grp.bbox[i * 4] * stride,
        y1: cy - grp.bbox[i * 4 + 1] * stride,
        x2: cx + grp.bbox[i * 4 + 2] * stride,
        y2: cy + grp.bbox[i * 4 + 3] * stride
      });
    }
  }

  cands.sort((a, b) => b.score - a.score);
  const kept = [];
  for (const c of cands) {
    if (!kept.some((k) => iouOf(k, c) > 0.4)) kept.push(c);
    if (kept.length >= 30) break;
  }

  const clamp = (v) => Math.max(0, Math.min(100, v));
  const round = (v) => Math.round(v * 10) / 10;
  return kept.map((k) => {
    // the detector box spans eyebrows→chin; grow it so hair/ears/forehead are covered too
    const w = k.x2 - k.x1;
    const h = k.y2 - k.y1;
    const x1 = clamp(((k.x1 - w * 0.22 - geo.padX) / geo.nw) * 100);
    const x2 = clamp(((k.x2 + w * 0.22 - geo.padX) / geo.nw) * 100);
    const y1 = clamp(((k.y1 - h * 0.35 - geo.padY) / geo.nh) * 100);
    const y2 = clamp(((k.y2 + h * 0.15 - geo.padY) / geo.nh) * 100);
    return { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1), score: k.score };
  });
}

// Combine the face detector with the person boxes so nobody is left unblurred:
//  1. confident faces (score >= FACE_CONF) are always blurred;
//  2. a person with no confident face gets the best weak candidate (score >= 0.2) inside
//     the upper half of their box (profile / tiny faces score low);
//  3. still nothing and the person is small in the frame (< 60% tall -> far / medium shot,
//     where a head box derived from the body is reliable): blur an estimated head box.
//  Large close-ups with no detected face are left alone: nobody is identifiable from there.
function collectFaces(cands, detections, geo) {
  const faces = cands.filter((f) => f.score >= CONFIG.faceConf);
  const people = detections.filter((d) => d.label === "Person" && d.box.h >= 8);
  const inside = (f, b, topFrac = 1) => {
    const cx = f.x + f.w / 2;
    const cy = f.y + f.h / 2;
    return cx >= b.x && cx <= b.x + b.w && cy >= b.y - 0.05 * b.h && cy <= b.y + b.h * topFrac;
  };
  for (const p of people) {
    if (faces.some((f) => inside(f, p.box, 0.5) && f.w < p.box.w * 1.3)) continue;
    const weak = cands.filter((f) => f.score < CONFIG.faceConf && inside(f, p.box, 0.5)).sort((a, b) => b.score - a.score)[0];
    if (weak) {
      faces.push(weak);
      continue;
    }
    if (p.box.h < 60) {
      const hats = detections.filter((d) => d.label === "Hard_hat");
      faces.push(...headRegions([p, ...hats], geo));
    }
  }
  return faces.map(({ x, y, w, h }) => ({ x, y, w, h }));
}

// FALLBACK (only if the face model failed to load): head regions for the blur setting.
// The friend's detect_blur.py blurs a fixed 25% strip at the top of every person box. That
// misses faces in close-ups (head is ~40% of a waist-up box), so here the head size is
// derived from the person's WIDTH (shoulders ≈ 2 head-widths), clamped to 20-50% of the box,
// and refined with the Hard_hat box when one is found on that person.
function headRegions(detections, geo) {
  const aspect = geo.nw / geo.nh; // frame width / height
  const hats = detections.filter((d) => d.label === "Hard_hat");
  const clamp = (v) => Math.max(0, Math.min(100, v));
  const round = (v) => Math.round(v * 10) / 10;

  return detections
    .filter((d) => d.label === "Person" && d.box.h >= 8)
    .map((p) => {
      const b = p.box;
      // head height in % of frame height, head width in % of frame width
      const headH = Math.min(Math.max(b.w * aspect * 0.62, b.h * 0.22), b.h * 0.5);
      const headW = Math.min(b.w, (headH * 0.95) / aspect);
      const cx = b.x + b.w / 2;
      let x1 = cx - headW / 2;
      let x2 = cx + headW / 2;
      let y1 = b.y;
      let y2 = b.y + headH;

      const hat = hats.find((h) => {
        const hx = h.box.x + h.box.w / 2;
        const hy = h.box.y + h.box.h / 2;
        return hx >= b.x && hx <= b.x + b.w && hy >= b.y - 0.12 * b.h && hy <= b.y + 0.45 * b.h;
      });
      if (hat) {
        // hat covers roughly the top half of the head -> the face ends ~1.9 hat-heights down
        x1 = Math.min(x1, hat.box.x - hat.box.w * 0.1);
        x2 = Math.max(x2, hat.box.x + hat.box.w * 1.1);
        y1 = Math.min(y1, hat.box.y);
        y2 = Math.max(y2, hat.box.y + hat.box.h * 1.9);
      }

      // 12% safety margin around the head, kept inside the frame
      const padX = (x2 - x1) * 0.12;
      const padY = (y2 - y1) * 0.12;
      x1 = clamp(x1 - padX);
      x2 = clamp(x2 + padX);
      y1 = clamp(y1 - padY);
      y2 = clamp(y2 + padY);
      return { x: round(x1), y: round(y1), w: round(x2 - x1), h: round(y2 - y1) };
    });
}

// ---------- public API ----------
export async function loadModels() {
  try {
    const t0 = Date.now();
    ppeSession = await ort.InferenceSession.create(path.join(MODELS_DIR, "ppe_hat_vest_nano.onnx"), SESSION_OPTS);
    personSession = await ort.InferenceSession.create(path.join(MODELS_DIR, "person_yolov8n.onnx"), SESSION_OPTS);
    try {
      faceSession = await ort.InferenceSession.create(path.join(MODELS_DIR, "face_scrfd_500m.onnx"), SESSION_OPTS);
    } catch (e) {
      faceSession = null;
      console.warn("[detector] face model not loaded, blur falls back to head-box heuristic:", e.message);
    }
    inputName = {
      ppe: ppeSession.inputNames[0],
      person: personSession.inputNames[0],
      face: faceSession ? faceSession.inputNames[0] : null
    };

    // warm-up: allocate everything now, with a blank gray frame
    tensorData.fill(PAD);
    const t = new ort.Tensor("float32", tensorData, [1, 3, SIZE, SIZE]);
    await ppeSession.run({ [inputName.ppe]: t });
    await personSession.run({ [inputName.person]: t });
    if (faceSession) await faceSession.run({ [inputName.face]: faceNorm(t) });

    ready = true;
    console.log(`[detector] models loaded + warmed in ${Date.now() - t0} ms`);
  } catch (err) {
    loadError = err;
    ready = false;
    console.error("[detector] failed to load models:", err);
  }
}

export function status() {
  return {
    ready,
    error: loadError ? String(loadError.message || loadError) : null,
    models: {
      ppe: "ppe_hat_vest_nano.onnx",
      person: "person_yolov8n.onnx",
      face: faceSession ? "face_scrfd_500m.onnx" : null
    },
    classes: ["Person", ...PPE_CLASSES],
    config: { ppeConf: CONFIG.ppeConf, personConf: CONFIG.personConf, iou: CONFIG.iou }
  };
}

/**
 * Run PPE detection on an encoded image (jpeg/png/webp/...).
 * @param {Buffer} buffer
 * @param {{hardhat?: boolean, vest?: boolean}} checks which rules to enforce
 */
export function detect(buffer, checks = {}) {
  if (!ready) {
    const e = new Error("Model not loaded");
    e.code = "NOT_READY";
    return Promise.reject(e);
  }
  const rules = { hardhat: checks.hardhat !== false, vest: checks.vest !== false };

  return enqueue(async () => {
    const t0 = Date.now();
    const geo = await preprocess(buffer);
    const tensor = new ort.Tensor("float32", tensorData, [1, 3, SIZE, SIZE]);

    const tInf = Date.now();
    const ppeOut = (await ppeSession.run({ [inputName.ppe]: tensor }))[ppeSession.outputNames[0]];
    const ppeDets = decode(ppeOut, PPE_CLASSES.length, [0, 1], CONFIG.ppeConf, geo).map((d) => ({
      label: PPE_CLASSES[d.cls],
      confidence: d.confidence,
      box: d.box
    }));
    ppeOut.dispose?.();

    const personOut = (await personSession.run({ [inputName.person]: tensor }))[personSession.outputNames[0]];
    const personDets = decode(personOut, 80, [0], CONFIG.personConf, geo).map((d) => ({
      label: "Person",
      confidence: d.confidence,
      box: d.box
    }));
    personOut.dispose?.();

    const raw = [...personDets, ...ppeDets];
    const summary = evaluate(raw, rules);

    // real face boxes (SCRFD) for the privacy blur; heuristic head boxes only as a fallback
    let faces;
    if (faceSession) {
      const faceOut = await faceSession.run({ [inputName.face]: faceNorm(tensor) });
      faces = collectFaces(decodeFaces(faceOut, geo, 0.2), raw, geo);
      for (const o of Object.values(faceOut)) o.dispose?.();
    } else {
      faces = headRegions(raw, geo);
    }

    return {
      raw_detections: raw,
      violations: summary.violations,
      faces,
      summary: { people: summary.people, hard_hats: summary.hats, vests: summary.vests },
      meta: {
        inference_ms: Date.now() - tInf,
        total_ms: Date.now() - t0,
        rules
      }
    };
  });
}
