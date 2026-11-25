// @name メトロノーム
// @description 音と振動で拍を刻む。タップ: 開始/停止  A: 速く  B: 遅く
let bpm = 100, running = false, nextAt = 0, beat = 0, flashUntil = 0;

function setup() {
  const saved = store.load();
  if (saved && saved.bpm >= 40 && saved.bpm <= 220) bpm = saved.bpm;
  watch.frameRate(30);  // 拍のずれを小さくするため、細かく見に行く
}

function onButton(b) {
  bpm = Math.max(40, Math.min(220, bpm + (b === "A" ? 4 : -4)));
  store.save({ bpm });
}

function onTouch() {
  running = !running;
  beat = 0;
  nextAt = Date.now();
}

function draw() {
  const now = Date.now();
  if (running && now >= nextAt) {
    const first = beat % 4 === 0;
    watch.tone(first ? 1760 : 880, 40);
    watch.vibrate(first ? 60 : 25);
    flashUntil = now + 90;
    beat++;
    nextAt += 60000 / bpm;
    if (nextAt < now) nextAt = now + 60000 / bpm;  // 大きく遅れたら追いかけない
  }
  const current = (beat + 3) % 4;  // いま鳴った拍

  g.clear();
  g.arc(233, 233, 228, 212, 0, 360, now < flashUntil ? theme.accent : theme.surface);
  g.text(bpm, 233, 190, { size: 75, font: "digit" });
  g.text("BPM", 233, 262, { size: 24, color: theme.muted });
  for (let i = 0; i < 4; i++) {
    const on = running && beat > 0 && i === current;
    g.fillCircle(152 + i * 54, 320, on ? 18 : 12, on ? (i === 0 ? theme.accent2 : theme.accent) : theme.surface);
  }
  g.text(running ? "タップで停止" : "タップで開始", 233, 380, { size: 20, color: theme.muted });
  g.text("A 速く   B 遅く", 233, 412, { size: 20, color: theme.muted });
}
