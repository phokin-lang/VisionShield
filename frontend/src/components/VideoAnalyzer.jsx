import { useEffect, useMemo, useRef, useState } from "react";
import { UploadCloud, Loader2, AlertTriangle, ShieldCheck, Film, X } from "lucide-react";
import { api } from "../api.js";
import { FitFrame } from "./DetectionImage.jsx";

const MAX_SAMPLES = 90; // frames analysed per video
const MAX_SIDE = 960; // frames are downscaled before upload
const SEVERITY_STYLES = {
  critical: { border: "border-alert-critical", bg: "bg-alert-critical" },
  medium: { border: "border-alert-high", bg: "bg-alert-high" }
};
const LABEL_COLORS = { Person: "#94a3b8", Hard_hat: "#3ee6c4", Vest: "#a3e635" };

const fmt = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitFor(el, event, errorEvent = "error") {
  return new Promise((resolve, reject) => {
    const ok = () => {
      cleanup();
      resolve();
    };
    const bad = () => {
      cleanup();
      reject(new Error("This video format can't be decoded by your browser. Try an MP4 (H.264) or WebM file."));
    };
    const cleanup = () => {
      el.removeEventListener(event, ok);
      el.removeEventListener(errorEvent, bad);
    };
    el.addEventListener(event, ok);
    el.addEventListener(errorEvent, bad);
  });
}

