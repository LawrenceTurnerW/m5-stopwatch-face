// @name バイナリ時計
// @description 時・分・秒を 2 進数の点で表示する。B で答え(数字)を出す
const ROWS = ["時", "分", "秒"];
let hint = false;

function setup() {
  watch.frameRate(2);
}

function onButton(b) {
  if (b === "B") hint = !hint;
}

function draw() {
  const now = new Date();
  const values = [now.getHours(), now.getMinutes(), now.getSeconds()];

  g.clear();
  for (let r = 0; r < 3; r++) {
    const y = 143 + r * 90;
    g.text(ROWS[r], 62, y, { size: 24, color: theme.muted });
    for (let bit = 5; bit >= 0; bit--) {
      const x = 118 + (5 - bit) * 52;
      if (values[r] >> bit & 1) g.fillCircle(x, y, 20, r === 2 ? theme.accent2 : theme.accent);
      else g.fillCircle(x, y, 20, theme.surface);
    }
    if (hint) g.text(values[r], 425, y, { size: 24, color: theme.fg });
  }
  for (let bit = 5; bit >= 0; bit--) {
    g.text(1 << bit, 118 + (5 - bit) * 52, 72, { size: 16, color: theme.muted });
  }
  g.text(hint ? "B 数字を隠す" : "B 数字を出す", 233, 400, { size: 20, color: theme.muted });
}
