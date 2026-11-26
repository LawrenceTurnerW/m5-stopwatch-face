// AI に渡す説明文。web/index.html の「アプリの書き方」と src/app_runtime.cpp の API に合わせてある。
// API を変えたら、ここも直す。お手本は web/apps/ のサンプルから写したもの。

export const API_REFERENCE = "画面は直径 466px の円 (座標は左上が 0,0、中心は 233,233)。四隅は見えないので、大事なものは中心から半径 200px 以内に置く。\n\n書くもの:\n  // @name 名前            先頭のコメント (必須)。本体のアプリ一覧に出る。20 文字以内\n  // @description 説明     2 行目のコメント (必須)。操作方法を 1 行で\n  function setup()         起動時に 1 回 (省略可)\n  function draw()          画面を描く (必須)。既定は 1 秒に 10 回呼ばれる。毎回 g.clear() から全体を描き直す\n  function onButton(b)     ボタンが押された。b は \"A\" か \"B\"\n  function onTouch(x, y)   画面に触れた瞬間に 1 回呼ばれる (ドラッグや長押しは取れない)\n\n使えるもの (これ以外の関数は無い):\n  theme.bg / theme.surface / theme.fg / theme.muted / theme.accent / theme.accent2\n      テーマカラー (背景 / 面 / 文字 / 控えめ / 強調 / 強調 2)。色は必ずここから取る。\"#rrggbb\" の直書きは避ける\n  g.clear(色)                              塗りつぶす。省略時は theme.bg\n  g.face()                                 テーマの文字盤画像を全面に描く\n  g.fillRect(x, y, w, h, 色)   g.rect(x, y, w, h, 色)   g.fillRoundRect(x, y, w, h, r, 色)\n  g.fillCircle(x, y, r, 色)    g.circle(x, y, r, 色)    g.fillTriangle(x0, y0, x1, y1, x2, y2, 色)\n  g.line(x0, y0, x1, y1, 色, 太さ)\n  g.arc(x, y, 外半径, 内半径, 開始角, 終了角, 色)   輪の一部。角度は度で、12 時が 0、時計回り。開始 < 終了、0〜360 の範囲で使う\n  g.text(文字, x, y, { size, color, align, font, outline })\n      (x, y) は文字の中心。size は 12〜120 程度 (既定 24)。align は \"left\" / \"center\" / \"right\" (既定 center)\n      日本語が使える。font: \"digit\" は数字と : . だけの大きな書体で、size は 75 を指定する\n      outline は縁取りの色。絵文字は表示できない\n  g.textWidth(文字, { size, font })        文字の幅 (px)\n  watch.vibrate(ミリ秒)                    振動 (最大 1000)\n  watch.tone(周波数, ミリ秒)               ビープ音 (最大 2000 ミリ秒)\n  watch.sound()                            テーマの効果音\n  watch.accel()                            加速度 { x, y, z } (単位 G)。x は右を下げると正、y は上 (12 時側) を下げると正。平らに置くと z が約 1\n  watch.battery()                          電池残量 0〜100\n  watch.power()                            \"battery\" / \"charging\" / \"usb\" / \"unknown\"\n  watch.frameRate(回数)                    draw() の頻度 (1〜30)。動きのあるものは 20、ほぼ動かないものは 1〜5\n  watch.exit()                             時計に戻る\n  store.load()   store.save(値)            アプリごとの保存領域 (JSON にして 4096 バイトまで)。load は未保存なら null\n  print(...)                               デバッグ出力\n  Date / Math / JSON / 配列 / 文字列など JavaScript の標準機能\n\n無いもの: setTimeout, setInterval, fetch, DOM, canvas, 画像の読み込み, import, async/await での待機。\n時間の経過は Date.now() を draw() の中で見て判断する。\n\n制限: draw() やイベント 1 回が 0.25 秒を超えると止められる。本体は遅いので、1 回の draw() の描画命令は 100 個程度までにし、重いループは避ける。メモリは 1MB、スクリプトは 64kB まで。";

