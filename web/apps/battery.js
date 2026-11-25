// @name 電池メーター
// @description 電池の残量、充電中かどうか、開いてからの減りぐあいを表示する
let first = -1, startedAt = 0;

function setup() {
  watch.frameRate(1);
}

function draw() {
  const level = Math.max(0, Math.min(100, Math.round(watch.battery())));
  const now = Date.now();
  if (first < 0) {
    first = level;
    startedAt = now;
  }
  const minutes = Math.floor((now - startedAt) / 60000);
  const used = first - level;
  const color = level <= 20 ? theme.accent2 : theme.accent;

  g.clear();
  g.arc(233, 233, 228, 200, 0, 360, theme.surface);
  g.arc(233, 233, 228, 200, 0, Math.max(1, level * 3.6), color);
  g.text(level, 233, 205, { size: 75, font: "digit", color: level <= 20 ? theme.accent2 : theme.fg });
  g.text("%", 233, 275, { size: 32, color: theme.muted });
  let note = `${minutes} 分で ${used > 0 ? "-" + used : used < 0 ? "+" + -used : "±0"}%`;
  if (used > 0 && minutes >= 5) note += `  あと約 ${Math.round(level / used * minutes / 6) / 10} 時間`;
  g.text(note, 233, 365, { size: 20, color: theme.muted });
  const power = watch.power();
  const label = { charging: "充電中", usb: "USB につながっている", battery: "電池で動作中" }[power] || "";
  g.text(label, 233, 325, { size: 24, color: power === "charging" ? theme.accent2 : theme.fg });
}
