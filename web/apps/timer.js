// @name LTタイマー
// @description 発表用のカウントダウン。A: 開始/一時停止  B: リセット (止まっているときは長さを変更)
const MINUTES = [5, 10, 15, 1, 3];
let choice = 0, total = 0, remain = 0, running = false, done = false, warned = false, last = 0;
const pad = n => String(n).padStart(2, "0");

function reset() {
  total = remain = MINUTES[choice] * 60000;
  running = done = warned = false;
}

function setup() {
  const saved = store.load();
  if (saved && MINUTES[saved.choice]) choice = saved.choice;
  reset();
}

function onButton(b) {
  watch.vibrate(40);
  if (b === "A") {
    if (done) return reset();
    running = !running;
    last = Date.now();
  } else if (running || done || remain !== total) {
    reset();
  } else {
    choice = (choice + 1) % MINUTES.length;
    store.save({ choice });
    reset();
  }
}

function draw() {
  if (running) {
    const now = Date.now();
    remain -= now - last;
    last = now;
    if (!warned && remain <= 30000) {  // 残り 30 秒を振動で知らせる
      warned = true;
      watch.vibrate(300);
    }
    if (remain <= 0) {
      remain = 0;
      running = false;
      done = true;
      watch.sound();
      watch.vibrate(800);
    }
  }
  const urgent = remain <= 30000 && remain !== total;
  const sec = Math.ceil(remain / 1000);
  const blink = done && Date.now() % 1000 < 500;

  g.clear();
  g.arc(233, 233, 228, 206, 0, 360, theme.surface);
  g.arc(233, 233, 228, 206, 0, remain / total * 360, urgent ? theme.accent2 : theme.accent);
  g.text(done ? "時間です" : running ? "残り" : `${MINUTES[choice]} 分`, 233, 135, { size: 28, color: theme.muted });
  g.text(pad(Math.floor(sec / 60)) + ":" + pad(sec % 60), 233, 220, { size: 75, font: "digit", color: blink ? theme.accent2 : theme.fg });
  const hint = done ? "A もう一度" : running ? "A 一時停止   B リセット" : remain === total ? "A 開始   B 長さ" : "A 再開   B リセット";
  g.text(hint, 233, 325, { size: 20, color: theme.muted });
}
