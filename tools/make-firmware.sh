#!/bin/sh
# 配布用の書き込みファイルを作る: sh tools/make-firmware.sh  →  web/firmware/m5-stopwatch-face.bin
# ブートローダー・パーティション表・アプリを 1 つにまとめ、0x0 から書けるようにする。
# アプリ領域の後ろ (NVS 以外の設定や LittleFS のファイル) には触れない。
set -e
cd "$(dirname "$0")/.."
PIO="${PIO:-uv tool run --from platformio==6.1.19 --with pip pio}"
B=.pio/build/m5stack-stopwatch
P="${PLATFORMIO_CORE_DIR:-$HOME/.platformio}/packages"
$PIO run
mkdir -p web/firmware
uv tool run --from esptool==4.8.1 esptool.py --chip esp32s3 merge_bin -o web/firmware/m5-stopwatch-face.bin \
  0x0 $B/bootloader.bin 0x8000 $B/partitions.bin \
  0xe000 "$P/framework-arduinoespressif32/tools/partitions/boot_app0.bin" 0x10000 $B/firmware.bin
shasum -a 256 web/firmware/m5-stopwatch-face.bin | cut -d' ' -f1 > web/firmware/m5-stopwatch-face.bin.sha256
ls -l web/firmware
