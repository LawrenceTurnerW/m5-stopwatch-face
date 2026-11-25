#include "app_runtime.h"

#include <math.h>
#include <stdlib.h>
#include <string.h>

extern "C" {
#include "quickjs.h"
}

#ifdef ESP_PLATFORM
#include <esp_heap_caps.h>
// JS のヒープは PSRAM に置く (内蔵 RAM は BLE などに残しておく)
static const uint32_t kCaps = MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT;
static void*  portCalloc(void*, size_t n, size_t size) { return heap_caps_calloc(n, size, kCaps); }
static void*  portMalloc(void*, size_t size) { return heap_caps_malloc(size, kCaps); }
static void   portFree(void*, void* p) { heap_caps_free(p); }
static void*  portRealloc(void*, void* p, size_t size) { return heap_caps_realloc(p, size, kCaps); }
static size_t portUsable(const void* p) { return heap_caps_get_allocated_size((void*)p); }
#else
#ifdef __APPLE__
#include <malloc/malloc.h>
#define malloc_usable_size malloc_size
#else
#include <malloc.h>
#endif
static void*  portCalloc(void*, size_t n, size_t size) { return calloc(n, size); }
static void*  portMalloc(void*, size_t size) { return malloc(size); }
static void   portFree(void*, void* p) { free(p); }
static void*  portRealloc(void*, void* p, size_t size) { return realloc(p, size); }
static size_t portUsable(const void* p) { return malloc_usable_size((void*)p); }
#endif
static const JSMallocFunctions kMalloc = {portCalloc, portMalloc, portFree, portRealloc, portUsable};

enum { FN_SETUP = 0, FN_DRAW, FN_BUTTON, FN_TOUCH, FN_COUNT };
static const char* const kFnNames[FN_COUNT] = {"setup", "draw", "onButton", "onTouch"};
static const int   kScreen = 466;

static AppRuntime* self(JSContext* ctx) { return (AppRuntime*)JS_GetContextOpaque(ctx); }

// ---- 引数の変換 (サイト側のプレビューと同じ規則にそろえる) -------------------------

// 数値を整数に丸める。Math.round と同じく .5 は正の方向へ。
static bool toInt(JSContext* ctx, JSValueConst v, int& out) {
  double d;
  if (JS_ToFloat64(ctx, &d, v)) return false;
  if (!(d == d)) d = 0;  // NaN
  if (d > 32767) d = 32767;
  if (d < -32768) d = -32768;
  out = (int)floor(d + 0.5);
  return true;
}

static bool argInt(JSContext* ctx, int argc, JSValueConst* argv, int i, int def, int& out) {
  if (i >= argc || JS_IsUndefined(argv[i])) {
    out = def;
    return true;
  }
  return toInt(ctx, argv[i], out);
}

static int clampInt(int v, int lo, int hi) { return v < lo ? lo : v > hi ? hi : v; }

static int hexDigit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

// 色: 0xRRGGBB の数値、"#rrggbb"、"#rgb"。省略時は def。
static bool toColor(JSContext* ctx, JSValueConst v, uint32_t def, uint32_t& out) {
  if (JS_IsUndefined(v) || JS_IsNull(v)) {
    out = def;
    return true;
  }
  if (JS_IsString(v)) {
    size_t      len;
    const char* s  = JS_ToCStringLen(ctx, &len, v);
    bool        ok = false;
    if (s && s[0] == '#' && (len == 7 || len == 4)) {
      uint32_t c = 0;
      ok = true;
      for (size_t i = 1; i < len; i++) {
        int h = hexDigit(s[i]);
        if (h < 0) ok = false;
        c = (c << 4) | (uint32_t)(h & 15);
        if (len == 4) c = (c << 4) | (uint32_t)(h & 15);
      }
      out = c;
    }
    JS_FreeCString(ctx, s);
    if (!ok) JS_ThrowTypeError(ctx, "色は 0xRRGGBB の数値か \"#rrggbb\" で指定してください");
    return ok;
  }
  double d;
  if (JS_ToFloat64(ctx, &d, v)) return false;
  if (!(d >= 0 && d <= 0xFFFFFF)) d = 0;
  out = (uint32_t)d;
  return true;
}

