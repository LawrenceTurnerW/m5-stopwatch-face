// @name 深呼吸
// @description 円に合わせて、吸う 4 秒・止める 4 秒・吐く 6 秒。A: 開始/停止
const STEPS = [["吸う", 4000], ["止める", 4000], ["吐く", 6000]];
const CYCLE = 14000;
let startedAt = 0, lastStep = -1, rounds = 0;

function setup() {
  watch.frameRate(15);
}

function toggle() {
  startedAt = startedAt ? 0 : Date.now();
  lastStep = -1;
  rounds = 0;
  watch.vibrate(40);
}

function onButton(b) {
  if (b === "A") toggle();
}

function onTouch() {
  toggle();
}

function draw() {
  g.clear();
  g.circle(233, 233, 200, theme.surface);
  if (!startedAt) {
    g.fillCircle(233, 233, 80, theme.surface);
    g.text("深呼吸", 233, 233, { size: 32 });
    g.text("A かタップで開始", 233, 390, { size: 20, color: theme.muted });
    return;
  }
  const elapsed = Date.now() - startedAt;
  let t = elapsed % CYCLE, step = 0;
  while (t >= STEPS[step][1]) t -= STEPS[step++][1];
  if (step !== lastStep) {  // 切り替わりを振動で知らせる (目を閉じていてもわかるように)
    if (lastStep >= 0) watch.vibrate(step === 0 ? 120 : 50);
    lastStep = step;
    rounds = Math.floor(elapsed / CYCLE) + 1;
  }
  const p = t / STEPS[step][1];
  const ease = (1 - Math.cos(p * Math.PI)) / 2;
  const size = step === 0 ? ease : step === 1 ? 1 : 1 - ease;

  g.fillCircle(233, 233, 70 + size * 130, step === 2 ? theme.accent2 : theme.accent);
  g.text(STEPS[step][0], 233, 220, { size: 40, color: theme.bg });
  g.text(Math.ceil((STEPS[step][1] - t) / 1000), 233, 270, { size: 28, color: theme.bg });
  g.text(`${rounds} 回目`, 233, 418, { size: 20, color: theme.muted });
}
