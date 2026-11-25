// @name サイコロ
// @description 画面タップかボタン A で振る
const PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];
let value = 1, rolling = 0;

function roll() {
  rolling = 12;
  watch.frameRate(20);
}

function setup() {
  roll();
}

function onButton(b) {
  if (b === "A") roll();
}

function onTouch() {
  roll();
}

function draw() {
  if (rolling > 0) {
    value = 1 + Math.floor(Math.random() * 6);
    if (--rolling === 0) {
      watch.vibrate(80);
      watch.frameRate(5);
    }
  }
  g.clear();
  g.fillRoundRect(113, 113, 240, 240, 36, rolling ? theme.surface : theme.fg);
  for (const p of PIPS[value]) {
    g.fillCircle(163 + (p % 3) * 70, 163 + Math.floor(p / 3) * 70, 22, rolling ? theme.muted : theme.accent);
  }
  g.text("タップで振る", 233, 400, { size: 20, color: theme.muted });
}
