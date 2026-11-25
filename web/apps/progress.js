// @name 進みぐあい
// @description きょう・今週・今年がどこまで進んだかを 3 本の輪で表示する
function setup() {
  watch.frameRate(1);
}

function ring(r, ratio, color) {
  g.arc(233, 233, r, r - 24, 0, 360, theme.surface);
  g.arc(233, 233, r, r - 24, 0, Math.max(1, ratio * 360), color);
}

function draw() {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = (now - dayStart) / 86400000;
  const week = ((now.getDay() + 6) % 7 + day) / 7;  // 月曜はじまり
  const yearStart = new Date(now.getFullYear(), 0, 1), yearEnd = new Date(now.getFullYear() + 1, 0, 1);
  const year = (now - yearStart) / (yearEnd - yearStart);
  const pct = v => Math.floor(v * 100) + "%";

  g.clear();
  ring(228, year, theme.accent2);
  ring(196, week, theme.accent);
  ring(164, day, theme.fg);
  g.text("今年", 200, 190, { size: 20, color: theme.accent2, align: "right" });
  g.text(pct(year), 215, 190, { size: 28, align: "left" });
  g.text("今週", 200, 233, { size: 20, color: theme.accent, align: "right" });
  g.text(pct(week), 215, 233, { size: 28, align: "left" });
  g.text("きょう", 200, 276, { size: 20, color: theme.muted, align: "right" });
  g.text(pct(day), 215, 276, { size: 28, align: "left" });
}
