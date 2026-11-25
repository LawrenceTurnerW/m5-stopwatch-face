// ミニアプリから見える「本体」の窓口。
// AppRuntime (JS エンジン側) はこのインターフェースだけを通して画面・音・保存に触る。
// 実機では main.cpp が M5Unified で実装し、PC 上のテストでは呼び出しを記録する実装に差し替える。
#pragma once
#include <stddef.h>
#include <stdint.h>
#include <string>

// テーマカラー (0xRRGGBB)。アプリからは theme.bg などで参照する。
struct AppTheme {
  uint32_t bg      = 0x101216;  // 背景
  uint32_t surface = 0x1A1D24;  // ボタンやカードの面
  uint32_t fg      = 0xE8EAF0;  // 文字
  uint32_t muted   = 0x9AA1B0;  // 控えめな文字・目盛り
  uint32_t accent  = 0x5CC8FF;  // 強調
  uint32_t accent2 = 0xFFA500;  // 第 2 の強調 (秒針・警告)
};

enum AppAlign { ALIGN_LEFT = 0, ALIGN_CENTER = 1, ALIGN_RIGHT = 2 };
enum AppFont { FONT_GOTHIC = 0, FONT_DIGIT = 1 };

// 指定サイズを実際に使えるフォントサイズに丸める (サイト側のプレビューと同じ規則)。
//   gothic: 12〜40px の 4px 刻み。それより大きい指定は整数倍に拡大する
//   digit : 高さ 75px の数字専用フォントとその整数倍
inline void appFontFor(int size, AppFont font, int& base, int& scale) {
  if (font == FONT_DIGIT) {
    base  = 75;
    scale = (size + 37) / 75;
    if (scale < 1) scale = 1;
    return;
  }
  scale = (size + 39) / 40;
  if (scale < 1) scale = 1;
  base = ((size / scale + 2) / 4) * 4;
  if (base < 12) base = 12;
  if (base > 40) base = 40;
}

// 電源の状態。アプリには watch.power() の文字列 ("unknown" / "battery" / "charging" / "usb") で渡す。
// USB は「つながっているが充電はしていない」(満充電など)。
enum AppPower { POWER_UNKNOWN = 0, POWER_BATTERY, POWER_CHARGING, POWER_USB };

class AppHost {
 public:
  virtual ~AppHost() {}

  // ---- 描画 (座標は整数に丸め済み、色は 0xRRGGBB) ----
  virtual void clear(uint32_t color) = 0;
  virtual void face() = 0;  // テーマの文字盤画像。なければ背景色で塗る
  virtual void fillRect(int x, int y, int w, int h, uint32_t color) = 0;
  virtual void rect(int x, int y, int w, int h, uint32_t color) = 0;
  virtual void fillRoundRect(int x, int y, int w, int h, int r, uint32_t color) = 0;
  virtual void fillCircle(int x, int y, int r, uint32_t color) = 0;
  virtual void circle(int x, int y, int r, uint32_t color) = 0;
  virtual void line(int x0, int y0, int x1, int y1, uint32_t color, int width) = 0;
  // 角度は 12 時の方向が 0 度で時計回り。start < end で、end - start は 360 以下
  virtual void arc(int x, int y, int rOuter, int rInner, int start, int end, uint32_t color) = 0;
  virtual void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint32_t color) = 0;
  // (x, y) は align で決まる横位置と、文字の上下中央。outline が true なら outlineColor で縁取りする
  virtual void text(const char* s, int x, int y, int base, int scale, AppAlign align, AppFont font, uint32_t color,
                    bool outline, uint32_t outlineColor) = 0;
  virtual int  textWidth(const char* s, int base, int scale, AppFont font) = 0;

  // ---- 本体 ----
  virtual void vibrate(int ms) = 0;
  virtual void tone(int freq, int ms) = 0;
  virtual void sound() = 0;              // テーマの効果音
  virtual void accel(float xyz[3]) = 0;  // 加速度 (G)
  virtual int  battery() = 0;            // 0〜100
  virtual AppPower power() = 0;          // 電池で動いているか、充電中か
  virtual bool storeLoad(std::string& json) = 0;
  virtual bool storeSave(const std::string& json) = 0;
  virtual void print(const char* line) = 0;
  virtual uint32_t millis() = 0;
};
