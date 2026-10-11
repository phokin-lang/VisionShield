import { useState } from "react";
import { LogIn, UserPlus } from "lucide-react";
import { authApi } from "../api.js";

export default function LoginPage({ onSuccess }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  function update(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fn = mode === "login" ? authApi.login : authApi.register;
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : form;
      const res = await fn(payload);
      localStorage.setItem("token", res.token);
      onSuccess(res.token, res.user);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-base-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-6">
          <img src="/logo-full.png" alt="VisionShield — Smart CCTV for safer tomorrow" className="h-40 w-auto select-none" draggable={false} />
        </div>

        <div className="rounded-xl border border-base-700/60 bg-base-900/80 p-6">
          <h1 className="text-sm font-medium text-slate-200 mb-1">
            {mode === "login" ? "Sign in to your account" : "Create an account"}
          </h1>
          <p className="text-xs text-slate-500 mb-5">
            {mode === "login"
              ? "Enter your credentials to access the dashboard."
              : "Set up access to the monitoring platform."}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            {mode === "register" && (
              <div>
                <label className="text-[11px] text-slate-500">Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="mt-1 w-full rounded-lg border border-base-700/60 bg-base-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-accent"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] text-slate-500">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className="mt-1 w-full rounded-lg border border-base-700/60 bg-base-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-accent"
              />
            </div>

            <div>
              <label className="text-[11px] text-slate-500">Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => update("password", e.target.value)}
                className="mt-1 w-full rounded-lg border border-base-700/60 bg-base-850 px-3 py-2 text-sm text-slate-200 outline-none focus:border-cyan-accent"
              />
            </div>

            {error && (
              <p className="text-[11px] text-alert-critical">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 rounded-lg bg-cyan-accent text-base-950 font-medium px-3 py-2 text-sm hover:bg-cyan-accent/90 transition-colors disabled:opacity-60"
            >
              {mode === "login" ? <LogIn size={14} /> : <UserPlus size={14} />}
              {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => {
              setError(null);
              setMode(mode === "login" ? "register" : "login");
            }}
            className="mt-4 w-full text-center text-[11px] text-slate-500 hover:text-cyan-accent transition-colors"
          >
            {mode === "login"
              ? "Don't have an account? Register"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    </div>
  );
}
