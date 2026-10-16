import { useEffect, useState } from "react";
import { Check, Loader2, Sun, Moon, Send } from "lucide-react";
import { api } from "../api.js";
import { applyTheme, getStoredTheme } from "../theme.js";

const TOGGLES = [
  { id: "hardhat", label: "Hard hat detection", desc: "Flag workers without head protection." },
  { id: "vest", label: "Safety vest detection", desc: "Flag workers without high-visibility vests." },
  { id: "line", label: "LINE notifications", desc: "Send a LINE message when an analysed video or photo shows a missing hard hat or any hazard rule below (same cooldown)." },
  { id: "blur", label: "Blur worker faces", desc: "Blur the head area of detected people in camera feeds and video analysis, for privacy." }
];

// Hazard rules: same people/vehicle detector, no extra model. `fields` = adjustable thresholds.
const HAZARDS = [
  {
    id: "danger_zone",
    label: "Danger zones",
    desc: "Critical alert when someone's feet are inside a zone drawn on Live cameras → Edit zones."
  },
  {
    id: "vehicle_proximity",
    label: "Person near vehicle",
    desc: "Alert when a person is close to a car, truck, bus, motorcycle or bicycle (riders are ignored).",
    fields: [{ id: "proximity_ratio", label: "Closer than", unit: "× the person's height", min: 0.1, max: 3, step: 0.1 }]
  },
  {
    id: "fall",
    label: "Possible fall",
    desc: "Alert when a person's box is much wider than tall, like someone lying on the ground.",
    fields: [
      { id: "fall_ratio", label: "Width / height above", unit: "", min: 1, max: 4, step: 0.1 },
      { id: "fall_min_height", label: "Box at least", unit: "% of the frame tall", min: 1, max: 50, step: 1 }
    ]
  },
  {
    id: "crowding",
    label: "Overcrowding",
    desc: "Alert when too many people stand inside one danger zone.",
    fields: [{ id: "crowd_max", label: "More than", unit: "people in a zone", min: 1, max: 100, step: 1 }]
  },
  { id: "phone_use", label: "Phone use in work area", desc: "Alert when a mobile phone is detected in a person's hands." }
];

