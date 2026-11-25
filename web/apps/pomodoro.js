// @name ポモドーロ
// @description 25 分の作業と 5 分の休憩をくり返す。A: 開始/一時停止  B: リセット
const WORK = 25 * 60000, REST = 5 * 60000;
let resting = false, remain = WORK, running = false, last = 0, count = 0, day = "";
const pad = n => String(n).padStart(2, "0");
const today = () => new Date().toDateString();

function setup() {
  const saved = store.load();
  if (saved && saved.day === today()) count = saved.count || 0;  // 回数は日付が変わると 0 に戻す
  day = today();
  watch.frameRate(4);
}

function onButton(b) {
  watch.vibrate(40);
  if (b === "A") {
    running = !running;
    last = Date.now();
  } else {
    running = false;
    resting = false;
    remain = WORK;
  }
}

function next() {
  if (!resting) {
    if (day !== today()) { day = today(); count = 0; }
    count++;
    store.save({ day, count });
  }
  resting = !resting;
  remain = resting ? REST : WORK;
  watch.sound();
  watch.vibrate(resting ? 600 : 300);
}

function draw() {
  if (running) {
    const now = Date.now();
    remain -= now - last;
    last = now;
    if (remain <= 0) next();
  }
  const total = resting ? REST : WORK;
  const sec = Math.ceil(remain / 1000);
  const color = resting ? theme.accent2 : theme.accent;

  g.clear();
  g.arc(233, 233, 228, 208, 0, 360, theme.surface);
  g.arc(233, 233, 228, 208, 0, Math.max(1, remain / total * 360), color);
  g.text(resting ? "休憩" : "作業", 233, 130, { size: 32, color });
  g.text(pad(Math.floor(sec / 60)) + ":" + pad(sec % 60), 233, 220, { size: 75, font: "digit" });
  g.text(`きょう ${count} 回`, 233, 310, { size: 24, color: theme.muted });
  g.text(running ? "A 一時停止   B リセット" : "A 開始   B リセット", 233, 360, { size: 20, color: theme.muted });
}
