// Overlays drawn in the image's own % coordinate space (children of DetectionImage).

export const VEHICLE_COLOR = "#f97316";
export const HEAD_COLOR = "#ef4a4a";
const VEHICLES = ["Bicycle", "Car", "Motorcycle", "Bus", "Truck"];

/** Danger zones as translucent red polygons. `draft` = polygon being drawn (open path). */
export function ZoneShapes({ zones = [], draft = null, highlight = null }) {
  if (!zones.length && !draft?.length) return null;
  const pts = (points) => points.map(([x, y]) => `${x},${y}`).join(" ");
  return (
    <>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {zones.map((z, i) => (
          <polygon
            key={z.id || i}
            points={pts(z.points)}
            fill="rgb(239 74 74)"
            fillOpacity={highlight === i ? 0.4 : 0.22}
            stroke="rgb(239 74 74)"
            strokeOpacity="0.9"
            strokeWidth={highlight === i ? 2.5 : 1.5}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {draft?.length > 0 && (
          <polyline
            points={pts(draft)}
            fill={draft.length >= 3 ? "rgb(239 74 74)" : "none"}
            fillOpacity="0.15"
            stroke="rgb(239 74 74)"
            strokeWidth="2"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      {/* points as dots (an SVG circle would stretch with the non-uniform viewBox) */}
      {draft?.map(([x, y], i) => (
        <span
          key={`p${i}`}
          className={`pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-alert-critical ${
            i === 0 ? "h-3.5 w-3.5 bg-[#fff]" : "h-2.5 w-2.5 bg-alert-critical"
          }`}
          style={{ left: `${x}%`, top: `${y}%` }}
        />
      ))}
    </>
  );
}

/** Red boxes for heads without a hard hat (hardhat_v2 model). */
export function HeadBoxes({ objects = [] }) {
  return objects
    .filter((o) => o.label === "Head" && o.box)
    .map((o, i) => (
      <div
        key={`head${i}`}
        title={`Head without hard hat ${Math.round((o.confidence || 0) * 100)}%`}
        className="pointer-events-none absolute rounded-sm border-2"
        style={{ borderColor: HEAD_COLOR, left: `${o.box.x}%`, top: `${o.box.y}%`, width: `${o.box.w}%`, height: `${o.box.h}%` }}
      />
    ));
}

/** Orange boxes for vehicles the model saw in the frame. */
export function VehicleBoxes({ objects = [] }) {
  return objects
    .filter((o) => VEHICLES.includes(o.label) && o.box)
    .map((o, i) => (
      <div
        key={`veh${i}`}
        className="pointer-events-none absolute rounded-sm border-2"
        style={{ borderColor: VEHICLE_COLOR, left: `${o.box.x}%`, top: `${o.box.y}%`, width: `${o.box.w}%`, height: `${o.box.h}%` }}
      >
        <span
          className="absolute bottom-0 right-0 whitespace-nowrap rounded-tl px-1 py-0.5 text-[10px] font-medium text-black"
          style={{ background: VEHICLE_COLOR }}
        >
          {o.label}
        </span>
      </div>
    ));
}
