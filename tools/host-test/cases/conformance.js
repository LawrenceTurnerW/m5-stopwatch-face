// API の引数の扱いを一通り確かめる。実機側とサイトのプレビューで同じ記録になること。
function setup() {
  watch.frameRate(25);
  print("setup", g.width, g.height, typeof theme.accent);
}
function draw() {
  g.clear();
  g.clear(0x112233);
  g.clear("#abc");
  g.clear("#A1b2C3");
  g.face();
  g.fillRect(1.4, 2.5, 3.6, -4.5);
  g.fillRect(10, 20, 30, 40, theme.accent);
  g.fillRect("7", "8", 9, 10, null);
  g.fillRect(NaN, Infinity, -Infinity, 1e9, 0xffffff);
  g.rect(1, 2, 3, 4, theme.muted);
  g.fillRoundRect(1, 2, 30, 40, 5, theme.surface);
  g.fillRoundRect(1, 2, 30, 40, -5);
  g.fillCircle(233, 233, 10.5, theme.accent2);
  g.fillCircle(1, 2, -3);
  g.circle(5, 6, 7);
  g.line(0, 0, 100, 100);
  g.line(0, 0, 100, 100, theme.fg, 3);
  g.line(0, 0, 100, 100, theme.fg, 999);
  g.line(0, 0, 100, 100, theme.fg, 0);
  g.arc(233, 233, 200, 180, 0, 90, theme.accent);
  g.arc(233, 233, 180, 200, -30, 30);
  g.arc(233, 233, 200, 180, 10, 10);
  g.arc(233, 233, 200, 180, 90, 0);
  g.arc(233, 233, 200, 180, 45, 500);
  g.arc(233, 233, 200, 180, 0, 359.6);
  g.fillTriangle(1, 2, 3, 4, 5, 6, theme.bg);
  g.text("こんにちは", 233, 100);
  g.text(12345, 10, 20, { size: 30, align: "left" });
  g.text("right", 400, 20, { size: 64, align: "right", color: "#f00" });
  g.text("12:34", 233, 233, { size: 75, font: "digit", outline: theme.bg });
  g.text("big", 1, 2, { size: 1000, font: "digit", outline: 0 });
  g.text("tiny", 1, 2, { size: 1 });
  g.text("sizes", 0, 0, { size: 41 });
  g.text("sizes", 0, 0, { size: 100 });
  g.text("sizes", 0, 0, { size: 112, font: "digit" });
  g.text("sizes", 0, 0, { size: 113, font: "digit" });
  g.text("odd", 0, 0, { align: "middle", font: "serif", size: "36" });
  g.text(null, 0, 0, null);
  g.text("あ".repeat(100), 0, 0);
  g.text("quote \" and \\ back", 0, 0);
  g.textWidth("幅", { size: 40 });
  g.textWidth("幅");
  for (const s of [8, 12, 13, 14, 18, 22, 26, 38, 39, 40, 44, 50, 60, 70, 79, 80, 81, 90, 119, 120, 121, 160, 200, 240]) g.text("s", 0, 0, { size: s });
  watch.vibrate();
  watch.vibrate(5000);
  watch.vibrate(-5);
  watch.tone();
  watch.tone(10, 1);
  watch.tone(99999, 99999);
  watch.sound();
  const a = watch.accel();
  print("accel", a.x, a.y, a.z, "battery", watch.battery(), "power", watch.power());
  print("multi", 1, true, null, undefined, [1, 2], { a: 1 });
}
function onButton(b) { print("button", b); }
function onTouch(x, y) { print("touch", x, y); }
