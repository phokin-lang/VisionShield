// Builds the Thai LINE message for a PPE alert.

const LABEL_TH = {
  "No Hard Hat Detected": "ไม่สวมหมวกนิรภัย",
  "No Safety Vest Detected": "ไม่สวมเสื้อสะท้อนแสง"
};

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
  const { camera, file, kind, firstSeen, violations, flaggedFrames, totalFrames, title, detail } = body;
  const lines = ["🚨 VisionShield แจ้งเตือน", "พบการฝ่าฝืนอุปกรณ์ความปลอดภัย", ""];

  const place = camera?.name
    ? `${clip(camera.name, 80)}${camera.zone ? ` (${clip(camera.zone, 80)})` : ""}`
    : "ไม่ระบุกล้อง (วิเคราะห์จากไฟล์ที่อัปโหลด)";
  lines.push(`📍 สถานที่: ${place}`);
  lines.push(`🕒 เวลา: ${thaiTime()}`);

  if (file) {
    const type = kind === "video" ? "วิดีโอ" : "รูปภาพ";
    const seen = kind === "video" && firstSeen ? ` (พบครั้งแรกที่ ${clip(firstSeen, 20)})` : "";
    lines.push(`🎥 ที่มา: ${type} ${clip(file, 100)}${seen}`);
  }

  const list = Array.isArray(violations) ? violations.slice(0, 10) : [];
  if (list.length) {
    lines.push("", "ตรวจพบ:");
    for (const v of list) {
      const label = LABEL_TH[v.label] || clip(v.label, 80);
      const n = Number(v.count);
      lines.push(`• ${label}${n > 0 ? ` ${n} คน` : ""}`);
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
