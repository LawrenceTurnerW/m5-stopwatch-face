// @name カウンター
// @description タップか A で +1、B で 0 に戻す。数は電源を切っても残る
let count = 0;

function setup() {
  const saved = store.load();
  if (saved && typeof saved.count === "number") count = saved.count;
  watch.frameRate(5);
}

function add() {
  count++;
  store.save({ count });
  watch.vibrate(30);
}

function onTouch() {
  add();
}

function onButton(b) {
  if (b === "A") return add();
  count = 0;
  store.save({ count });
}

function draw() {
  g.clear();
  g.fillCircle(233, 233, 150, theme.surface);
  g.text(count, 233, 233, { size: count > 999 ? 80 : 120, color: theme.accent });
  g.text("カウンター", 233, 60, { size: 24, color: theme.muted });
  g.text("タップ +1   B リセット", 233, 410, { size: 20, color: theme.muted });
}
