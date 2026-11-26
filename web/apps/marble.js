// @name 玉ころがし
// @description 本体を傾けて玉を転がし、30 秒でいくつ的に入れられるか。A: 開始
let x = 233, y = 233, vx = 0, vy = 0, tx = 233, ty = 120, score = 0, best = 0, endAt = 0, played = false;

function place() {  // 的を、いまの玉から離れた場所に置く
  do {
    const a = Math.random() * 2 * Math.PI, r = 40 + Math.random() * 140;
    tx = 233 + Math.cos(a) * r;
    ty = 233 + Math.sin(a) * r;
  } while (Math.hypot(tx - x, ty - y) < 110);
}

function setup() {
  const saved = store.load();
  if (saved && saved.best > 0) best = saved.best;
  watch.frameRate(20);
}

function start() {
  if (Date.now() < endAt) return;
  x = y = 233;
  vx = vy = score = 0;
  endAt = Date.now() + 30000;
  played = true;
  place();
  watch.vibrate(40);
}

function onButton(b) {
  if (b === "A") start();
}

function onTouch() {
  start();
}

function draw() {
  const left = endAt - Date.now();
  g.clear();
  g.circle(233, 233, 228, theme.surface);
  if (left <= 0) {
    if (played && score > best) {
      best = score;
      store.save({ best });
    }
    g.text(played ? "おしまい" : "玉ころがし", 233, 150, { size: 40 });
    if (played) g.text(`${score} 個`, 233, 225, { size: 56, color: theme.accent });
    else g.text("傾けて的に入れる", 233, 225, { size: 24, color: theme.muted });
    g.text(`ベスト ${best} 個`, 233, 300, { size: 24, color: theme.muted });
    g.text("A かタップで開始", 233, 360, { size: 20, color: theme.muted });
    return;
  }

  // 傾いた方へ転がす (x は右を下げると正、y は上を下げると正)
  const a = watch.accel();
  vx = (vx + a.x * 2.5) * 0.96;
  vy = (vy - a.y * 2.5) * 0.96;
  x += vx;
  y += vy;
  const d = Math.hypot(x - 233, y - 233);
  if (d > 204) {  // 縁ではね返る
    const nx = (x - 233) / d, ny = (y - 233) / d, dot = vx * nx + vy * ny;
    x = 233 + nx * 204;
    y = 233 + ny * 204;
    if (dot > 0) {
      vx -= 1.6 * dot * nx;
      vy -= 1.6 * dot * ny;
    }
  }
  if (Math.hypot(x - tx, y - ty) < 36) {
    score++;
    watch.vibrate(30);
    watch.tone(1320, 40);
    place();
  }

  g.arc(233, 233, 228, 220, 0, Math.max(1, left / 30000 * 360), left < 5000 ? theme.accent2 : theme.accent);
  g.fillCircle(tx, ty, 30, theme.surface);
  g.circle(tx, ty, 30, theme.accent);
  g.fillCircle(x, y, 20, theme.fg);
  g.text(score, 233, 60, { size: 32, color: theme.muted });
}
