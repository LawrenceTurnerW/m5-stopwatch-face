// @name 反射神経
// @description 色が変わったらすぐタップ(かボタン A)。反応の速さをミリ秒で測る
let state = "idle", goAt = 0, shownAt = 0, result = 0, best = 0;

function setup() {
  const saved = store.load();
  if (saved && saved.best > 0) best = saved.best;
  watch.frameRate(30);
}

function press() {
  const now = Date.now();
  if (state === "wait") {
    state = "early";
    watch.vibrate(200);
  } else if (state === "go") {
    result = now - shownAt;
    state = "done";
    watch.vibrate(40);
    if (!best || result < best) {
      best = result;
      store.save({ best });
    }
  } else {
    state = "wait";
    goAt = now + 1500 + Math.random() * 3000;
  }
}

function onButton(b) {
  if (b === "A") press();
}

function onTouch() {
  press();
}

function draw() {
  if (state === "wait" && Date.now() >= goAt) {
    state = "go";
    shownAt = Date.now();
  }
  if (state === "go") {
    g.clear(theme.accent);
    g.text("いま!", 233, 233, { size: 96, color: theme.bg });
    return;
  }
  g.clear();
  if (state === "wait") {
    g.fillCircle(233, 233, 110, theme.surface);
    g.text("まだ…", 233, 233, { size: 40, color: theme.muted });
  } else if (state === "early") {
    g.text("フライング", 233, 200, { size: 48, color: theme.accent2 });
    g.text("タップでもう一度", 233, 290, { size: 24, color: theme.muted });
  } else if (state === "done") {
    g.text(result, 233, 195, { size: 75, font: "digit", color: result === best ? theme.accent : theme.fg });
    g.text(result === best ? "ミリ秒  新記録!" : "ミリ秒", 233, 280, { size: 28, color: theme.muted });
    g.text("タップでもう一度", 233, 350, { size: 20, color: theme.muted });
  } else {
    g.text("反射神経", 233, 170, { size: 40 });
    g.text("色が変わったらタップ", 233, 240, { size: 24, color: theme.muted });
    g.text("タップで開始", 233, 300, { size: 24, color: theme.accent });
  }
  if (best && state !== "wait") g.text(`ベスト ${best} ms`, 233, 410, { size: 20, color: theme.muted });
}
