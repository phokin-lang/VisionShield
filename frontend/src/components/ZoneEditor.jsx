import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Trash2, Undo2, X } from "lucide-react";
import { api } from "../api.js";
import DetectionImage from "./DetectionImage.jsx";
import useCameraSrc from "./useCameraSrc.js";
import { ZoneShapes } from "./ZoneLayer.jsx";

const MAX_ZONES = 10;
const MAX_POINTS = 30;
const CLOSE_PX = 12; // clicking this close to the first point closes the polygon

// Click on the frame to add points; click the first point (or "Finish zone") to close the polygon.
// Points are stored as % of the image, so zones stay put whatever size the tile is shown at.
export default function ZoneEditor({ cameras, cameraId, onCameraChange, onSaved, onClose }) {
  const camera = cameras.find((c) => c.id === cameraId) || cameras[0];
  const src = useCameraSrc(camera);
  const [zones, setZones] = useState(camera.zones || []);
  const [draft, setDraft] = useState([]);
  const [hover, setHover] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState(false);
  const surface = useRef(null);

  // switching camera starts from that camera's saved zones
  useEffect(() => {
    setZones(camera.zones || []);
    setDraft([]);
    setDirty(false);
    setError(null);
  }, [camera.id]); // eslint-disable-line react-hooks/exhaustive-deps

  function finishDraft(points = draft) {
    if (points.length < 3) return;
    setZones((z) => [...z, { name: `Zone ${z.length + 1}`, points }]);
    setDraft([]);
    setDirty(true);
  }

  function addPoint(e) {
    if (zones.length >= MAX_ZONES) return;
    const r = surface.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    if (draft.length >= 3) {
      const [fx, fy] = draft[0];
      if (Math.hypot(px - (fx / 100) * r.width, py - (fy / 100) * r.height) <= CLOSE_PX) return finishDraft();
    }
    const pct = (v, size) => Math.round(Math.max(0, Math.min(100, (v / size) * 100)) * 10) / 10;
    const next = [...draft, [pct(px, r.width), pct(py, r.height)]];
    if (next.length >= MAX_POINTS) return finishDraft(next);
    setDraft(next);
  }

  function onKey(e) {
    if (e.key === "Enter") finishDraft();
    if (e.key === "Escape") setDraft([]);
    if (e.key === "Backspace") setDraft((d) => d.slice(0, -1));
  }

  function removeZone(i) {
    setZones((z) => z.filter((_, k) => k !== i));
    setDirty(true);
  }

  function renameZone(i, name) {
    setZones((z) => z.map((zone, k) => (k === i ? { ...zone, name } : zone)));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.saveZones(camera.id, zones);
      setZones(saved.zones || []);
      setDirty(false);
      await onSaved?.();
    } catch (err) {
      setError(err.message || "Could not save zones.");
    } finally {
      setSaving(false);
    }
  }

  const btn =
    "flex items-center gap-1.5 rounded-lg border border-base-700/60 px-2.5 py-1.5 text-xs text-slate-300 hover:text-cyan-accent disabled:opacity-40 disabled:hover:text-slate-300";

  return (
    <section className="rounded-xl border border-alert-critical/30 bg-base-900 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="mr-auto">
          <p className="text-sm font-medium text-slate-200">Edit danger zones</p>
          <p className="text-[11px] text-slate-500">
            Click the frame to add points, click the first point (or press Enter) to close the zone. Anyone whose feet
            are inside a zone triggers "Person in Danger Zone".
          </p>
        </div>
        <select
          value={camera.id}
          onChange={(e) => onCameraChange(e.target.value)}
          aria-label="Camera"
          className="rounded-lg border border-base-700/60 bg-base-850 px-2.5 py-1.5 text-xs text-slate-200"
        >
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({(c.zones || []).length})
            </option>
          ))}
        </select>
        <button onClick={onClose} className={btn} aria-label="Close zone editor">
          <X size={13} /> Close
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_16rem]">
        <div
          tabIndex={0}
          onKeyDown={onKey}
          className="rounded-lg overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-cyan-accent/50"
        >
          <DetectionImage src={src} alt={camera.name} width={camera.imageWidth} height={camera.imageHeight}>
            <ZoneShapes zones={zones} draft={draft} highlight={hover} />
            <div
              ref={surface}
              onClick={addPoint}
              className={`absolute inset-0 ${zones.length >= MAX_ZONES ? "cursor-not-allowed" : "cursor-crosshair"}`}
            />
          </DetectionImage>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => finishDraft()} disabled={draft.length < 3} className={btn}>
              <Check size={13} /> Finish zone
            </button>
            <button onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length} className={btn}>
              <Undo2 size={13} /> Undo point
            </button>
          </div>
          {draft.length > 0 && (
            <p className="text-[11px] text-slate-500">
              Drawing: {draft.length} point{draft.length > 1 ? "s" : ""}
              {draft.length < 3 ? ` — ${3 - draft.length} more needed` : ""}
            </p>
          )}

          <div className="flex-1 space-y-1.5">
            {zones.length === 0 && <p className="text-xs text-slate-500">No zones on this camera yet.</p>}
            {zones.map((z, i) => (
              <div
                key={z.id || i}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                className="flex items-center gap-2 rounded-lg bg-base-850 px-2.5 py-1.5"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-alert-critical/70" />
                <input
                  value={z.name}
                  maxLength={40}
                  onChange={(e) => renameZone(i, e.target.value)}
                  aria-label={`Name of zone ${i + 1}`}
                  className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none"
                />
                <span className="text-[10px] text-slate-500">{z.points.length} pts</span>
                <button
                  onClick={() => removeZone(i)}
                  aria-label={`Delete ${z.name}`}
                  className="text-slate-500 hover:text-alert-critical"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {zones.length >= MAX_ZONES && <p className="text-[11px] text-alert-high">Maximum {MAX_ZONES} zones per camera.</p>}
          </div>

          {error && <p className="text-xs text-alert-critical">{error}</p>}
          <div className="flex gap-1.5">
            <button
              onClick={save}
              disabled={!dirty || saving || draft.length > 0}
              title={draft.length ? "Finish or undo the zone you are drawing first" : undefined}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-accent px-3 py-2 text-xs font-medium text-base-950 hover:bg-cyan-accent/90 disabled:opacity-50"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? "Saving..." : "Save zones"}
            </button>
            <button
              onClick={() => {
                setZones(camera.zones || []);
                setDraft([]);
                setDirty(false);
              }}
              disabled={(!dirty && !draft.length) || saving}
              className={btn}
            >
              Discard
            </button>
          </div>
          <p className="text-[10px] text-slate-600">Saving re-analyses this camera with the new zones.</p>
        </div>
      </div>
    </section>
  );
}
