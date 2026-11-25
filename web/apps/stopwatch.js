// @name ストップウォッチ
// @description A: スタート/ストップ  B: ラップ/リセット
let running = false, base = 0, startedAt = 0, laps = [];
const pad = n => String(n).padStart(2, "0");
const elapsed = () => base + (running ? Date.now() - startedAt : 0);
const mmss = ms => pad(Math.floor(ms / 60000)) + ":" + pad(Math.floor(ms / 1000) % 60);
const cs = ms => "." + pad(Math.floor(ms / 10) % 100);

function setup() {
  watch.frameRate(20);
}

function onButton(b) {
  if (b === "A") {
    if (running) base = elapsed();
    else startedAt = Date.now();
    running = !running;
    watch.vibrate(40);
  } else if (running) {
    laps.unshift(elapsed());
    laps.length = Math.min(laps.length, 3);
    watch.vibrate(20);
  } else {
    base = 0;
    laps = [];
  }
}

function draw() {
  const t = elapsed();
  g.clear();
  // 1 分で 1 周するリング
  g.arc(233, 233, 228, 214, 0, 360, theme.surface);
  g.arc(233, 233, 228, 214, 0, (t % 60000) / 60000 * 360, running ? theme.accent : theme.muted);

  g.text(mmss(t), 233, 170, { size: 75, font: "digit" });
  g.text(cs(t), 233, 240, { size: 40, color: theme.accent });
  laps.forEach((lap, i) => {
    g.text(`${laps.length - i}  ${mmss(lap)}${cs(lap)}`, 233, 290 + i * 30, { size: 24, color: theme.muted });
  });
  g.text(running ? "A ストップ   B ラップ" : "A スタート   B リセット", 233, 400, { size: 20, color: theme.muted });
}