// Number input that saves on blur / Enter (not on every keystroke, which would re-scan each time).
function NumberField({ field, value, disabled, onCommit }) {
  const [text, setText] = useState(String(value ?? ""));
  useEffect(() => setText(String(value ?? "")), [value]);
  const commit = async () => {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n) || n === value) return setText(String(value ?? ""));
    if (!(await onCommit(n))) setText(String(value ?? "")); // rejected by the server: show the stored value
  };
  return (
    <label className="flex items-center gap-2 text-xs text-slate-400">
      {field.label}
      <input
        type="number"
        inputMode="decimal"
        min={field.min}
        max={field.max}
        step={field.step}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        className="w-20 rounded-md border border-base-700/60 bg-base-850 px-2 py-1 text-slate-200 disabled:opacity-50"
      />
      {field.unit && <span className="text-slate-500">{field.unit}</span>}
    </label>
  );
}

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      disabled={disabled}
      className={`relative h-6 w-11 rounded-full transition-colors shrink-0 disabled:opacity-50 ${
        checked ? "bg-cyan-accent" : "bg-base-600"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-[#fff] shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

export default function SettingsPage({ onChange }) {
  const [state, setState] = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [error, setError] = useState(null);
  const [theme, setTheme] = useState(getStoredTheme());
  const [lineTest, setLineTest] = useState(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(setState)
      .catch((e) => {
        setState({ hardhat: true, vest: true, line: false, blur: false });
        setError(e.message || "Could not load settings from the server.");
      });
  }, []);

  function chooseTheme(next) {
    setTheme(next);
    applyTheme(next);
  }

  async function toggle(id) {
    const next = { ...state, [id]: !state[id] };
    setState(next); // optimistic
    onChange?.(next);
    setSavingId(id);
    setError(null);
    try {
      const saved = await api.updateSettings({ [id]: next[id] });
      setState(saved);
      onChange?.(saved);
      setSavedAt(new Date());
    } catch (err) {
      const reverted = { ...next, [id]: !next[id] };
      setState(reverted);
      onChange?.(reverted);
      setError(err.message || "Could not save setting.");
    } finally {
      setSavingId(null);
    }
  }

  async function saveNumber(id, value) {
    setSavingId(id);
    setError(null);
    try {
      const saved = await api.updateSettings({ [id]: value });
      setState(saved);
      onChange?.(saved);
      setSavedAt(new Date());
      return true;
    } catch (err) {
      setError(err.message || "Could not save setting.");
      return false;
    } finally {
      setSavingId(null);
    }
  }

  async function sendTest() {
    setTesting(true);
    setLineTest(null);
    try {
      const r = await api.testLine();
      setLineTest(r.sent ? "ok" : r.reason === "not_configured" ? "not_configured" : "fail");
    } catch {
      setLineTest("fail");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-semibold text-white">System settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure which detections are active on your site.</p>
        </div>
        {savedAt && !savingId && (
          <span className="flex items-center gap-1 text-[11px] text-safe">
            <Check size={12} /> Saved
          </span>
        )}
      </div>

      {error && <p className="text-xs text-alert-critical mb-3">{error}</p>}

      <div className="rounded-xl border border-base-700/60 bg-base-900 max-w-2xl mb-4 flex items-center justify-between gap-4 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-slate-200">Appearance</p>
          <p className="text-xs text-slate-500 mt-0.5">Choose how VisionShield looks on this device.</p>
        </div>
        <div className="flex rounded-lg border border-base-700/60 p-0.5 bg-base-850">
          {[
            { id: "light", label: "Light", icon: Sun },
            { id: "dark", label: "Dark", icon: Moon }
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => chooseTheme(id)}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                theme === id ? "bg-cyan-accent text-base-950 font-medium" : "text-slate-500 hover:text-slate-300"
              }`}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-base-700/60 bg-base-900 divide-y divide-base-700/50 max-w-2xl">
        {TOGGLES.map((t) => (
          <div key={t.id} className="px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-200">{t.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
              </div>
              {!state ? (
                <div className="h-6 w-11 rounded-full bg-base-800 animate-pulse" />
              ) : (
                <div className="flex items-center gap-2">
                  {savingId === t.id && <Loader2 size={12} className="animate-spin text-slate-500" />}
                  <Toggle label={t.label} checked={!!state[t.id]} onChange={() => toggle(t.id)} disabled={savingId === t.id} />
                </div>
              )}
            </div>

            {t.id === "line" && state?.line && (
              <div className="mt-3 rounded-lg bg-base-850 px-3 py-2.5 text-xs">
                {state.lineConfigured ? (
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400">LINE is connected on the server.</span>
                    <button
                      onClick={sendTest}
                      disabled={testing}
                      className="ml-auto flex items-center gap-1.5 rounded-md border border-base-700/60 px-2.5 py-1.5 text-slate-300 hover:text-cyan-accent disabled:opacity-60"
                    >
                      {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Send test message
                    </button>
                  </div>
                ) : (
                  <p className="text-alert-high">
                    LINE is not set up on the server yet — add <code>LINE_CHANNEL_ACCESS_TOKEN</code> and{" "}
                    <code>LINE_TO</code> in the Render environment variables, then redeploy.
                  </p>
                )}
                {lineTest === "ok" && <p className="text-safe mt-1.5">Test message sent — check LINE.</p>}
                {lineTest === "fail" && <p className="text-alert-critical mt-1.5">LINE rejected the message. Check the token and the user/group ID.</p>}
              </div>
            )}
          </div>
        ))}
      </div>

      <h2 className="mt-6 mb-2 text-sm font-medium text-slate-300">Hazard rules</h2>
      <div className="rounded-xl border border-base-700/60 bg-base-900 divide-y divide-base-700/50 max-w-2xl">
        {HAZARDS.map((t) => (
          <div key={t.id} className="px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium text-slate-200">{t.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{t.desc}</p>
              </div>
              {!state ? (
                <div className="h-6 w-11 rounded-full bg-base-800 animate-pulse" />
              ) : (
                <div className="flex items-center gap-2">
                  {savingId === t.id && <Loader2 size={12} className="animate-spin text-slate-500" />}
                  <Toggle label={t.label} checked={state[t.id] !== false} onChange={() => toggle(t.id)} disabled={savingId === t.id} />
                </div>
              )}
            </div>
            {state && t.fields && state[t.id] !== false && (
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                {t.fields.map((f) => (
                  <div key={f.id} className="flex items-center gap-1.5">
                    <NumberField field={f} value={state[f.id]} disabled={savingId === f.id} onCommit={(n) => saveNumber(f.id, n)} />
                    {savingId === f.id && <Loader2 size={12} className="animate-spin text-slate-500" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
