import { useState } from "react";
import {
  LayoutDashboard,
  Video,
  History,
  Settings,
  ChevronDown,
  HelpCircle,
  X
} from "lucide-react";

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "cameras", label: "Live Cameras", icon: Video },
  { id: "alerts", label: "Alert History", icon: History },
  { id: "settings", label: "System Settings", icon: Settings }
];

export default function Sidebar({ active, onNavigate, forceVisible = false, badges = {}, lastSync = null }) {
  const [helpOpen, setHelpOpen] = useState(false);

  return (
    <aside
      className={`${
        forceVisible ? "flex" : "hidden lg:flex"
      } w-64 shrink-0 flex-col border-r border-base-700/60 bg-base-900`}
    >
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-base-700/60">
        <img src="/logo-icon.png" alt="" className="h-9 w-9 shrink-0 select-none object-contain" draggable={false} />
        <div>
          <p className="font-display font-semibold text-sm text-white leading-none">VisionShield</p>
          <p className="text-[11px] text-slate-500 mt-1">Safety Intelligence</p>
        </div>
      </div>

      <div className="px-5 py-4">
        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-2">Workspace</p>
        <button className="w-full flex items-center justify-between rounded-lg border border-base-700/60 bg-base-850 px-3 py-2 text-sm text-slate-200 hover:border-base-600 transition-colors">
          <span className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded bg-cyan-accent/20 text-[10px] font-semibold text-cyan-accent">
              AC
            </span>
            Atlas Construction
          </span>
          <ChevronDown size={14} className="text-slate-500" />
        </button>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => {
          const isActive = active === id;
          const badge = badges[id];
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors ${
                isActive
                  ? "bg-cyan-accent/10 text-cyan-accent border border-cyan-accent/25"
                  : "text-slate-400 hover:bg-base-800 hover:text-slate-200 border border-transparent"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon size={16} strokeWidth={2} />
                {label}
              </span>
              {badge != null && badge !== "" && (
                <span
                  className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                    isActive ? "bg-cyan-accent/20 text-cyan-accent" : "bg-base-800 text-slate-500"
                  }`}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="relative px-5 py-4 border-t border-base-700/60 space-y-3">
        <button
          onClick={() => setHelpOpen((v) => !v)}
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          <HelpCircle size={14} /> Help center
        </button>
        <div className="flex items-center gap-2 text-xs text-safe">
          <span className="h-1.5 w-1.5 rounded-full bg-safe" />
          All systems operational
          <span className="text-slate-600 ml-auto">{lastSync ? `Last sync ${lastSync}` : "Syncing..."}</span>
        </div>

        {helpOpen && (
          <div className="absolute bottom-full left-5 right-5 mb-2 rounded-lg border border-base-700/60 bg-base-850 p-3.5 shadow-xl z-30">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-slate-200">Quick help</p>
              <button onClick={() => setHelpOpen(false)} className="text-slate-500 hover:text-slate-300">
                <X size={13} />
              </button>
            </div>
            <ul className="text-[11px] text-slate-500 space-y-1.5 list-disc list-inside">
              <li>Dashboard cards are clickable — they jump to Cameras, Alerts, or Settings.</li>
              <li>Acknowledge a violation with the check button in the alerts list.</li>
              <li>Use "Analyze a photo" on the Live Cameras page to run detection on any image.</li>
              <li>Toggle which detections are active under System Settings.</li>
            </ul>
          </div>
        )}
      </div>
    </aside>
  );
}
