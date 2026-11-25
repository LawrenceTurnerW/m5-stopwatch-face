// @name けんばん
// @description 画面の 8 つの区画をタップするとドレミが鳴る。A・B で高さを変える
const NAMES = ["ド", "レ", "ミ", "ファ", "ソ", "ラ", "シ", "ド"];
const SEMITONES = [0, 2, 4, 5, 7, 9, 11, 12];
let octave = 0, lit = -1, litUntil = 0;

function setup() {
  watch.frameRate(10);
}

function onButton(b) {
  octave = Math.max(-1, Math.min(1, octave + (b === "A" ? 1 : -1)));
  watch.tone(262 * Math.pow(2, octave), 80);
}

function onTouch(x, y) {
  if (Math.hypot(x - 233, y - 233) < 70) return;  // 真ん中は鳴らさない
  let deg = Math.atan2(x - 233, 233 - y) * 180 / Math.PI;  // 12 時が 0 度、時計回り
  if (deg < 0) deg += 360;
  lit = Math.floor(deg / 45);
  litUntil = Date.now() + 250;
  watch.tone(Math.round(262 * Math.pow(2, octave + SEMITONES[lit] / 12)), 250);
}

function draw() {
  const now = Date.now();
  g.clear();
  for (let i = 0; i < 8; i++) {
    const on = i === lit && now < litUntil;
    g.arc(233, 233, 228, 84, i * 45 + 2, i * 45 + 43, on ? theme.accent : theme.surface);
    const a = (i * 45 + 22.5) * Math.PI / 180;
    g.text(NAMES[i], 233 + Math.sin(a) * 158, 233 - Math.cos(a) * 158, { size: 32, color: on ? theme.bg : i === 0 || i === 7 ? theme.accent2 : theme.fg });
  }
  g.text(["低い", "ふつう", "高い"][octave + 1], 233, 222, { size: 24 });
  g.text("B ↓  A ↑", 233, 256, { size: 16, color: theme.muted });
}