const EXAMPLES = ["// @name カウンター\n// @description タップか A で +1、B で 0 に戻す。数は電源を切っても残る\nlet count = 0;\n\nfunction setup() {\n  const saved = store.load();\n  if (saved && typeof saved.count === \"number\") count = saved.count;\n  watch.frameRate(5);\n}\n\nfunction add() {\n  count++;\n  store.save({ count });\n  watch.vibrate(30);\n}\n\nfunction onTouch() {\n  add();\n}\n\nfunction onButton(b) {\n  if (b === \"A\") return add();\n  count = 0;\n  store.save({ count });\n}\n\nfunction draw() {\n  g.clear();\n  g.fillCircle(233, 233, 150, theme.surface);\n  g.text(count, 233, 233, { size: count > 999 ? 80 : 120, color: theme.accent });\n  g.text(\"カウンター\", 233, 60, { size: 24, color: theme.muted });\n  g.text(\"タップ +1   B リセット\", 233, 410, { size: 20, color: theme.muted });\n}", "// @name サイコロ\n// @description 画面タップかボタン A で振る\nconst PIPS = [[], [4], [0, 8], [0, 4, 8], [0, 2, 6, 8], [0, 2, 4, 6, 8], [0, 2, 3, 5, 6, 8]];\nlet value = 1, rolling = 0;\n\nfunction roll() {\n  rolling = 12;\n  watch.frameRate(20);\n}\n\nfunction setup() {\n  roll();\n}\n\nfunction onButton(b) {\n  if (b === \"A\") roll();\n}\n\nfunction onTouch() {\n  roll();\n}\n\nfunction draw() {\n  if (rolling > 0) {\n    value = 1 + Math.floor(Math.random() * 6);\n    if (--rolling === 0) {\n      watch.vibrate(80);\n      watch.frameRate(5);\n    }\n  }\n  g.clear();\n  g.fillRoundRect(113, 113, 240, 240, 36, rolling ? theme.surface : theme.fg);\n  for (const p of PIPS[value]) {\n    g.fillCircle(163 + (p % 3) * 70, 163 + Math.floor(p / 3) * 70, 22, rolling ? theme.muted : theme.accent);\n  }\n  g.text(\"タップで振る\", 233, 400, { size: 20, color: theme.muted });\n}"];

export const APP_SYSTEM = `あなたは M5Stack StopWatch (丸い画面の小さなデバイス) で動くミニアプリを書くプログラマーです。
頼まれた内容のアプリを、下の API だけを使った JavaScript 1 ファイルで書いてください。

${API_REFERENCE}

決まり:
- 返すのは JavaScript のコードだけ。\`\`\`js で始まり \`\`\` で終わる 1 つのコードブロックにする。説明文は書かない。
- 上の API に無い関数は使わない。
- 画面の文言は日本語にする。操作のヒント (どのボタンで何が起きるか) を画面のどこかに小さく出す。
- 色は theme から取る。
- ボタンは A と B の 2 つ、あとは画面のタップと本体の傾きだけ。その範囲で操作を考える。
- コードは 150 行以内を目安に、読みやすく書く。

お手本 1:
\`\`\`js
${EXAMPLES[0]}
\`\`\`

お手本 2:
\`\`\`js
${EXAMPLES[1]}
\`\`\``;

export const THEME_SYSTEM = `あなたは配色デザイナーです。丸い画面の時計型デバイスのテーマカラーを 6 色で作ります。
頼まれた雰囲気に合う配色を、次の JSON だけで返してください。説明文は書かないでください。

{"colors": ["#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb", "#rrggbb"]}

6 色の役割 (この順番):
1. 背景: 画面の地
2. 面: ボタンやリングの下地。背景と少しだけ違う色
3. 文字: 主な文字。背景の上ではっきり読めること (明るさの差を大きく)
4. 控えめ: 補助の文字や目盛り。背景の上で読めるが、文字より目立たない
5. 強調: 進み具合や選択中を示す色。背景の上で目立つこと
6. 強調 2: 秒針や警告に使う、強調とは別の色

明るい背景でも暗い背景でも構いません。背景と文字のコントラストは必ず確保してください。`;
