// Builds the Thai LINE message for a PPE / hazard alert.

const LABEL_TH = {
  "No Hard Hat Detected": "ไม่สวมหมวกนิรภัย",
  "No Safety Vest Detected": "ไม่สวมเสื้อสะท้อนแสง",
  "Person in Danger Zone": "มีคนเข้าเขตอันตราย",
  "Person Near Vehicle": "คนอยู่ใกล้ยานพาหนะ",
  "Possible Fall": "อาจมีคนล้ม",
  "Overcrowding": "คนแออัดในโซน",
  "Phone Use in Work Area": "ใช้โทรศัพท์ในพื้นที่ทำงาน"
};
const PPE_LABELS = ["No Hard Hat Detected", "No Safety Vest Detected"];
// how the count is read: zones for Overcrowding, people for everything else
const UNIT_TH = { Overcrowding: "โซน" };

const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export function thaiTime(date = new Date()) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function buildLineMessage(body = {}) {
  const { camera, file, kind, firstSeen, uploadedAt, violations, flaggedFrames, totalFrames, title, detail } = body;
  const list = Array.isArray(violations) ? violations.slice(0, 10) : [];
  const ppeOnly = list.length > 0 && list.every((v) => PPE_LABELS.includes(v.label));
  const headline = ppeOnly || !list.length ? "พบการฝ่าฝืนอุปกรณ์ความปลอดภัย" : "พบเหตุการณ์ไม่ปลอดภัยในพื้นที่ทำงาน";
  const lines = ["🚨 VisionShield แจ้งเตือน", headline, ""];

  const place = camera?.name
    ? `${clip(camera.name, 80)}${camera.zone ? ` (${clip(camera.zone, 80)})` : ""}`
    : "ไม่ระบุกล้อง (วิเคราะห์จากไฟล์ที่อัปโหลด)";
  lines.push(`📍 สถานที่: ${place}`);
  // time the file was uploaded (sent by the browser); fall back to "now" if missing or implausible
  let when = new Date(uploadedAt);
  if (!uploadedAt || Number.isNaN(when.getTime()) || Math.abs(Date.now() - when.getTime()) > 24 * 3600 * 1000) when = new Date();
  lines.push(`🕒 เวลาอัปโหลด: ${thaiTime(when)}`);

  if (file) {
    const type = kind === "video" ? "วิดีโอ" : "รูปภาพ";
    const seen = kind === "video" && firstSeen ? ` (พบครั้งแรกที่นาที ${clip(firstSeen, 20)} ของวิดีโอ)` : "";
    lines.push(`🎥 ที่มา: ${type} ${clip(file, 100)}${seen}`);
  }

  if (list.length) {
    lines.push("", "ตรวจพบ:");
    for (const v of list) {
      const label = LABEL_TH[v.label] || clip(v.label, 80);
      const n = Number(v.count);
      lines.push(`• ${label}${n > 0 ? ` ${n} ${UNIT_TH[v.label] || "คน"}` : ""}`);
    }
  } else if (title || detail) {
    // older clients that only send free text
    lines.push("", clip(title, 200), clip(detail, 1500));
  }

  if (Number(totalFrames) > 0 && Number(flaggedFrames) >= 0) {
    lines.push("", `ผิดปกติ ${Number(flaggedFrames)} จาก ${Number(totalFrames)} เฟรมที่ตรวจ`);
  }
  return lines.join("\n").slice(0, 4900);
}
