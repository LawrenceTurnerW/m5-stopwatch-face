// @name アナログ時計
// @description 針で時刻を表示する。B で秒針のあり/なしを切り替え
let seconds = true;

function setup() {
  const saved = store.load();
  if (saved && saved.seconds === false) seconds = false;
  watch.frameRate(seconds ? 10 : 1);
}

function onButton(b) {
  if (b !== "B") return;
  seconds = !seconds;
  store.save({ seconds });
  watch.frameRate(seconds ? 10 : 1);
}

function hand(deg, from, to, color, width) {
  const s = Math.sin(deg * Math.PI / 180), c = Math.cos(deg * Math.PI / 180);
  g.line(233 + s * from, 233 - c * from, 233 + s * to, 233 - c * to, color, width);
}

function draw() {
  const now = new Date();
  const s = now.getSeconds() + now.getMilliseconds() / 1000;
  const m = now.getMinutes() + s / 60;
  const h = now.getHours() % 12 + m / 60;

  g.clear();
  for (let i = 0; i < 12; i++) {
    const big = i % 3 === 0;
    hand(i * 30, big ? 192 : 206, 224, big ? theme.fg : theme.muted, big ? 6 : 2);
  }
  g.text(now.getDate(), 330, 233, { size: 28, color: theme.muted });
  hand(h * 30, -20, 120, theme.fg, 10);
  hand(m * 6, -20, 185, theme.fg, 6);
  if (seconds) hand(s * 6, -35, 205, theme.accent2, 2);
  g.fillCircle(233, 233, 10, seconds ? theme.accent2 : theme.fg);
}
