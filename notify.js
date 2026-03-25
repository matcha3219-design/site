// ============================================================
// 設定
// ============================================================
const WORKER_URL = "https://broad-brook-c6dd.mattya3219.workers.dev";
// ============================================================

(async () => {
  const now = new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `👀 誰か来たよ！ ${now}` }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("通知失敗:", err?.error ?? res.status);
    }
  } catch (e) {
    console.error("通知エラー:", e.message);
  }
})();