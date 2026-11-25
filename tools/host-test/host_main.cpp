// PC 上でミニアプリ実行環境 (src/app_runtime.cpp + QuickJS) を動かすテスト用プログラム。
// 描画などの呼び出しを 1 行ずつ標準出力に書き出すので、サイトのプレビューと突き合わせられる。
//
//   host_test app.js [手順] [--quiet]
//     手順: カンマ区切り。f=1フレーム  A / B=ボタン  T:x:y=タッチ  w:ミリ秒=待つ  r=終了して再起動
//           省略時は "f"
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <fstream>
#include <sstream>

#include "../../src/app_runtime.h"

static bool quiet = false;
static const char* ALIGN[] = {"left", "center", "right"};
static const char* FONT[]  = {"gothic", "digit"};

class TraceHost : public AppHost {
 public:
  std::string stored;
  void out(const char* fmt, ...) __attribute__((format(printf, 2, 3))) {
    if (quiet) return;
    va_list ap;
    va_start(ap, fmt);
    vprintf(fmt, ap);
    va_end(ap);
    putchar('\n');
  }
  void clear(uint32_t c) override { out("clear #%06x", c); }
  void face() override { out("face"); }
  void fillRect(int x, int y, int w, int h, uint32_t c) override { out("fillRect %d %d %d %d #%06x", x, y, w, h, c); }
  void rect(int x, int y, int w, int h, uint32_t c) override { out("rect %d %d %d %d #%06x", x, y, w, h, c); }
  void fillRoundRect(int x, int y, int w, int h, int r, uint32_t c) override { out("fillRoundRect %d %d %d %d %d #%06x", x, y, w, h, r, c); }
  void fillCircle(int x, int y, int r, uint32_t c) override { out("fillCircle %d %d %d #%06x", x, y, r, c); }
  void circle(int x, int y, int r, uint32_t c) override { out("circle %d %d %d #%06x", x, y, r, c); }
  void line(int x0, int y0, int x1, int y1, uint32_t c, int w) override { out("line %d %d %d %d #%06x %d", x0, y0, x1, y1, c, w); }
  void arc(int x, int y, int ro, int ri, int s, int e, uint32_t c) override { out("arc %d %d %d %d %d %d #%06x", x, y, ro, ri, s, e, c); }
  void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint32_t c) override {
    out("fillTriangle %d %d %d %d %d %d #%06x", x0, y0, x1, y1, x2, y2, c);
  }
  void text(const char* s, int x, int y, int base, int scale, AppAlign a, AppFont f, uint32_t c, bool outline, uint32_t oc) override {
    if (outline) out("text \"%s\" %d %d %d %s %s #%06x outline=#%06x", s, x, y, base * scale, ALIGN[a], FONT[f], c, oc);
    else out("text \"%s\" %d %d %d %s %s #%06x", s, x, y, base * scale, ALIGN[a], FONT[f], c);
  }
  int textWidth(const char* s, int base, int scale, AppFont f) override {
    out("textWidth \"%s\" %d %s", s, base * scale, FONT[f]);
    return 100;
  }
  void vibrate(int ms) override { out("vibrate %d", ms); }
  void tone(int freq, int ms) override { out("tone %d %d", freq, ms); }
  void sound() override { out("sound"); }
  void accel(float a[3]) override { a[0] = 0.25f, a[1] = -0.5f, a[2] = 0.75f; }
  int  battery() override { return 77; }
  bool storeLoad(std::string& json) override {
    json = stored;
    return !stored.empty();
  }
  bool storeSave(const std::string& json) override {
    out("storeSave %s", json.c_str());
    stored = json;
    return true;
  }
  void print(const char* line) override { out("print %s", line); }
  uint32_t millis() override {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (uint32_t)(ts.tv_sec * 1000 + ts.tv_nsec / 1000000);
  }
};

int main(int argc, char** argv) {
  if (argc < 2) return fprintf(stderr, "usage: host_test app.js [steps] [--quiet]\n"), 2;
  std::string steps = "f";
  for (int i = 2; i < argc; i++) {
    if (!strcmp(argv[i], "--quiet")) quiet = true;
    else steps = argv[i];
  }
  std::ifstream     in(argv[1], std::ios::binary);
  std::stringstream ss;
  ss << in.rdbuf();
  std::string code = ss.str();

  TraceHost  host;
  AppTheme   theme;
  AppRuntime app(host);
  bool       ok = app.start(code.data(), code.size(), theme);
  std::stringstream st(steps);
  std::string       step;
  while (ok && std::getline(st, step, ',')) {
    if (step == "f") ok = app.frame();
    else if (step == "A" || step == "B") ok = app.button(step.c_str());
    else if (step[0] == 'T') {
      int x = 0, y = 0;
      sscanf(step.c_str(), "T:%d:%d", &x, &y);
      ok = app.touch(x, y);
    } else if (step[0] == 'w') {
      struct timespec ts = {atoi(step.c_str() + 2) / 1000, (atoi(step.c_str() + 2) % 1000) * 1000000L};
      nanosleep(&ts, nullptr);
    } else if (step == "r") {
      app.stop();
      ok = app.start(code.data(), code.size(), theme);
    }
    if (ok && app.exitRequested()) break;
  }
  if (!ok) {
    printf("ERROR %s\n", app.error().c_str());
    return 1;
  }
  printf("END fps=%d exit=%d mem=%zukB\n", app.fps(), app.exitRequested() ? 1 : 0, app.memoryUsed() / 1024);
  app.stop();
  return 0;
}