static bool argColor(JSContext* ctx, int argc, JSValueConst* argv, int i, uint32_t def, uint32_t& out) {
  if (i >= argc) {
    out = def;
    return true;
  }
  return toColor(ctx, argv[i], def, out);
}

// 引数 n 個をまとめて整数にする
static bool ints(JSContext* ctx, int argc, JSValueConst* argv, int n, int* out) {
  for (int i = 0; i < n; i++)
    if (!argInt(ctx, argc, argv, i, 0, out[i])) return false;
  return true;
}

// ---- g: 描画 ------------------------------------------------------------------
#define API(name) \
  static JSValue name(JSContext* ctx, JSValueConst, int argc __attribute__((unused)), JSValueConst* argv __attribute__((unused)))

API(g_clear) {
  uint32_t c;
  if (!argColor(ctx, argc, argv, 0, self(ctx)->theme_.bg, c)) return JS_EXCEPTION;
  self(ctx)->host().clear(c);
  return JS_UNDEFINED;
}

API(g_face) {
  self(ctx)->host().face();
  return JS_UNDEFINED;
}

API(g_fillRect) {
  int      a[4];
  uint32_t c;
  if (!ints(ctx, argc, argv, 4, a) || !argColor(ctx, argc, argv, 4, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  self(ctx)->host().fillRect(a[0], a[1], a[2], a[3], c);
  return JS_UNDEFINED;
}

API(g_rect) {
  int      a[4];
  uint32_t c;
  if (!ints(ctx, argc, argv, 4, a) || !argColor(ctx, argc, argv, 4, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  self(ctx)->host().rect(a[0], a[1], a[2], a[3], c);
  return JS_UNDEFINED;
}

API(g_fillRoundRect) {
  int      a[5];
  uint32_t c;
  if (!ints(ctx, argc, argv, 5, a) || !argColor(ctx, argc, argv, 5, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  self(ctx)->host().fillRoundRect(a[0], a[1], a[2], a[3], a[4] < 0 ? 0 : a[4], c);
  return JS_UNDEFINED;
}

API(g_fillCircle) {
  int      a[3];
  uint32_t c;
  if (!ints(ctx, argc, argv, 3, a) || !argColor(ctx, argc, argv, 3, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  if (a[2] >= 0) self(ctx)->host().fillCircle(a[0], a[1], a[2], c);
  return JS_UNDEFINED;
}

API(g_circle) {
  int      a[3];
  uint32_t c;
  if (!ints(ctx, argc, argv, 3, a) || !argColor(ctx, argc, argv, 3, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  if (a[2] >= 0) self(ctx)->host().circle(a[0], a[1], a[2], c);
  return JS_UNDEFINED;
}

API(g_line) {
  int      a[4], w;
  uint32_t c;
  if (!ints(ctx, argc, argv, 4, a) || !argColor(ctx, argc, argv, 4, self(ctx)->theme_.fg, c) ||
      !argInt(ctx, argc, argv, 5, 1, w))
    return JS_EXCEPTION;
  self(ctx)->host().line(a[0], a[1], a[2], a[3], c, clampInt(w, 1, 40));
  return JS_UNDEFINED;
}

API(g_arc) {
  int      a[6];
  uint32_t c;
  if (!ints(ctx, argc, argv, 6, a) || !argColor(ctx, argc, argv, 6, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  int rOuter = a[2] > a[3] ? a[2] : a[3], rInner = a[2] > a[3] ? a[3] : a[2];
  int start = a[4], end = a[5];
  if (rInner < 0 || end <= start) return JS_UNDEFINED;  // 進み 0 のときは何も描かない
  if (end - start >= 360) {
    start = 0;
    end   = 360;
  }
  self(ctx)->host().arc(a[0], a[1], rOuter, rInner, start, end, c);
  return JS_UNDEFINED;
}

API(g_fillTriangle) {
  int      a[6];
  uint32_t c;
  if (!ints(ctx, argc, argv, 6, a) || !argColor(ctx, argc, argv, 6, self(ctx)->theme_.fg, c)) return JS_EXCEPTION;
  self(ctx)->host().fillTriangle(a[0], a[1], a[2], a[3], a[4], a[5], c);
  return JS_UNDEFINED;
}

struct TextOpts {
  int      base, scale;
  AppAlign align;
  AppFont  font;
  uint32_t color;
  bool     outline;
  uint32_t outlineColor;
};

// { size, color, align, font, outline } を読む。省略したものは既定値。
static bool textOpts(JSContext* ctx, int argc, JSValueConst* argv, int i, TextOpts& o) {
  int size = 24;
  o.align  = ALIGN_CENTER;
  o.font   = FONT_GOTHIC;
  o.color  = self(ctx)->theme_.fg;
  o.outline = false;
  o.outlineColor = 0;
  if (i < argc && JS_IsObject(argv[i])) {
    JSValue v  = JS_GetPropertyStr(ctx, argv[i], "size");
    bool    ok = !JS_IsException(v) && (JS_IsUndefined(v) || toInt(ctx, v, size));
    JS_FreeValue(ctx, v);
    if (!ok) return false;

    v  = JS_GetPropertyStr(ctx, argv[i], "color");
    ok = !JS_IsException(v) && toColor(ctx, v, o.color, o.color);
    JS_FreeValue(ctx, v);
    if (!ok) return false;

    v         = JS_GetPropertyStr(ctx, argv[i], "outline");
    o.outline = !JS_IsUndefined(v) && !JS_IsNull(v);
    ok        = !JS_IsException(v) && toColor(ctx, v, 0, o.outlineColor);
    JS_FreeValue(ctx, v);
    if (!ok) return false;

    for (int k = 0; k < 2; k++) {
      v = JS_GetPropertyStr(ctx, argv[i], k ? "font" : "align");
      if (JS_IsException(v)) return false;
      if (JS_IsString(v)) {
        const char* s = JS_ToCString(ctx, v);
        if (s && k == 0) o.align = !strcmp(s, "left") ? ALIGN_LEFT : !strcmp(s, "right") ? ALIGN_RIGHT : ALIGN_CENTER;
        if (s && k == 1) o.font = !strcmp(s, "digit") ? FONT_DIGIT : FONT_GOTHIC;
        JS_FreeCString(ctx, s);
      }
      JS_FreeValue(ctx, v);
    }
  }
  appFontFor(clampInt(size, 8, 240), o.font, o.base, o.scale);
  return true;
}

// 200 バイト以内 (UTF-8 の文字の切れ目) に切り詰める
static void truncateText(std::string& s) {
  if (s.size() <= 200) return;
  size_t len = 200;
  while (len > 0 && ((unsigned char)s[len] & 0xC0) == 0x80) len--;
  s.resize(len);
}

// 文字列に変換する。長すぎるものは切り詰める
static std::string toText(JSContext* ctx, JSValueConst v) {
  size_t      len = 0;
  const char* s   = JS_ToCStringLen(ctx, &len, v);
  if (!s) return std::string();
  std::string out(s, len);
  JS_FreeCString(ctx, s);
  truncateText(out);
  return out;
}

API(g_text) {
  int      x, y;
  TextOpts o;
  if (argc < 1) return JS_UNDEFINED;
  std::string s = toText(ctx, argv[0]);
  if (JS_HasException(ctx)) return JS_EXCEPTION;
  if (!argInt(ctx, argc, argv, 1, 0, x) || !argInt(ctx, argc, argv, 2, 0, y) || !textOpts(ctx, argc, argv, 3, o))
    return JS_EXCEPTION;
  self(ctx)->host().text(s.c_str(), x, y, o.base, o.scale, o.align, o.font, o.color, o.outline, o.outlineColor);
  return JS_UNDEFINED;
}

API(g_textWidth) {
  TextOpts o;
  if (argc < 1) return JS_NewInt32(ctx, 0);
  std::string s = toText(ctx, argv[0]);
  if (JS_HasException(ctx) || !textOpts(ctx, argc, argv, 1, o)) return JS_EXCEPTION;
  return JS_NewInt32(ctx, self(ctx)->host().textWidth(s.c_str(), o.base, o.scale, o.font));
}

// ---- watch: 本体 ----------------------------------------------------------------
API(w_vibrate) {
  int ms;
  if (!argInt(ctx, argc, argv, 0, 100, ms)) return JS_EXCEPTION;
  self(ctx)->host().vibrate(clampInt(ms, 0, 1000));
  return JS_UNDEFINED;
}

API(w_tone) {
  int freq, ms;
  if (!argInt(ctx, argc, argv, 0, 880, freq) || !argInt(ctx, argc, argv, 1, 100, ms)) return JS_EXCEPTION;
  self(ctx)->host().tone(clampInt(freq, 50, 8000), clampInt(ms, 1, 2000));
  return JS_UNDEFINED;
}

API(w_sound) {
  self(ctx)->host().sound();
  return JS_UNDEFINED;
}

API(w_accel) {
  float a[3] = {0, 0, 0};
  self(ctx)->host().accel(a);
  JSValue o = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, o, "x", JS_NewFloat64(ctx, a[0]));
  JS_SetPropertyStr(ctx, o, "y", JS_NewFloat64(ctx, a[1]));
  JS_SetPropertyStr(ctx, o, "z", JS_NewFloat64(ctx, a[2]));
  return o;
}

API(w_battery) { return JS_NewInt32(ctx, clampInt(self(ctx)->host().battery(), 0, 100)); }

API(w_power) {
  static const char* const NAME[] = {"unknown", "battery", "charging", "usb"};
  return JS_NewString(ctx, NAME[clampInt((int)self(ctx)->host().power(), 0, 3)]);
}

API(w_frameRate) {
  int fps;
  if (!argInt(ctx, argc, argv, 0, 10, fps)) return JS_EXCEPTION;
  self(ctx)->fps_ = clampInt(fps, 1, 30);
  return JS_UNDEFINED;
}

API(w_exit) {
  self(ctx)->exitRequested_ = true;
  return JS_UNDEFINED;
}

// ---- store: アプリごとの小さな保存領域 ---------------------------------------------
API(s_load) {
  AppRuntime* rt = self(ctx);
  if (!rt->storeLoaded_) {
    rt->storeLoaded_ = true;
    if (!rt->host().storeLoad(rt->storeJson_)) rt->storeJson_.clear();
  }
  if (rt->storeJson_.empty()) return JS_NULL;
  JSValue v = JS_ParseJSON(ctx, rt->storeJson_.c_str(), rt->storeJson_.size(), "<store>");
  if (JS_IsException(v)) {  // 壊れたデータは無かったことにする
    JS_FreeValue(ctx, JS_GetException(ctx));
    return JS_NULL;
  }
  return v;
}

API(s_save) {
  AppRuntime* rt = self(ctx);
  if (argc < 1) return JS_UNDEFINED;
  JSValue j = JS_JSONStringify(ctx, argv[0], JS_UNDEFINED, JS_UNDEFINED);
  if (JS_IsException(j)) return JS_EXCEPTION;
  if (!JS_IsString(j)) {  // undefined や関数など、JSON にできない値
    JS_FreeValue(ctx, j);
    return JS_ThrowTypeError(ctx, "store.save() には JSON にできる値を渡してください");
  }
  size_t      len;
  const char* s = JS_ToCStringLen(ctx, &len, j);
  JS_FreeValue(ctx, j);
  if (!s) return JS_EXCEPTION;
  if (len > AppRuntime::kMaxStore) {
    JS_FreeCString(ctx, s);
    return JS_ThrowRangeError(ctx, "store.save() で保存できるのは %d バイトまでです", (int)AppRuntime::kMaxStore);
  }
  if (!rt->storeLoaded_ || rt->storeJson_.compare(0, std::string::npos, s, len) != 0) {
    rt->storeJson_.assign(s, len);
    rt->storeDirty_ = true;  // フラッシュを傷めないよう、書き込みは間隔を空けてまとめて行う
  }
  rt->storeLoaded_ = true;
  JS_FreeCString(ctx, s);
  return JS_UNDEFINED;
}

API(js_print) {
  AppRuntime* rt = self(ctx);
  if (rt->prints_++ >= AppRuntime::kMaxPrints) return JS_UNDEFINED;
  std::string line;
  for (int i = 0; i < argc; i++) {
    if (i) line += ' ';
    line += toText(ctx, argv[i]);
    if (JS_HasException(ctx)) return JS_EXCEPTION;
  }
  truncateText(line);
  rt->host().print(line.c_str());
  return JS_UNDEFINED;
}

// ---- AppRuntime ---------------------------------------------------------------
static void def(JSContext* ctx, JSValueConst obj, const char* name, JSCFunction* fn, int nargs) {
  JS_SetPropertyStr(ctx, obj, name, JS_NewCFunction(ctx, fn, name, nargs));
}

static int onInterrupt(JSContext*, void* opaque) {
  AppRuntime* rt = (AppRuntime*)opaque;
  if ((int32_t)(rt->host().millis() - rt->deadline_) < 0) return 0;
  rt->timedOut_ = true;
  return 1;  // 実行を打ち切る (アプリ側の try/catch では捕まえられない)
}

AppRuntime::AppRuntime(AppHost& host) : host_(host) {}
AppRuntime::~AppRuntime() { stop(); }

void AppRuntime::installApi() {
  JSValue global = JS_GetGlobalObject(ctx_);

  JSValue g = JS_NewObject(ctx_);
  JS_SetPropertyStr(ctx_, g, "width", JS_NewInt32(ctx_, kScreen));
  JS_SetPropertyStr(ctx_, g, "height", JS_NewInt32(ctx_, kScreen));
  def(ctx_, g, "clear", g_clear, 1);
  def(ctx_, g, "face", g_face, 0);
  def(ctx_, g, "fillRect", g_fillRect, 5);
  def(ctx_, g, "rect", g_rect, 5);
  def(ctx_, g, "fillRoundRect", g_fillRoundRect, 6);
  def(ctx_, g, "fillCircle", g_fillCircle, 4);
  def(ctx_, g, "circle", g_circle, 4);
  def(ctx_, g, "line", g_line, 6);
  def(ctx_, g, "arc", g_arc, 7);
  def(ctx_, g, "fillTriangle", g_fillTriangle, 7);
  def(ctx_, g, "text", g_text, 4);
  def(ctx_, g, "textWidth", g_textWidth, 2);
  JS_SetPropertyStr(ctx_, global, "g", g);

  JSValue w = JS_NewObject(ctx_);
  def(ctx_, w, "vibrate", w_vibrate, 1);
  def(ctx_, w, "tone", w_tone, 2);
  def(ctx_, w, "sound", w_sound, 0);
  def(ctx_, w, "accel", w_accel, 0);
  def(ctx_, w, "battery", w_battery, 0);
  def(ctx_, w, "power", w_power, 0);
  def(ctx_, w, "frameRate", w_frameRate, 1);
  def(ctx_, w, "exit", w_exit, 0);
  JS_SetPropertyStr(ctx_, global, "watch", w);

  JSValue s = JS_NewObject(ctx_);
  def(ctx_, s, "load", s_load, 0);
  def(ctx_, s, "save", s_save, 1);
  JS_SetPropertyStr(ctx_, global, "store", s);

  def(ctx_, global, "print", js_print, 1);
  JSValue console = JS_NewObject(ctx_);  // console.log でも print と同じところに出す
  def(ctx_, console, "log", js_print, 1);
  def(ctx_, console, "warn", js_print, 1);
  def(ctx_, console, "error", js_print, 1);
  JS_SetPropertyStr(ctx_, global, "console", console);
  JS_SetPropertyStr(ctx_, global, "theme", JS_NewObject(ctx_));
  JS_FreeValue(ctx_, global);
  setTheme(theme_);
}

void AppRuntime::setTheme(const AppTheme& theme) {
  theme_ = theme;
  if (!ctx_) return;
  JSValue global = JS_GetGlobalObject(ctx_);
  JSValue t      = JS_GetPropertyStr(ctx_, global, "theme");
  if (JS_IsObject(t)) {
    JS_SetPropertyStr(ctx_, t, "bg", JS_NewInt32(ctx_, (int32_t)theme.bg));
    JS_SetPropertyStr(ctx_, t, "surface", JS_NewInt32(ctx_, (int32_t)theme.surface));
    JS_SetPropertyStr(ctx_, t, "fg", JS_NewInt32(ctx_, (int32_t)theme.fg));
    JS_SetPropertyStr(ctx_, t, "muted", JS_NewInt32(ctx_, (int32_t)theme.muted));
    JS_SetPropertyStr(ctx_, t, "accent", JS_NewInt32(ctx_, (int32_t)theme.accent));
    JS_SetPropertyStr(ctx_, t, "accent2", JS_NewInt32(ctx_, (int32_t)theme.accent2));
  }
  JS_FreeValue(ctx_, t);
  JS_FreeValue(ctx_, global);
}

bool AppRuntime::start(const char* code, size_t len, const AppTheme& theme) {
  stop();
  error_.clear();
  theme_         = theme;
  fps_           = 10;
  exitRequested_ = false;
  storeDirty_ = storeLoaded_ = false;
  storeJson_.clear();
  lastStoreWrite_ = host_.millis();

  if (len > kMaxSource) {
    error_ = "スクリプトが大きすぎます (上限 64kB)";
    return false;
  }
  rt_ = JS_NewRuntime2(&kMalloc, nullptr);
  if (!rt_) {
    error_ = "メモリを確保できませんでした";
    return false;
  }
  JS_SetMemoryLimit(rt_, kMemoryLimit);
  JS_SetMaxStackSize(rt_, kStackLimit);
  JS_SetInterruptHandler(rt_, onInterrupt, this);
  ctx_ = JS_NewContext(rt_);
  if (!ctx_) {
    JS_FreeRuntime(rt_);
    rt_    = nullptr;
    error_ = "メモリを確保できませんでした";
    return false;
  }
  JS_SetContextOpaque(ctx_, this);
  JSValue* fns = (JSValue*)malloc(sizeof(JSValue) * FN_COUNT);
  for (int i = 0; i < FN_COUNT; i++) fns[i] = JS_UNDEFINED;
  fns_ = fns;
  installApi();

  // 読み込み。スクリプトの末尾に NUL が要るのでコピーして渡す。
  std::string src(code, len);
  prints_   = 0;
  timedOut_ = false;
  deadline_ = host_.millis() + kLoadBudgetMs;
  JS_UpdateStackTop(rt_);
  JSValue r = JS_Eval(ctx_, src.c_str(), src.size(), "app.js", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(r)) return fail("読み込み");
  JS_FreeValue(ctx_, r);

  // function draw() {} でも const draw = () => {} でも見つかるよう、式として取り出す
  for (int i = 0; i < FN_COUNT; i++) {
    std::string expr = std::string("typeof ") + kFnNames[i] + " === 'function' ? " + kFnNames[i] + " : undefined";
    JSValue     f    = JS_Eval(ctx_, expr.c_str(), expr.size(), "<lookup>", JS_EVAL_TYPE_GLOBAL);
    if (JS_IsException(f)) return fail("読み込み");
    fns[i] = f;
  }
  if (!JS_IsFunction(ctx_, fns[FN_DRAW])) {
    error_ = "draw() がありません";
    stop();
    return false;
  }
  return call(FN_SETUP, 0, nullptr, kLoadBudgetMs, "setup()");
}

// 例外からエラーメッセージを作り、アプリを止める
bool AppRuntime::fail(const char* what) {
  static const char* const kOutOfMemory = "メモリが足りません (上限 1MB)";
  std::string msg;
  JS_SetMemoryLimit(rt_, kMemoryLimit + 64 * 1024);  // エラーの文面を作るぶんの余裕を足す
  JSValue e = JS_GetException(ctx_);
  if (timedOut_) {
    msg = std::string(what) + " が制限時間を超えたので止めました";
  } else if (JS_IsNull(e) || JS_IsUndefined(e)) {
    msg = kOutOfMemory;  // メモリが尽きるとエラーオブジェクト自体を作れず、例外が空になる
  } else {
    const char* s = JS_ToCString(ctx_, e);
    msg           = s ? s : kOutOfMemory;
    JS_FreeCString(ctx_, s);
    if (msg.find("out of memory") != std::string::npos) {
      msg = kOutOfMemory;
    } else if (JS_IsObject(e)) {  // スタックの最初の app.js:行 を添える
      JSValue st = JS_GetPropertyStr(ctx_, e, "stack");
      if (JS_IsString(st)) {
        const char* t = JS_ToCString(ctx_, st);
        const char* p = t ? strstr(t, "app.js:") : nullptr;
        if (p) msg += " (" + std::to_string(atoi(p + 7)) + " 行目)";
        JS_FreeCString(ctx_, t);
      }
      JS_FreeValue(ctx_, st);
    }
  }
  JS_FreeValue(ctx_, e);
  stop();
  error_ = msg;
  return false;
}

bool AppRuntime::call(int fnIndex, int argc, void* argv, int budgetMs, const char* what) {
  if (!ctx_) return false;
  JSValue* fns  = (JSValue*)fns_;
  JSValue* args = (JSValue*)argv;  // 引数の所有権はここで引き取る
  if (!JS_IsFunction(ctx_, fns[fnIndex])) {
    for (int i = 0; i < argc; i++) JS_FreeValue(ctx_, args[i]);
  } else {
    prints_   = 0;
    timedOut_ = false;
    deadline_ = host_.millis() + budgetMs;
    JS_UpdateStackTop(rt_);
    JSValue r = JS_Call(ctx_, fns[fnIndex], JS_UNDEFINED, argc, args);
    for (int i = 0; i < argc; i++) JS_FreeValue(ctx_, args[i]);
    if (JS_IsException(r)) return fail(what);
    JS_FreeValue(ctx_, r);
    // Promise の続き (async 関数など) もこの呼び出しの持ち時間の中で実行する
    JSContext* c;
    int        n;
    while ((n = JS_ExecutePendingJob(rt_, &c)) > 0) {}
    if (n < 0) return fail(what);
  }
  flushStore(false);
  return true;
}

bool AppRuntime::frame() { return call(FN_DRAW, 0, nullptr, kFrameBudgetMs, "draw()"); }

bool AppRuntime::button(const char* name) {
  if (!ctx_) return false;
  JSValue arg = JS_NewString(ctx_, name);
  return call(FN_BUTTON, 1, &arg, kFrameBudgetMs, "onButton()");
}

bool AppRuntime::touch(int x, int y) {
  if (!ctx_) return false;
  JSValue args[2] = {JS_NewInt32(ctx_, x), JS_NewInt32(ctx_, y)};
  return call(FN_TOUCH, 2, args, kFrameBudgetMs, "onTouch()");
}

void AppRuntime::flushStore(bool force) {
  if (!storeDirty_) return;
  if (!force && host_.millis() - lastStoreWrite_ < 2000) return;
  host_.storeSave(storeJson_);
  storeDirty_     = false;
  lastStoreWrite_ = host_.millis();
}

size_t AppRuntime::memoryUsed() const {
  if (!rt_) return 0;
  JSMemoryUsage u;
  JS_ComputeMemoryUsage(rt_, &u);
  return (size_t)u.malloc_size;
}

void AppRuntime::stop() {
  flushStore(true);
  if (ctx_) {
    JSValue* fns = (JSValue*)fns_;
    for (int i = 0; fns && i < FN_COUNT; i++) JS_FreeValue(ctx_, fns[i]);
    JS_FreeContext(ctx_);
    ctx_ = nullptr;
  }
  free(fns_);
  fns_ = nullptr;
  if (rt_) {
    JS_FreeRuntime(rt_);
    rt_ = nullptr;
  }
}
