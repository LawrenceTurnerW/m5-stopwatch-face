// @name 傾きチェック
// @description 加速度センサーの生の値と、傾けた向きを表示する。向きのずれを調べるのに使う
let x = 0, y = 0, z = 0;

function setup() {
  watch.frameRate(10);
}

function draw() {
  const a = watch.accel();
  x += (a.x - x) * 0.3;  // ふらつきをならす
  y += (a.y - y) * 0.3;
  z += (a.z - z) * 0.3;
  const tilt = Math.atan2(Math.hypot(x, y), Math.abs(z)) * 180 / Math.PI;
  let dir = Math.atan2(x, y) * 180 / Math.PI;  // 玉ころがしが玉を進める向き。12 時が 0 度、時計回り
  if (dir < 0) dir += 360;
  const flat = tilt < 3;

  g.clear();
  g.circle(233, 233, 200, theme.surface);
  for (let i = 0; i < 12; i++) {
    const r = i * 30 * Math.PI / 180;
    g.text(i === 0 ? 12 : i, 233 + Math.sin(r) * 215, 233 - Math.cos(r) * 215, { size: 16, color: theme.muted });
  }
  if (!flat) {
    const r = dir * Math.PI / 180;
    g.line(233, 233, 233 + Math.sin(r) * 190, 233 - Math.cos(r) * 190, theme.accent, 6);
    g.fillCircle(233 + Math.sin(r) * 190, 233 - Math.cos(r) * 190, 12, theme.accent);
  }
  g.fillCircle(233, 233, 92, theme.bg);
  g.text(flat ? "水平" : Math.round(dir) + "°", 233, 205, { size: 40, color: flat ? theme.muted : theme.accent });
  g.text(`傾き ${tilt.toFixed(0)}°`, 233, 245, { size: 20, color: theme.muted });
  g.text(`x ${x.toFixed(2)}  y ${y.toFixed(2)}`, 233, 275, { size: 16 });
  g.text(`z ${z.toFixed(2)}`, 233, 297, { size: 16 });
}
