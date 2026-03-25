// ============================================================
// 設定
// ============================================================
const WORKER_URL = "https://broad-brook-c6dd.mattya3219.workers.dev";
// ============================================================

(async function sendNotify() {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  const ua = navigator.userAgent;

  // ブラウザ判定
  let browser = "不明";
  if (ua.includes("Edg/"))         browser = "Edge "    + (ua.match(/Edg\/([\d.]+)/)?.[1] ?? "");
  else if (ua.includes("Chrome/")) browser = "Chrome "  + (ua.match(/Chrome\/([\d.]+)/)?.[1] ?? "");
  else if (ua.includes("Firefox/"))browser = "Firefox " + (ua.match(/Firefox\/([\d.]+)/)?.[1] ?? "");
  else if (ua.includes("Safari/")) browser = "Safari "  + (ua.match(/Version\/([\d.]+)/)?.[1] ?? "");

  // OS判定
  let os = "不明";
  if (ua.includes("Windows NT 10.0"))    os = "Windows 10/11";
  else if (ua.includes("Windows"))       os = "Windows";
  else if (ua.includes("Mac OS X"))      os = "macOS " + (ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? "");
  else if (ua.includes("Android"))       os = "Android " + (ua.match(/Android ([\d.]+)/)?.[1] ?? "");
  else if (ua.includes("iPhone OS"))     os = "iOS " + (ua.match(/iPhone OS ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? "");
  else if (ua.includes("Linux"))         os = "Linux";

  // デバイス種別
  const device = /Mobi|Android|iPhone|iPad/.test(ua) ? "📱 モバイル" : "🖥️ デスクトップ";

  const content = `👀 誰か来たよ！ ${now}\n${device}\n🌐 ブラウザ: ${browser}\n💻 OS: ${os}`;

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("通知失敗:", err?.error ?? res.status);
    }
  } catch (e) {
    console.error("通知エラー:", e.message);
  }
})();
