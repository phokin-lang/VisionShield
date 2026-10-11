// LINE push notifications through the LINE Messaging API.
//   LINE_CHANNEL_ACCESS_TOKEN  long-lived channel access token of your LINE Official Account
//   LINE_TO                    one or more userId / groupId / roomId, comma-separated
//                              e.g. Uaaa...,Ubbb...,Cccc...

const COOLDOWN_MS = Number(process.env.LINE_COOLDOWN_SEC || 60) * 1000;
let lastSent = 0;

function targets() {
  return (process.env.LINE_TO || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && targets().length);
}

async function pushOne(to, text) {
  const res = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify({ to, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[line] push failed", to.slice(0, 6) + "…", res.status, body.slice(0, 200));
    return { ok: false, status: res.status };
  }
  return { ok: true };
}

export async function pushLine(text, { force = false } = {}) {
  if (!lineConfigured()) return { sent: false, reason: "not_configured" };
  const now = Date.now();
  if (!force && now - lastSent < COOLDOWN_MS) return { sent: false, reason: "cooldown" };

  const results = await Promise.all(
    targets().map((to) => pushOne(to, text).catch((e) => {
      console.error("[line] push error", e.message);
      return { ok: false, status: 0 };
    }))
  );
  const okCount = results.filter((r) => r.ok).length;
  if (okCount === 0) return { sent: false, reason: "line_error", status: results[0]?.status };

  lastSent = now;
  return { sent: true, delivered: okCount, total: results.length };
}