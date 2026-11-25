// @name おみくじ
// @description 本体を振るか、A かタップで引く
const LOTS = [
  ["大吉", 12, "なんでもうまくいく日"],
  ["中吉", 22, "いい流れが来ている"],
  ["小吉", 22, "小さな幸せを拾える"],
  ["吉", 22, "ふだんどおりが一番"],
  ["末吉", 14, "あとから良くなる"],
  ["凶", 8, "きょうは慎重に"],
];
let lot = null, rolling = 0, shown = 0, lastShake = 0;

function pick() {
  let n = Math.random() * 100;
  for (const l of LOTS) if ((n -= l[1]) < 0) return l;
  return LOTS[3];
}

function pull() {
  if (rolling) return;
  rolling = 24;
  watch.vibrate(60);
}

function setup() {
  watch.frameRate(15);
}

function onButton(b) {
  if (b === "A") pull();
}

function onTouch() {
  pull();
}

function draw() {
  const a = watch.accel();
  const now = Date.now();
  if (Math.abs(Math.hypot(a.x, a.y, a.z) - 1) > 0.9 && now - lastShake > 1500) {  // 振った
    lastShake = now;
    pull();
  }
  if (rolling) {
    shown = (shown + 1) % LOTS.length;
    if (--rolling === 0) {
      lot = pick();
      watch.vibrate(lot[0] === "大吉" ? 500 : 150);
      if (lot[0] === "大吉") watch.sound();
    }
  }

  g.clear();
  g.arc(233, 233, 228, 216, 0, 360, theme.surface);
  if (rolling) {
    g.text(LOTS[shown][0], 233 + (rolling % 2 ? 6 : -6), 225, { size: 96, color: theme.muted });
  } else if (lot) {
    const bad = lot[0] === "凶";
    g.text(lot[0], 233, 205, { size: 120, color: bad ? theme.accent2 : theme.accent });
    g.text(lot[2], 233, 315, { size: 24 });
    g.text("振るとまた引ける", 233, 390, { size: 20, color: theme.muted });
  } else {
    g.text("おみくじ", 233, 190, { size: 48 });
    g.text("本体を振って引く", 233, 265, { size: 24, color: theme.muted });
    g.text("A やタップでも引ける", 233, 305, { size: 20, color: theme.muted });
  }
}
