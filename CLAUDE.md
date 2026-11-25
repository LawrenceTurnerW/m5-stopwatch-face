# M5 StopWatch 着せ替え時計

全体像は `README.md` にあります。作業を始める前に読んでください。`HANDOFF.md` があれば、それは手元だけの作業メモです(git には入れていません)。

## コマンド

`pio` コマンドが無い環境では、`uv` 経由で実行します。

```sh
uv tool run --from platformio==6.1.19 --with pip pio run              # ビルド
uv tool run --from platformio==6.1.19 --with pip pio run -t upload    # 書き込み
uv tool run --from platformio==6.1.19 --with pip pio device monitor -b 115200
cd web && python3 -m http.server 8000                                  # サイト (Chrome で http://localhost:8000)
sh tools/host-test/run.sh                                              # サンプルと制限のテスト
node tools/browser-test/test.js                                        # サイトの通しテスト (playwright が必要)
sh tools/make-firmware.sh                                              # 配布用の書き込みファイル
npx wrangler@4 deploy                                                  # サイトの公開
```

## 守ること

- 書き込みの前に、本体をダウンロードモードにしてもらう(電源ボタンを約 2 秒長押しして緑の LED を点ける)。物理操作と Web Bluetooth のデバイス選択はユーザーに頼む。
- シリアルポートを開いている他のプロセスを止めるときは、先にユーザーに確認する。
- ミニアプリの API を変えるときは、本体側 `src/app_runtime.cpp` とプレビュー側 `web/index.html` の `previewShim` を両方直し、`tools/browser-test/test.js` を通す。
- `lib/quickjs/` は上流のファイルを無改変で置いている。手を入れず、ESP32 用の補助は `esp32_port.c` に書く。
- 実機で確かめたことと、まだ確かめていないことを区別して `README.md` に書く。
- ファームウェアを変えたら `tools/make-firmware.sh` で配布用ファイルを作り直してから公開する。サイトの公開と GitHub への push は、ユーザーに確認してから行う。
