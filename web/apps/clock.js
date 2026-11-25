// @name 時計
// @description テーマの文字盤に時刻を重ねる基本の時計
const WD = "日月火水木金土";
const pad = n => String(n).padStart(2, "0");

function draw() {
  const now = new Date();
  g.face();

  // 秒: 外周を回る点
  const a = now.getSeconds() * 6 * Math.PI / 180;
  const x = 233 + Math.sin(a) * 217, y = 233 - Math.cos(a) * 217;
  g.fillCircle(x, y, 9, theme.bg);
  g.fillCircle(x, y, 6, theme.accent2);

  g.text(pad(now.getHours()) + ":" + pad(now.getMinutes()), 233, 223, { size: 75, font: "digit", outline: theme.bg });
  g.text(`${now.getMonth() + 1}/${now.getDate()} (${WD[now.getDay()]})`, 233, 303, { size: 28, outline: theme.bg });
}
