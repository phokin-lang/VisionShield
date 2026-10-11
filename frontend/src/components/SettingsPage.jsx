import { useEffect, useState } from "react";
import { Check, Loader2, Sun, Moon, Send } from "lucide-react";
import { api } from "../api.js";
import { applyTheme, getStoredTheme } from "../theme.js";

const TOGGLES = [
  { id: "hardhat", label: "Hard hat detection", desc: "Flag workers without head protection." },
  { id: "vest", label: "Safety vest detection", desc: "Flag workers without high-visibility vests." },
  { id: "line", label: "LINE notifications", desc: "Send a LINE message when a critical violation is found in an analysed video or photo." },
  { id: "blur", label: "Blur worker faces", desc: "Blur the head area of detected people in camera feeds and video analysis, for privacy." }
];

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
    </div>
  );
}