export default function VideoAnalyzer({ cameras = [], blurFaces = false, onLogged }) {
  const inputRef = useRef(null);
  const playerRef = useRef(null);
  const abortRef = useRef(false);

  const [file, setFile] = useState(null);
  const [mediaUrl, setMediaUrl] = useState(null);
  const [kind, setKind] = useState(null); // "video" | "image"
  const [ratio, setRatio] = useState(null);
  const [duration, setDuration] = useState(0);
  const [status, setStatus] = useState("idle"); // idle | analyzing | done
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [samples, setSamples] = useState([]);
  const [error, setError] = useState(null);
  const [cameraId, setCameraId] = useState("");
  const [nowT, setNowT] = useState(0);
  const [notified, setNotified] = useState(null);
  const [loggedTo, setLoggedTo] = useState(null);

  useEffect(() => () => mediaUrl && URL.revokeObjectURL(mediaUrl), [mediaUrl]);

  function reset() {
    abortRef.current = true;
    setFile(null);
    setMediaUrl(null);
    setKind(null);
    setRatio(null);
    setSamples([]);
    setStatus("idle");
    setError(null);
    setNotified(null);
    setLoggedTo(null);
    setNowT(0);
  }

  function handleFile(f) {
    if (!f) return;
    const isVideo = f.type.startsWith("video/");
    const isImage = f.type.startsWith("image/");
    if (!isVideo && !isImage) {
      setError("Please choose a video (MP4/WebM) or an image.");
      return;
    }
    abortRef.current = true;
    setFile(f);
    setKind(isVideo ? "video" : "image");
    setMediaUrl(URL.createObjectURL(f));
    setSamples([]);
    setStatus("idle");
    setError(null);
    setNotified(null);
    setRatio(null);
    setNowT(0);
  }

  // ---- analysis ------------------------------------------------------------
  async function sendFrame(blob, opts = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        return await api.analyzeImage(blob, opts.cameraId, {
          skipDownscale: opts.skipDownscale ?? true,
          sourceLabel: opts.label
        });
      } catch (err) {
        if (/busy|many requests/i.test(err.message) && attempt < 3) {
          await sleep(1500 * (attempt + 1));
          continue;
        }
        throw err;
      }
    }
  }

  async function analyze() {
    if (!file) return;
    abortRef.current = false;
    setStatus("analyzing");
    setError(null);
    setSamples([]);
    setNotified(null);
    setLoggedTo(null);
    const results = [];
    let bestBlob = null; // frame with the most violations -> shown on the chosen camera
    let bestScore = -1;
    let bestT = 0;
    let fallbackBlob = null; // used when nothing was flagged: the frame with the most people
    let fallbackScore = -1;
    let fallbackT = 0;

    try {
      if (kind === "image") {
        setProgress({ done: 0, total: 1 });
        const r = await sendFrame(file);
        results.push({ t: 0, ...r });
        bestBlob = file;
        setProgress({ done: 1, total: 1 });
      } else {
        // decode the video in the browser and send sampled frames — no video upload,
        // no ffmpeg on the server, and server memory stays flat.
        const v = document.createElement("video");
        v.muted = true;
        v.preload = "auto";
        v.playsInline = true;
        v.src = mediaUrl;
        await waitFor(v, "loadeddata");
        const dur = v.duration;
        if (!Number.isFinite(dur) || dur <= 0) throw new Error("Could not read the video duration.");

        const step = Math.max(1, dur / MAX_SAMPLES);
        const times = [];
        for (let t = 0; t < dur; t += step) times.push(Math.min(t, Math.max(0, dur - 0.05)));
        setProgress({ done: 0, total: times.length });

        const scale = Math.min(1, MAX_SIDE / Math.max(v.videoWidth, v.videoHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        const ctx = canvas.getContext("2d");

        for (let i = 0; i < times.length; i++) {
          if (abortRef.current) throw Object.assign(new Error("cancelled"), { cancelled: true });
          v.currentTime = times[i];
          await waitFor(v, "seeked");
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
          if (!blob) throw new Error("Could not capture a video frame.");
          const r = await sendFrame(blob);
          results.push({ t: times[i], ...r });
          const score = (r.violations?.length || 0) * 10 + (r.summary?.people || 0);
          if ((r.violations?.length || 0) > 0 && score > bestScore) {
            bestScore = score;
            bestBlob = blob;
            bestT = times[i];
          }
          const people = r.summary?.people || 0;
          if (people > fallbackScore) {
            fallbackScore = people;
            fallbackBlob = blob;
            fallbackT = times[i];
          }
          setSamples([...results]);
          setProgress({ done: i + 1, total: times.length });
        }
        v.removeAttribute("src");
        v.load();
      }

      setSamples(results);
      setStatus("done");

      // ---- after-analysis actions (best effort, never fail the analysis) ----
      const critical = results.flatMap((s) => s.violations || []).filter((x) => x.severity === "critical");
      const flagged = results.filter((s) => s.violations?.length);
      // "Log violations to <camera>": send the best frame again with the camera id. The server
      // stores it as that camera's feed, so the dashboard + Live cameras show it with its boxes.
      if (cameraId) {
        const blob = bestBlob || fallbackBlob || (kind === "image" ? file : null);
        const t = bestBlob ? bestT : fallbackT;
        if (blob) {
          try {
            await sendFrame(blob, {
              cameraId,
              skipDownscale: kind !== "image",
              label: kind === "video" ? `${file.name} @ ${fmt(t)}` : file.name
            });
            setLoggedTo(cameras.find((c) => c.id === cameraId)?.name || cameraId);
            onLogged?.();
          } catch (e) {
            setError(`Analysis finished, but showing it on the camera failed: ${e.message}`);
          }
        }
      }
      if (critical.length) {
        try {
          const first = results.find((s) => s.violations?.some((x) => x.severity === "critical"));
          // most people seen with each violation in any single frame (avoids counting the same person per frame)
          const maxPerLabel = {};
          for (const smp of results) {
            const c = {};
            for (const v of smp.violations || []) c[v.label] = (c[v.label] || 0) + 1;
            for (const [l, n] of Object.entries(c)) maxPerLabel[l] = Math.max(maxPerLabel[l] || 0, n);
          }
          const cam = cameras.find((c) => c.id === cameraId);
          const r = await api.notifyViolation({
            file: file.name,
            kind,
            firstSeen: kind === "video" ? fmt(first.t) : null,
            camera: cam ? { name: cam.name, zone: cam.zone } : null,
            violations: Object.entries(maxPerLabel).map(([label, count]) => ({ label, count })),
            flaggedFrames: flagged.length,
            totalFrames: results.length
          });
          setNotified(r);
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      if (err.cancelled) {
        setStatus(results.length ? "done" : "idle");
      } else {
        setError(err.message || "Analysis failed.");
        setStatus(results.length ? "done" : "idle");
      }
    }
  }

  // ---- playback overlay -----------------------------------------------------
  useEffect(() => {
    if (kind !== "video") return;
    let raf;
    const tick = () => {
      const v = playerRef.current;
      if (v) setNowT((prev) => (Math.abs(prev - v.currentTime) > 0.05 ? v.currentTime : prev));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [kind, mediaUrl]);

  const interval = useMemo(() => (samples.length > 1 ? samples[1].t - samples[0].t : 1), [samples]);
  const current = useMemo(() => {
    if (!samples.length) return null;
    if (kind === "image") return samples[0];
    let best = null;
    for (const s of samples) {
      if (s.t <= nowT + 0.01) best = s;
      else break;
    }
    // hide stale boxes once we are well past the last analysed frame
    return best && nowT - best.t <= interval * 1.2 ? best : null;
  }, [samples, nowT, interval, kind]);

  const stats = useMemo(() => {
    const withPeople = samples.filter((s) => s.summary?.people > 0);
    const flagged = samples.filter((s) => s.violations?.length);
    const noHat = samples.filter((s) => s.violations?.some((v) => v.label.includes("Hard Hat"))).length;
    const noVest = samples.filter((s) => s.violations?.some((v) => v.label.includes("Vest"))).length;
    const clean = withPeople.filter((s) => !s.violations?.length).length;
    return {
      frames: samples.length,
      flagged: flagged.length,
      noHat,
      noVest,
      people: Math.max(0, ...samples.map((s) => s.summary?.people || 0)),
      compliance: withPeople.length ? Math.round((clean / withPeople.length) * 100) : null
    };
  }, [samples]);

  function seek(t) {
    const v = playerRef.current;
    if (v) {
      v.currentTime = t;
      setNowT(t);
    }
  }

  const analyzing = status === "analyzing";
  const dets = current?.raw_detections || [];
  const viols = current?.violations || [];
  const faces = current?.faces || [];

  const overlay = (
    <>
      {dets.map((d, i) => (
        <div
          key={i}
          className="absolute border-2 rounded-sm pointer-events-none"
          style={{
            borderColor: LABEL_COLORS[d.label] || "#3ee6c4",
            left: `${d.box.x}%`,
            top: `${d.box.y}%`,
            width: `${d.box.w}%`,
            height: `${d.box.h}%`
          }}
        >
          <span
            className="absolute left-0 top-0 whitespace-nowrap rounded-br px-1 py-0.5 text-[10px] font-medium text-black"
            style={{ background: LABEL_COLORS[d.label] || "#3ee6c4" }}
          >
            {d.label.replace("_", " ")} {Math.round(d.confidence * 100)}%
          </span>
        </div>
      ))}
      {viols.map((v, i) => {
        const style = SEVERITY_STYLES[v.severity] || SEVERITY_STYLES.medium;
        return (
          <div
            key={`v${i}`}
            className={`absolute border-2 border-dashed ${style.border} rounded-sm pointer-events-none`}
            style={{ left: `${v.box.x}%`, top: `${v.box.y}%`, width: `${v.box.w}%`, height: `${v.box.h}%` }}
          >
            <span
              className={`absolute bottom-0 left-0 whitespace-nowrap rounded-tr px-1 py-0.5 text-[10px] font-medium text-black ${style.bg}`}
              style={{ transform: `translateY(${i * -100}%)` }}
            >
              {v.label}
            </span>
          </div>
        );
      })}
      {blurFaces &&
        faces.map((f, i) => (
          <div
            key={`f${i}`}
            className="face-blur absolute pointer-events-none"
            style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }}
          />
        ))}
    </>
  );

  return (
    <div className="rounded-xl border border-base-700/60 bg-base-900 p-5">
      <p className="text-sm font-medium text-slate-200">Analyze a video</p>
      <p className="text-[11px] text-slate-500 mt-0.5 mb-4">
        Upload a site video (or a single photo). The browser samples frames and the PPE model checks each one
        for people, hard hats and safety vests — your video itself is never uploaded.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        className="hidden"
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {!file ? (
        <button
          onClick={() => inputRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-base-700 py-12 text-slate-500 hover:border-cyan-accent/50 hover:text-cyan-accent transition-colors"
        >
          <UploadCloud size={24} />
          <span className="text-xs">Click to choose a video</span>
          <span className="text-[10px] text-slate-600">MP4 / WebM · photos also work</span>
        </button>
      ) : (
        <div className="space-y-3">
          <FitFrame ratio={ratio} className="rounded-lg border border-base-700/60">
            {kind === "video" ? (
              <video
                ref={playerRef}
                src={mediaUrl}
                controls
                playsInline
                className="block h-full w-full"
                onLoadedMetadata={(e) => {
                  setRatio(e.target.videoWidth / e.target.videoHeight);
                  setDuration(e.target.duration);
                }}
                onError={() => setError("This video format can't be played by your browser. Try MP4 (H.264) or WebM.")}
              />
            ) : (
              <img
                src={mediaUrl}
                alt="Upload preview"
                className="block h-full w-full"
                onLoad={(e) => setRatio(e.target.naturalWidth / e.target.naturalHeight)}
              />
            )}
            {overlay}
          </FitFrame>

          {/* timeline: green = clear, red = violation; click to jump */}
          {kind === "video" && samples.length > 0 && duration > 0 && (
            <div>
              <div className="relative h-3 rounded bg-base-800 overflow-hidden">
                {samples.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => seek(s.t)}
                    title={`${fmt(s.t)} — ${s.violations?.length ? s.violations.map((v) => v.label).join(", ") : "clear"}`}
                    className={`absolute top-0 h-full ${s.violations?.length ? "bg-alert-critical" : s.summary?.people ? "bg-safe/70" : "bg-base-600"}`}
                    style={{ left: `${(s.t / duration) * 100}%`, width: `${Math.max(0.6, (interval / duration) * 100)}%` }}
                  />
                ))}
                <div className="absolute top-0 h-full w-0.5 bg-white/90" style={{ left: `${(nowT / duration) * 100}%` }} />
              </div>
              <div className="flex justify-between text-[10px] font-mono text-slate-600 mt-1">
                <span>0:00</span>
                <span>red = violation · green = compliant · gray = nobody in frame</span>
                <span>{fmt(duration)}</span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {analyzing ? (
              <button
                onClick={() => (abortRef.current = true)}
                className="flex items-center gap-1.5 rounded-lg border border-alert-critical/40 text-alert-critical px-3 py-2 text-xs hover:bg-alert-critical/10"
              >
                <X size={13} /> Stop
              </button>
            ) : (
              <button
                onClick={analyze}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-accent text-base-950 font-medium px-3 py-2 text-xs hover:bg-cyan-accent/90 transition-colors"
              >
                <Film size={13} /> {status === "done" ? "Analyze again" : "Run detection"}
              </button>
            )}
            <button
              onClick={() => inputRef.current?.click()}
              disabled={analyzing}
              className="rounded-lg border border-base-700/60 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-50"
            >
              Choose another
            </button>
            <button onClick={reset} disabled={analyzing} className="text-xs text-slate-500 hover:text-slate-300 disabled:opacity-50">
              Clear
            </button>
            {cameras.length > 0 && (
              <label className="ml-auto flex items-center gap-1.5 text-[11px] text-slate-500">
                Show result on camera
                <select
                  value={cameraId}
                  onChange={(e) => setCameraId(e.target.value)}
                  disabled={analyzing}
                  className="rounded-md border border-base-700/60 bg-base-850 px-2 py-1.5 text-xs text-slate-300 outline-none"
                >
                  <option value="">Don't log</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {analyzing && (
            <div>
              <div className="h-1.5 rounded-full bg-base-800 overflow-hidden">
                <div
                  className="h-full bg-cyan-accent transition-all"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
                />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1.5">
                <Loader2 size={11} className="animate-spin" />
                Analyzing frame {Math.min(progress.done + 1, progress.total)} of {progress.total}…
                (the first request can take ~50 s if the server was asleep)
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-alert-high/30 bg-alert-high/10 px-3 py-2.5 text-xs text-alert-high">
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              <p className="font-medium">{error}</p>
            </div>
          )}

          {samples.length > 0 && !analyzing && (
            <div
              className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs ${
                stats.flagged
                  ? "border-alert-critical/30 bg-alert-critical/10 text-alert-critical"
                  : "border-safe/30 bg-safe/10 text-safe"
              }`}
            >
              {stats.flagged ? <AlertTriangle size={14} className="shrink-0 mt-0.5" /> : <ShieldCheck size={14} className="shrink-0 mt-0.5" />}
              <div>
                <p className="font-medium">
                  {stats.flagged
                    ? `${stats.flagged} of ${stats.frames} analysed frame${stats.frames > 1 ? "s" : ""} had violations`
                    : stats.people
                    ? "No violations found — everyone detected was compliant"
                    : "No people detected"}
                </p>
                <p className="text-slate-400 mt-0.5">
                  up to {stats.people} {stats.people === 1 ? "person" : "people"} in frame
                  {stats.noHat > 0 && ` · no hard hat in ${stats.noHat} frame${stats.noHat > 1 ? "s" : ""}`}
                  {stats.noVest > 0 && ` · no vest in ${stats.noVest} frame${stats.noVest > 1 ? "s" : ""}`}
                  {stats.compliance != null && ` · ${stats.compliance}% of frames with people fully compliant`}
                </p>
                {loggedTo && (
                  <p className="text-slate-400 mt-0.5">
                    Now shown on <b>{loggedTo}</b> (Dashboard + Live cameras). Use "restore" on the tile to go back.
                  </p>
                )}
                {notified?.sent && <p className="text-slate-400 mt-0.5">LINE notification sent.</p>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
