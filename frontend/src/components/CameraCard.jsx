import { useState } from "react";
import { RotateCcw, Paperclip } from "lucide-react";
import { api } from "../api.js";
import DetectionImage from "./DetectionImage.jsx";
import useCameraSrc from "./useCameraSrc.js";
import { ZoneShapes, VehicleBoxes, HeadBoxes } from "./ZoneLayer.jsx";

const SEVERITY_STYLES = {
  critical: { border: "border-alert-critical", text: "text-alert-critical", bg: "bg-alert-critical" },
  high: { border: "border-alert-high", text: "text-alert-high", bg: "bg-alert-high" },
  medium: { border: "border-alert-high", text: "text-alert-high", bg: "bg-alert-high" },
  low: { border: "border-alert-low", text: "text-alert-low", bg: "bg-alert-low" }
};

export default function CameraCard({ camera, blurFaces = false, onRestore }) {
  // A user-uploaded image / video frame can replace the default feed ("Log violations to...")
  const src = useCameraSrc(camera);
  const [restoring, setRestoring] = useState(false);

  async function restore() {
    setRestoring(true);
    try {
      await api.restoreCamera(camera.id);
      await onRestore?.();
    } finally {
      setRestoring(false);
    }
  }

  const hasAlerts = camera.detections.length > 0;
  const isClear = camera.status === "clear";

  return (
    <div className="group relative rounded-xl overflow-hidden border border-base-700/60 bg-base-900">
      <DetectionImage
        src={src}
        alt={camera.name}
        width={camera.imageWidth}
        height={camera.imageHeight}
        imgClassName="opacity-90"
        frame={
          <>
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />

            {/* Live / status pill */}
            <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 rounded-md bg-black/50 px-2 py-1 text-[10px] font-mono backdrop-blur-sm">
              <span
                className={`h-1.5 w-1.5 rounded-full ${isClear ? "bg-safe" : "bg-alert-critical pulse-dot"}`}
              />
              <span className={isClear ? "text-safe" : "text-alert-critical"}>
                {isClear ? "Clear" : "Live"}
              </span>
            </div>

            {camera.timestamp && (
              <div className="absolute top-2.5 right-2.5 rounded-md bg-black/50 px-2 py-1 text-[10px] font-mono text-[#cbd5e1] backdrop-blur-sm">
                {camera.timestamp}
              </div>
            )}
          </>
        }
      >
        {/* privacy: blur detected heads when the setting is on */}
        {blurFaces &&
          (camera.faces || []).map((f, i) => (
            <div
              key={`f${i}`}
              className="face-blur absolute"
              style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.w}%`, height: `${f.h}%` }}
            />
          ))}

        {/* danger zones (translucent red), vehicles (orange) and bare heads (red) under the violation boxes */}
        <ZoneShapes zones={camera.zones} />
        <VehicleBoxes objects={camera.objects} />
        <HeadBoxes objects={camera.objects} />

        {/* Detection bounding boxes (drawn in the image's own coordinate space) */}
        {camera.detections.map((d, idx) => {
          const style = SEVERITY_STYLES[d.severity] || SEVERITY_STYLES.medium;
          const labelInside = (d.box?.y ?? 15) < 12;
          // two violations on the same person share one box -> stack their labels
          const sameBoxBefore = camera.detections
            .slice(0, idx)
            .filter((o) => o.box && d.box && o.box.x === d.box.x && o.box.y === d.box.y && o.box.w === d.box.w).length;
          return (
            <div
              key={d.id}
              className={`absolute border-2 ${style.border} rounded-sm`}
              style={{
                left: `${d.box?.x ?? 10}%`,
                top: `${d.box?.y ?? 15}%`,
                width: `${d.box?.w ?? 25}%`,
                height: `${d.box?.h ?? 50}%`
              }}
            >
              <span
                className={`absolute ${labelInside ? "top-0" : "-top-6"} left-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-medium text-black ${style.bg}`}
                style={{ transform: `translateY(${(labelInside ? 1 : -1) * sameBoxBefore * 105}%)` }}
              >
                {d.label}
              </span>
            </div>
          );
        })}
      </DetectionImage>

      <div className="flex items-center justify-between px-3 py-2.5">
        <div>
          <p className="text-sm font-medium text-slate-200">{camera.name}</p>
          <p className="text-[11px] text-slate-500">{camera.zone}</p>
          {camera.sourceLabel && (
            <p className="mt-1 flex items-center gap-1 text-[10px] text-cyan-accent">
              <Paperclip size={10} />
              <span className="max-w-[160px] truncate">{camera.sourceLabel}</span>
              <button
                onClick={restore}
                disabled={restoring}
                title="Back to the default camera feed"
                className="ml-1 flex items-center gap-0.5 text-slate-500 hover:text-slate-300 disabled:opacity-50"
              >
                <RotateCcw size={10} /> restore
              </button>
            </p>
          )}
        </div>
        {hasAlerts ? (
          <span className="text-[10px] font-medium text-alert-critical bg-alert-critical/15 rounded-full px-2 py-1">
            {camera.detections.length} alert{camera.detections.length > 1 ? "s" : ""}
          </span>
        ) : (
          <span className="text-[10px] font-medium text-safe bg-safe/15 rounded-full px-2 py-1">
            Clear
          </span>
        )}
      </div>
    </div>
  );
}
