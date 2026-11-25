// @name 水平器
// @description 本体の傾きを泡の位置で表示する
let x = 0, y = 0;

function setup() {
  watch.frameRate(20);
}

function draw() {
  const a = watch.accel();
  x += (a.x - x) * 0.3;  // ふらつきをならす
  y += (a.y - y) * 0.3;
  const tilt = Math.atan2(Math.hypot(x, y), Math.abs(a.z)) * 180 / Math.PI;
  const level = tilt < 1.5;

  g.clear();
  g.line(40, 233, 426, 233, theme.surface, 2);
  g.line(233, 40, 233, 426, theme.surface, 2);
  for (const r of [60, 130, 200]) g.circle(233, 233, r, theme.muted);
  g.fillCircle(233 - x * 200, 233 + y * 200, 28, level ? theme.accent : theme.accent2);
  g.text(tilt.toFixed(1) + "°", 233, 390, { size: 32 });
}
