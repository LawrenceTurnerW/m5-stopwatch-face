// @name 歩数計
// @description 揺れを数えて歩数の目安を出す。数は日付が変わると 0 に戻る。B: リセット
let steps = 0, day = "", smooth = 1, above = false, lastStep = 0, dirty = 0;
const today = () => new Date().toDateString();

function setup() {
  const saved = store.load();
  day = today();
  if (saved && saved.day === day) steps = saved.steps || 0;
  watch.frameRate(20);  // 歩く揺れ(1 秒に 2 回ほど)を拾える細かさ
}

function onButton(b) {
  if (b !== "B") return;
  steps = 0;
  store.save({ day, steps });
  watch.vibrate(60);
}

function draw() {
  const a = watch.accel(), now = Date.now();
  const mag = Math.hypot(a.x, a.y, a.z);
  smooth += (mag - smooth) * 0.1;  // 重力ぶんをならして、揺れだけを取り出す
  const swing = mag - smooth;
  if (!above && swing > 0.18 && now - lastStep > 280) {
    above = true;
    lastStep = now;
    if (day !== today()) { day = today(); steps = 0; }
    steps++;
    dirty++;
  } else if (above && swing < 0.05) {
    above = false;
  }
  if (dirty >= 20 || (dirty && now - lastStep > 3000)) {  // 保存は 20 歩ごとか、立ち止まったとき
    dirty = 0;
    store.save({ day, steps });
  }
  const goal = 8000;

  g.clear();
  g.arc(233, 233, 228, 208, 0, 360, theme.surface);
  g.arc(233, 233, 228, 208, 0, Math.max(1, Math.min(1, steps / goal) * 360), steps >= goal ? theme.accent2 : theme.accent);
  g.text("きょうの歩数", 233, 130, { size: 24, color: theme.muted });
  g.text(steps, 233, 215, { size: 75, font: "digit" });
  g.text(`目標 ${goal} 歩`, 233, 300, { size: 20, color: theme.muted });
  g.fillCircle(233, 350, now - lastStep < 150 ? 10 : 5, theme.accent);
  g.text("B リセット", 233, 395, { size: 20, color: theme.muted });
}
