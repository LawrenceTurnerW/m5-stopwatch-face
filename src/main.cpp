// M5 StopWatch 着せ替え時計
//
// ブラウザ(Web Bluetooth)から、テーマ(色・文字盤画像・効果音)とミニアプリ(JavaScript)を
// 受け取って使う時計。全体の構成と API は README.md を参照。
//
// ---- BLE プロトコル ----------------------------------------------------------
// Service 6b1d0001-9c4f-4f0e-a3b7-5a7e2c40d1e9
//   CTRL   ...0002  write            コマンド(下記)
//   DATA   ...0003  write / writeNR  ファイル本体。BEGIN のあと先頭から順に流し込む
//   STATUS ...0004  read / notify    [state u8][err u8][mtu u16][received u32]  (LE)
//   APPS   ...0005  read             入っているアプリの一覧 (JSON: [{"s":番号,"n":"名前","z":サイズ}])
//   LOG    ...0006  notify           アプリの print() 出力とエラー (UTF-8 の 1 行)
//
// コマンド (CTRL, すべてリトルエンディアン)
//   0x01 BEGIN     [kind u8][slot u8][size u32][crc32 u32][window u8]
//                  kind: 1=文字盤(JPEG 466x466, ベースライン) 2=効果音 3=アプリ(slot 0〜7)
//                  window: 何チャンクごとに STATUS を通知するか(フロー制御用)
//   0x03 ABORT
//   0x10 SET_TIME  [epoch秒 u32 (UTC)][UTCからの時差(分) i16]
//   0x11 PLAY      効果音を鳴らす
//   0x12 BUZZ      振動させる
//   0x13 CLEAR     [kind u8][slot u8]  保存済みファイルを消す
//   0x14 SET_THEME [RGB x 6]  bg, surface, fg, muted, accent, accent2 の順
//   0x20 RUN       [slot u8]  アプリを起動する
//   0x21 HOME      時計に戻る
//
// 受信完了(received == size)で CRC32 を照合し、保存できたら state=SAVED を通知する。
// 効果音ファイル形式: "SWP1" + サンプルレート u32 + 16bit 符号付きモノラル PCM
//
// ---- 本体の操作 ----------------------------------------------------------------
//   時計      : A / タップ = 効果音   B = アプリ一覧
//   アプリ一覧: A = 次へ   B / タップ = 起動
//   アプリ中  : A・B・タップはアプリへ渡す
//   どこでも  : A と B を同時に長押し = 時計に戻る (アプリ側からは止められない)
// ---------------------------------------------------------------------------

#include <M5Unified.h>
#include <LittleFS.h>
#include <NimBLEDevice.h>
#include <Preferences.h>
#include <atomic>
#include <string>
#include <sys/time.h>

#include "app_runtime.h"

// ミニアプリ(JS エンジン)は loop() のタスクで動くので、スタックを広げておく
SET_LOOP_TASK_STACK_SIZE(48 * 1024);

static const char* DEVICE_NAME = "M5StopWatch";
#define SVC_UUID    "6b1d0001-9c4f-4f0e-a3b7-5a7e2c40d1e9"
#define CTRL_UUID   "6b1d0002-9c4f-4f0e-a3b7-5a7e2c40d1e9"
#define DATA_UUID   "6b1d0003-9c4f-4f0e-a3b7-5a7e2c40d1e9"
#define STATUS_UUID "6b1d0004-9c4f-4f0e-a3b7-5a7e2c40d1e9"
#define APPS_UUID   "6b1d0005-9c4f-4f0e-a3b7-5a7e2c40d1e9"
#define LOG_UUID    "6b1d0006-9c4f-4f0e-a3b7-5a7e2c40d1e9"

enum : uint8_t {
  CMD_BEGIN = 0x01, CMD_ABORT = 0x03, CMD_SET_TIME = 0x10, CMD_PLAY = 0x11, CMD_BUZZ = 0x12,
  CMD_CLEAR = 0x13, CMD_SET_THEME = 0x14, CMD_RUN = 0x20, CMD_HOME = 0x21,
};
enum : uint8_t { ST_IDLE = 0, ST_RECEIVING = 1, ST_SAVED = 2, ST_ERROR = 3 };
enum : uint8_t {
  ERR_NONE = 0, ERR_TOO_LARGE = 1, ERR_NO_MEMORY = 2, ERR_CRC = 3, ERR_OVERFLOW = 4,
  ERR_FS = 5, ERR_BAD_REQUEST = 6, ERR_DECODE = 7, ERR_BUSY = 8,
};
enum : uint8_t { KIND_FACE = 1, KIND_SOUND = 2, KIND_APP = 3 };

static const char*    FACE_PATH  = "/face.jpg";
static const char*    SOUND_PATH = "/sound.pcm";
static const uint32_t MAX_FACE   = 512 * 1024;
static const uint32_t MAX_SOUND  = 1024 * 1024;
static const int      APP_SLOTS  = 8;

// ---- 受信状態 (BLE ホストタスクが書き、loop() が読む) ----------------------------
struct Transfer {
  uint8_t* buf      = nullptr;
  uint32_t size     = 0;
  uint32_t received = 0;
  uint32_t crc      = 0;
  uint8_t  kind     = 0;
  uint8_t  slot     = 0;
  uint8_t  window   = 16;
  uint8_t  chunks   = 0;
};
static Transfer             rx;
static std::atomic<uint8_t> rxState{ST_IDLE};
static std::atomic<bool>    commitPending{false};  // true の間 rx.buf は loop() のもの

// BLE から届いた要求。実際の処理は loop() で行う
static std::atomic<bool>     reqPlay{false}, reqBuzz{false}, reqSetTime{false}, reqTheme{false}, reqHome{false};
static std::atomic<uint16_t> reqClear{0};  // 消すものの集まり: bit0 = 文字盤、bit1 = 効果音、bit(2+n) = アプリ置き場 n
static std::atomic<int>      reqRun{-1};
static std::atomic<uint32_t> pendingEpoch{0};
static std::atomic<int16_t>  pendingTz{0};
static uint8_t               pendingTheme[18];

static std::atomic<bool>     bleConnected{false};
static std::atomic<uint16_t> bleMtu{23};

static NimBLECharacteristic* statusChr = nullptr;
static NimBLECharacteristic* appsChr   = nullptr;
static NimBLECharacteristic* logChr    = nullptr;
static SemaphoreHandle_t     bleLock   = nullptr;

// ---- 表示・音・テーマ ------------------------------------------------------------
static M5Canvas bg(&M5.Display);     // デコード済みの文字盤画像
static M5Canvas frame(&M5.Display);  // 1 フレーム分の合成先
static int      W = 466, H = 466;
static bool     hasFace = false;
static AppTheme theme;

static uint8_t* soundBuf = nullptr;
static size_t   soundLen = 0;
static uint32_t soundRate = 16000;

static Preferences prefs;
static int16_t     tzOffsetMin = 540;  // 既定は JST
static uint32_t    buzzUntil = 0;

// ---- 画面の状態 -----------------------------------------------------------------
enum Mode { MODE_HOME, MODE_LIST, MODE_SETTINGS, MODE_APP, MODE_MESSAGE };
static Mode        mode = MODE_HOME;
static bool        redraw = true;
static int         listIndex = 0;
static uint32_t    modeSince = 0;
static std::string message;

// ---- 設定 (アプリ一覧の先頭の「設定」で変える。NVS に保存) ---------------------------
static const uint8_t BRIGHT_LEVEL[] = {0, 40, 100, 160, 210, 255};  // 明るさ 1〜5
static const uint8_t VOLUME_LEVEL[] = {0, 40, 80, 120, 160, 255};   // 音量 0 (消音)〜5
static uint8_t       brightLevel = 3, volumeLevel = 4;
static bool          vibrateOn   = true;
static void applySettings() {
  M5.Display.setBrightness(BRIGHT_LEVEL[brightLevel]);
  M5.Speaker.setVolume(VOLUME_LEVEL[volumeLevel]);
}

struct AppEntry {
  bool        used = false;
  std::string name;
  uint32_t    size = 0;
};
static AppEntry apps[APP_SLOTS];
static int      appSlot = -1;

static inline uint32_t le32(const uint8_t* p) { return p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24); }
static inline uint16_t le16(const uint8_t* p) { return p[0] | (p[1] << 8); }
static inline uint16_t rgb(uint32_t c) { return lgfx::color565((c >> 16) & 255, (c >> 8) & 255, c & 255); }

// zlib と同じ CRC32 (ブラウザ側と同じ計算)
static uint32_t crc32(const uint8_t* p, size_t n) {
  uint32_t c = 0xFFFFFFFF;
  while (n--) {
    c ^= *p++;
    for (int k = 0; k < 8; k++) c = (c >> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c;
}

static void notifyStatus(uint8_t state, uint8_t err, uint32_t received) {
  if (!statusChr) return;
  uint16_t mtu = bleMtu;
  uint8_t p[8] = {state, err, (uint8_t)mtu, (uint8_t)(mtu >> 8),
                  (uint8_t)received, (uint8_t)(received >> 8), (uint8_t)(received >> 16), (uint8_t)(received >> 24)};
  xSemaphoreTake(bleLock, portMAX_DELAY);
  statusChr->setValue(p, sizeof(p));
  if (bleConnected) statusChr->notify();
  xSemaphoreGive(bleLock);
}

// サイトのコンソールに 1 行送る (loop() から呼ぶ)
static void bleLog(const std::string& line) {
  Serial.println(line.c_str());
  if (!logChr || !bleConnected) return;
  size_t max = bleMtu > 23 ? bleMtu - 3 : 20;
  size_t len = line.size() < max ? line.size() : max;
  while (len > 0 && len < line.size() && ((uint8_t)line[len] & 0xC0) == 0x80) len--;  // 文字の途中で切らない
  xSemaphoreTake(bleLock, portMAX_DELAY);
  logChr->setValue((const uint8_t*)line.data(), len);
  logChr->notify();
  xSemaphoreGive(bleLock);
}

static void freeRx() {
  free(rx.buf);
  rx = Transfer();
}

// 電源の状態と電池残量。I2C で読むので、2 秒に 1 回だけ読み直す。
static AppPower powerState   = POWER_UNKNOWN;
static int      batteryLevel = -1;  // -1 はまだ読んでいない
static void readPower(bool force = false) {
  static uint32_t readAt = 0;
  uint32_t        now    = millis();
  if (!force && batteryLevel >= 0 && now - readAt < 2000) return;
  readAt       = now;
  batteryLevel = constrain((int)M5.Power.getBatteryLevel(), 0, 100);
  m5::M5PM1_Class::pwr_src_t source;
  if (!M5.Power.M5pm1.getPowerSource(&source)) {
    powerState = POWER_UNKNOWN;
  } else if (!(source & (m5::M5PM1_Class::vin | m5::M5PM1_Class::vinout))) {
    powerState = POWER_BATTERY;
  } else {
    powerState = M5.Power.getChargeState() == m5::charge_state_t::charging ? POWER_CHARGING : POWER_USB;
  }
}

static void buzz(uint32_t ms) {
  if (ms == 0 || !vibrateOn) return;
  M5.Power.setVibration(200);
  buzzUntil = millis() + ms;
}

static void applyTimezone() {
  // POSIX の TZ は符号が逆 (UTC+9 は "UTC-9:00")。JS の Date がローカル時刻を返すようになる
  char tz[24];
  int  m = tzOffsetMin;
  snprintf(tz, sizeof(tz), "UTC%c%d:%02d", m >= 0 ? '-' : '+', abs(m) / 60, abs(m) % 60);
  setenv("TZ", tz, 1);
  tzset();
}

// ---- ファイル ------------------------------------------------------------------
static uint8_t* readFile(const char* path, size_t& len) {
  if (!LittleFS.exists(path)) return nullptr;
  File f = LittleFS.open(path, "r");
  if (!f) return nullptr;
  len = f.size();
  uint8_t* p = (uint8_t*)ps_malloc(len ? len : 1);
  if (p && f.read(p, len) != len) {
    free(p);
    p = nullptr;
  }
  f.close();
  return p;
}

static bool writeFile(const char* path, const uint8_t* data, size_t len) {
  File f = LittleFS.open(path, "w");
  if (!f) return false;
  size_t done = 0;
  while (done < len) {
    size_t n = min((size_t)4096, len - done);
    if (f.write(data + done, n) != n) break;
    done += n;
  }
  f.close();
  if (done != len) LittleFS.remove(path);
  return done == len;
}

static std::string appPath(int slot) { return "/apps/" + std::to_string(slot) + ".js"; }
static std::string dataPath(int slot) { return "/data/" + std::to_string(slot) + ".json"; }

// ---- 文字盤・効果音・テーマの適用 ---------------------------------------------------
static bool applyFace(const uint8_t* jpg, size_t len) {
  bg.fillScreen(TFT_BLACK);
  hasFace = bg.drawJpg(jpg, len, 0, 0);
  return hasFace;
}

static bool validSound(const uint8_t* buf, size_t len) {
  if (len < 10 || memcmp(buf, "SWP1", 4) != 0) return false;
  uint32_t rate = le32(buf + 4);
  return rate >= 4000 && rate <= 48000;
}

static void stopSound() {
  M5.Speaker.stop();
  for (int i = 0; i < 50 && M5.Speaker.isPlaying(); i++) delay(2);
  delay(20);  // 再生タスクがバッファを読み終えるのを待つ
}

// buf の所有権を受け取る(再生中に参照し続けるので解放しない)
static void adoptSound(uint8_t* buf, size_t len) {
  stopSound();
  free(soundBuf);
  soundBuf  = buf;
  soundLen  = len;
  soundRate = buf ? le32(buf + 4) : 16000;
}

static void playSound() {
  if (soundBuf) {
    M5.Speaker.playRaw((const int16_t*)(soundBuf + 8), (soundLen - 8) / 2, soundRate, false, 1, 0, true);
  } else {
    M5.Speaker.tone(1760, 80, 0, true);
  }
}

static void loadTheme() {
  uint8_t b[18];
  if (prefs.getBytesLength("theme") != sizeof(b) || prefs.getBytes("theme", b, sizeof(b)) != sizeof(b)) return;
  uint32_t* c[6] = {&theme.bg, &theme.surface, &theme.fg, &theme.muted, &theme.accent, &theme.accent2};
  for (int i = 0; i < 6; i++) *c[i] = (b[i * 3] << 16) | (b[i * 3 + 1] << 8) | b[i * 3 + 2];
}

static void loadSavedFiles() {
  size_t   len = 0;
  uint8_t* p   = readFile(FACE_PATH, len);
  if (p) {
    applyFace(p, len);
    free(p);
  }
  p = readFile(SOUND_PATH, len);
  if (p) {
    if (validSound(p, len)) adoptSound(p, len);
    else free(p);
  }
}

// ---- アプリの一覧 ----------------------------------------------------------------
// 先頭のコメント「// @name なまえ」からアプリ名を取り出す
static std::string parseAppName(const uint8_t* code, size_t len) {
  std::string head((const char*)code, len < 600 ? len : 600);
  size_t      p = head.find("@name");
  if (p == std::string::npos) return "";
  p += 5;
  size_t      end = head.find_first_of("\r\n", p);
  std::string raw = head.substr(p, end == std::string::npos ? std::string::npos : end - p);
  std::string name;
  for (char ch : raw) {
    if ((uint8_t)ch < 0x20 || ch == '"' || ch == '\\') continue;  // JSON を壊す文字は捨てる
    if (name.empty() && ch == ' ') continue;
    name += ch;
  }
  while (!name.empty() && name.back() == ' ') name.pop_back();
  size_t n = name.size() < 24 ? name.size() : 24;
  while (n > 0 && n < name.size() && ((uint8_t)name[n] & 0xC0) == 0x80) n--;
  name.resize(n);
  return name;
}

static void publishApps() {
  std::string json = "[";
  for (int i = 0; i < APP_SLOTS; i++) {
    if (!apps[i].used) continue;
    if (json.size() > 1) json += ',';
    json += "{\"s\":" + std::to_string(i) + ",\"n\":\"" + apps[i].name + "\",\"z\":" + std::to_string(apps[i].size) + "}";
  }
  json += "]";
  if (appsChr) appsChr->setValue((const uint8_t*)json.data(), json.size());
}

static void scanApp(int slot) {
  AppEntry&   e    = apps[slot];
  std::string path = appPath(slot);
  e                = AppEntry();
  if (!LittleFS.exists(path.c_str())) return;
  File f = LittleFS.open(path.c_str(), "r");
  if (!f) return;
  uint8_t head[600];
  size_t  n = f.read(head, sizeof(head));
  e.used    = true;
  e.size    = f.size();
  e.name    = parseAppName(head, n);
  if (e.name.empty()) e.name = "アプリ " + std::to_string(slot + 1);
  f.close();
}

static void scanApps() {
  for (const char* dir : {"/apps", "/data"})
    if (!LittleFS.exists(dir)) LittleFS.mkdir(dir);
  for (int i = 0; i < APP_SLOTS; i++) scanApp(i);
  publishApps();
}

static int appCount() {
  int n = 0;
  for (auto& a : apps) n += a.used;
  return n;
}

// ---- ミニアプリから見える本体 (AppHost の実装) --------------------------------------
class DeviceHost : public AppHost {
 public:
  void clear(uint32_t c) override { frame.fillScreen(rgb(c)); }
  void face() override {
    if (hasFace) bg.pushSprite(&frame, 0, 0);
    else frame.fillScreen(rgb(theme.bg));
  }
  void fillRect(int x, int y, int w, int h, uint32_t c) override { frame.fillRect(x, y, w, h, rgb(c)); }
  void rect(int x, int y, int w, int h, uint32_t c) override { frame.drawRect(x, y, w, h, rgb(c)); }
  void fillRoundRect(int x, int y, int w, int h, int r, uint32_t c) override { frame.fillRoundRect(x, y, w, h, r, rgb(c)); }
  void fillCircle(int x, int y, int r, uint32_t c) override { frame.fillCircle(x, y, r, rgb(c)); }
  void circle(int x, int y, int r, uint32_t c) override { frame.drawCircle(x, y, r, rgb(c)); }
  void line(int x0, int y0, int x1, int y1, uint32_t c, int width) override {
    if (width <= 1) frame.drawLine(x0, y0, x1, y1, rgb(c));
    else frame.drawWideLine(x0, y0, x1, y1, width / 2.0f, rgb(c));
  }
  void arc(int x, int y, int rOuter, int rInner, int start, int end, uint32_t c) override {
    // LovyanGFX は 3 時の方向が 0 度なので、12 時始まりに直す
    frame.fillArc(x, y, rOuter, rInner, (float)(start - 90), (float)(end - 90), rgb(c));
  }
  void fillTriangle(int x0, int y0, int x1, int y1, int x2, int y2, uint32_t c) override {
    frame.fillTriangle(x0, y0, x1, y1, x2, y2, rgb(c));
  }
  void text(const char* s, int x, int y, int base, int scale, AppAlign align, AppFont font, uint32_t c, bool outline,
            uint32_t outlineColor) override {
    selectFont(base, scale, font);
    frame.setTextDatum(align == ALIGN_LEFT ? middle_left : align == ALIGN_RIGHT ? middle_right : middle_center);
    if (outline) {
      int d = 2 * scale;
      frame.setTextColor(rgb(outlineColor));
      for (int dy = -d; dy <= d; dy += d)
        for (int dx = -d; dx <= d; dx += d)
          if (dx || dy) frame.drawString(s, x + dx, y + dy);
    }
    frame.setTextColor(rgb(c));
    frame.drawString(s, x, y);
    frame.setTextSize(1);
  }
  int textWidth(const char* s, int base, int scale, AppFont font) override {
    selectFont(base, scale, font);
    int w = frame.textWidth(s);
    frame.setTextSize(1);
    return w;
  }

  void vibrate(int ms) override { buzz(ms); }
  void tone(int freq, int ms) override { M5.Speaker.tone(freq, ms, 1, true); }
  void sound() override { playSound(); }
  void accel(float a[3]) override {
    // センサーは画面に対して 90 度回って付いている (実機で確認)。画面の向きに直して渡す:
    // x は右 (3 時側) を下げると正、y は上 (12 時側) を下げると正。
    float x = 0, y = 0, z = 0;
    if (M5.Imu.isEnabled()) M5.Imu.getAccel(&x, &y, &z);
    a[0] = -y, a[1] = x, a[2] = z;
  }
  int battery() override {
    readPower();
    return batteryLevel;
  }
  AppPower power() override {
    readPower();
    return powerState;
  }
  bool storeLoad(std::string& json) override {
    size_t   len = 0;
    uint8_t* p   = appSlot >= 0 ? readFile(dataPath(appSlot).c_str(), len) : nullptr;
    if (!p) return false;
    json.assign((const char*)p, len);
    free(p);
    return true;
  }
  bool storeSave(const std::string& json) override {
    return appSlot >= 0 && writeFile(dataPath(appSlot).c_str(), (const uint8_t*)json.data(), json.size());
  }
  void print(const char* line) override { bleLog(line); }
  uint32_t millis() override { return ::millis(); }

 private:
  void selectFont(int base, int scale, AppFont font) {
    static const lgfx::IFont* const GOTHIC[] = {
        &fonts::lgfxJapanGothic_12, &fonts::lgfxJapanGothic_16, &fonts::lgfxJapanGothic_20, &fonts::lgfxJapanGothic_24,
        &fonts::lgfxJapanGothic_28, &fonts::lgfxJapanGothic_32, &fonts::lgfxJapanGothic_36, &fonts::lgfxJapanGothic_40};
    if (font == FONT_DIGIT) frame.setFont(&fonts::Font8);
    else frame.setFont(GOTHIC[constrain((base - 12) / 4, 0, 7)]);
    frame.setTextSize(scale);
  }
};

static DeviceHost deviceHost;
static AppRuntime app(deviceHost);

// ---- 画面の切り替え ---------------------------------------------------------------
static void setMode(Mode m) {
  mode      = m;
  modeSince = millis();
  redraw    = true;
}

static void goHome() {
  if (app.running()) {
    app.stop();
    bleLog("> 終了");
  }
  appSlot = -1;
  setMode(MODE_HOME);
}

static void showMessage(const std::string& text) {
  if (app.running()) app.stop();
  appSlot = -1;
  message = text;
  setMode(MODE_MESSAGE);
}

static void appFailed() {
  bleLog("! " + app.error());
  buzz(120);
  showMessage(app.error());
}

static void launchApp(int slot) {
  if (slot < 0 || slot >= APP_SLOTS || !apps[slot].used) return showMessage("アプリが入っていません");
  if (app.running()) app.stop();
  size_t   len  = 0;
  uint8_t* code = readFile(appPath(slot).c_str(), len);
  if (!code) return showMessage("アプリを読み込めませんでした");
  appSlot = slot;
  frame.fillScreen(rgb(theme.bg));
  bleLog("> 起動: " + apps[slot].name);
  bool ok = app.start((const char*)code, len, theme);
  free(code);
  if (!ok) return appFailed();
  setMode(MODE_APP);
}

// 受信し終えたバッファを検証して保存する (loop() から呼ぶ)
static void commitTransfer() {
  uint8_t  err  = ERR_NONE;
  uint32_t size = rx.size;
  uint8_t  kind = rx.kind, slot = rx.slot;
  bool     keep = false;

  if (crc32(rx.buf, size) != rx.crc) {
    err = ERR_CRC;
  } else if (kind == KIND_FACE) {
    if (!applyFace(rx.buf, size)) {
      err = ERR_DECODE;
      size_t   len = 0;  // 元の画像に戻す
      uint8_t* old = readFile(FACE_PATH, len);
      if (old) {
        applyFace(old, len);
        free(old);
      }
    } else if (!writeFile(FACE_PATH, rx.buf, size)) {
      err = ERR_FS;
    }
  } else if (kind == KIND_SOUND) {
    if (!validSound(rx.buf, size)) err = ERR_DECODE;
    else if (!writeFile(SOUND_PATH, rx.buf, size)) err = ERR_FS;
    else {
      adoptSound(rx.buf, size);
      keep = true;
    }
  } else {
    if (mode == MODE_APP && appSlot == slot) goHome();  // 動かしているアプリを入れ替えるときは先に止める
    if (!writeFile(appPath(slot).c_str(), rx.buf, size)) err = ERR_FS;
    LittleFS.remove(dataPath(slot).c_str());  // 別のアプリの保存データを引き継がない
    scanApp(slot);
    publishApps();
  }

  if (keep) rx.buf = nullptr;
  freeRx();
  rxState = err ? ST_ERROR : ST_SAVED;
  commitPending = false;
  notifyStatus(rxState, err, size);

  if (!err) {
    buzz(150);
    if (kind == KIND_SOUND) playSound();
  }
}

// ---- BLE ---------------------------------------------------------------------
class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* server, NimBLEConnInfo& info) override {
    bleMtu = info.getMTU();
    bleConnected = true;
    // 転送を速くするため、短い接続間隔と長いパケットを要求する(採否は相手次第)
    server->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);
    server->setDataLen(info.getConnHandle(), 251);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    bleConnected = false;
    if (rxState == ST_RECEIVING && !commitPending) {
      freeRx();
      rxState = ST_IDLE;
    }
    NimBLEDevice::startAdvertising();
  }
  void onMTUChange(uint16_t mtu, NimBLEConnInfo&) override { bleMtu = mtu; }
};

class CtrlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo& info) override {
    NimBLEAttValue v = chr->getValue();
    const uint8_t* d = v.data();
    size_t         n = v.length();
    if (n == 0) return;
    bleMtu = info.getMTU();

    switch (d[0]) {
      case CMD_BEGIN: {
        if (commitPending) return notifyStatus(ST_ERROR, ERR_BUSY, 0);
        freeRx();
        rxState = ST_IDLE;
        if (n < 11) return notifyStatus(ST_ERROR, ERR_BAD_REQUEST, 0);
        uint8_t  kind  = d[1], slot = d[2];
        uint32_t size  = le32(d + 3);
        uint32_t limit = kind == KIND_FACE ? MAX_FACE : kind == KIND_SOUND ? MAX_SOUND : kind == KIND_APP ? AppRuntime::kMaxSource : 0;
        if (limit == 0 || (kind == KIND_APP && slot >= APP_SLOTS)) return notifyStatus(ST_ERROR, ERR_BAD_REQUEST, 0);
        if (size == 0 || size > limit) return notifyStatus(ST_ERROR, ERR_TOO_LARGE, 0);
        uint8_t* buf = (uint8_t*)ps_malloc(size);
        if (!buf) return notifyStatus(ST_ERROR, ERR_NO_MEMORY, 0);
        rx.buf    = buf;
        rx.size   = size;
        rx.crc    = le32(d + 7);
        rx.kind   = kind;
        rx.slot   = slot;
        rx.window = (n >= 12 && d[11]) ? d[11] : 16;
        rxState   = ST_RECEIVING;
        notifyStatus(ST_RECEIVING, ERR_NONE, 0);
        break;
      }
      case CMD_ABORT:
        if (!commitPending) {
          freeRx();
          rxState = ST_IDLE;
          notifyStatus(ST_IDLE, ERR_NONE, 0);
        }
        break;
      case CMD_SET_TIME:
        if (n >= 7) {
          pendingEpoch = le32(d + 1);
          pendingTz    = (int16_t)le16(d + 5);
          reqSetTime   = true;
        }
        break;
      case CMD_PLAY:
        reqPlay = true;
        break;
      case CMD_BUZZ:
        reqBuzz = true;
        break;
      case CMD_CLEAR:
        // 続けて届いても取りこぼさないよう、上書きせずに足していく (サイトは文字盤と効果音を続けて消すことがある)
        if (n >= 2 && d[1] == KIND_FACE) reqClear.fetch_or(1);
        else if (n >= 2 && d[1] == KIND_SOUND) reqClear.fetch_or(2);
        else if (n >= 3 && d[1] == KIND_APP && d[2] < APP_SLOTS) reqClear.fetch_or((uint16_t)(4u << d[2]));
        break;
      case CMD_SET_THEME:
        if (n >= 19 && !reqTheme) {
          memcpy(pendingTheme, d + 1, sizeof(pendingTheme));
          reqTheme = true;
        }
        break;
      case CMD_RUN:
        if (n >= 2) reqRun = d[1];
        break;
      case CMD_HOME:
        reqHome = true;
        break;
    }
  }
};

class DataCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
    if (rxState != ST_RECEIVING || commitPending || !rx.buf) return;
    NimBLEAttValue v = chr->getValue();
    size_t         n = v.length();
    if (rx.received + n > rx.size) {
      uint32_t got = rx.received;
      freeRx();
      rxState = ST_ERROR;
      return notifyStatus(ST_ERROR, ERR_OVERFLOW, got);
    }
    memcpy(rx.buf + rx.received, v.data(), n);
    rx.received += n;
    if (rx.received == rx.size) {
      notifyStatus(ST_RECEIVING, ERR_NONE, rx.received);
      commitPending = true;  // 検証と保存は loop() で行う
    } else if (++rx.chunks >= rx.window) {
      rx.chunks = 0;
      notifyStatus(ST_RECEIVING, ERR_NONE, rx.received);
    }
  }
};

static void setupBle() {
  bleLock = xSemaphoreCreateMutex();
  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setMTU(517);
  NimBLEDevice::setPower(9);

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  NimBLEService* svc = server->createService(SVC_UUID);
  svc->createCharacteristic(CTRL_UUID, NIMBLE_PROPERTY::WRITE)->setCallbacks(new CtrlCallbacks());
  svc->createCharacteristic(DATA_UUID, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR)->setCallbacks(new DataCallbacks());
  statusChr = svc->createCharacteristic(STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  appsChr   = svc->createCharacteristic(APPS_UUID, NIMBLE_PROPERTY::READ);
  logChr    = svc->createCharacteristic(LOG_UUID, NIMBLE_PROPERTY::NOTIFY);
  uint8_t zero[8] = {0};
  statusChr->setValue(zero, sizeof(zero));
  publishApps();
  svc->start();

  // 128bit UUID を広告本体に、名前はスキャン応答に載せる(31 バイトに収めるため)
  NimBLEAdvertisementData advData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.setCompleteServices(NimBLEUUID(SVC_UUID));
  NimBLEAdvertisementData scanData;
  scanData.setName(DEVICE_NAME);

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->start();
}

// ---- 描画 ---------------------------------------------------------------------
static void outlinedText(const char* s, int x, int y) {
  frame.setTextColor(rgb(theme.bg));
  for (int dy = -2; dy <= 2; dy += 2)
    for (int dx = -2; dx <= 2; dx += 2)
      if (dx || dy) frame.drawString(s, x + dx, y + dy);
  frame.setTextColor(rgb(theme.fg));
  frame.drawString(s, x, y);
}

// 電池の残量と充電の状態を、(cx, y) を中心に 1 行で描く
static void drawPower(int cx, int y) {
  readPower();
  bool        bolt   = powerState == POWER_CHARGING;
  const char* suffix = bolt ? " 充電中" : powerState == POWER_USB ? " USB" : "";
  char        text[32];
  snprintf(text, sizeof(text), "%d%%%s", batteryLevel, suffix);
  frame.setFont(&fonts::lgfxJapanGothic_24);
  const int iconW = 40, boltW = bolt ? 18 : 0;
  int       total = boltW + iconW + 8 + frame.textWidth(text), x = cx - total / 2;
  frame.fillRoundRect(x - 12, y - 18, total + 24, 36, 18, rgb(theme.bg));  // 文字盤画像の上でも読めるように下地を敷く
  if (bolt) {  // 稲妻の印
    frame.fillTriangle(x + 9, y - 12, x + 1, y + 2, x + 8, y + 2, rgb(theme.accent2));
    frame.fillTriangle(x + 5, y + 12, x + 13, y - 2, x + 6, y - 2, rgb(theme.accent2));
    x += boltW;
  }
  frame.drawRoundRect(x, y - 9, 34, 18, 4, rgb(theme.muted));
  frame.fillRect(x + 35, y - 4, 3, 8, rgb(theme.muted));
  frame.fillRect(x + 3, y - 6, 28 * batteryLevel / 100, 12, rgb(batteryLevel <= 20 && !bolt ? theme.accent2 : theme.accent));
  frame.setTextDatum(middle_left);
  frame.setTextColor(rgb(theme.fg));
  frame.drawString(text, x + iconW + 8, y);
  frame.setTextDatum(middle_center);
}

static void drawClock(bool force) {
  static time_t lastDrawn = 0;
  static int    lastHour  = -1;
  time_t        now       = time(nullptr) + tzOffsetMin * 60;
  if (!force && now == lastDrawn) return;
  lastDrawn = now;

  struct tm t;
  gmtime_r(&now, &t);
  const int   cx = W / 2, cy = H / 2;
  const float DEG = 0.01745329f;

  if (hasFace) {
    bg.pushSprite(&frame, 0, 0);
  } else {
    frame.fillScreen(rgb(theme.bg));
    for (int i = 0; i < 60; i++) {  // 文字盤画像がないとき: 目盛りだけ
      float a  = i * 6 * DEG;
      int   r0 = (i % 5 == 0) ? cx - 26 : cx - 14;
      frame.drawLine(cx + sinf(a) * r0, cy - cosf(a) * r0, cx + sinf(a) * (cx - 6), cy - cosf(a) * (cx - 6),
                     rgb((i % 5 == 0) ? theme.fg : theme.muted));
    }
  }

  // 秒: 外周を回る点
  float a  = t.tm_sec * 6 * DEG;
  int   sx = cx + sinf(a) * (cx - 16), sy = cy - cosf(a) * (cx - 16);
  frame.fillCircle(sx, sy, 9, rgb(theme.bg));
  frame.fillCircle(sx, sy, 6, rgb(theme.accent2));

  char buf[32];
  frame.setTextDatum(middle_center);
  frame.setFont(&fonts::Font8);
  snprintf(buf, sizeof(buf), "%02d:%02d", t.tm_hour, t.tm_min);
  outlinedText(buf, cx, cy - 10);

  static const char* WD[] = {"日", "月", "火", "水", "木", "金", "土"};
  frame.setFont(&fonts::lgfxJapanGothic_28);
  snprintf(buf, sizeof(buf), "%d/%d (%s)", t.tm_mon + 1, t.tm_mday, WD[t.tm_wday]);
  outlinedText(buf, cx, cy + 70);

  drawPower(cx, cy - 96);

  if (bleConnected) {  // 接続中の印
    frame.fillCircle(cx, H - 60, 8, rgb(theme.bg));
    frame.fillCircle(cx, H - 60, 5, rgb(theme.accent));
  }
  frame.pushSprite(0, 0);

  // 時報: 毎正時に効果音と振動
  if (lastHour >= 0 && t.tm_hour != lastHour && t.tm_min == 0) {
    playSound();
    buzz(300);
  }
  lastHour = t.tm_hour;
}

static const int LIST_ROW = 58, LIST_TOP = 120, LIST_ROWS = 5;

// 一覧に並べる順 (使用中のスロットだけ) で n 番目のスロット番号を返す
static int listSlot(int n) {
  for (int i = 0; i < APP_SLOTS; i++)
    if (apps[i].used && n-- == 0) return i;
  return -1;
}

// 一覧の 0 番目は「設定」で、そのあとにアプリが並ぶ
static int         listCount() { return appCount() + 1; }
static const char* listName(int i) { return i == 0 ? "設定" : apps[listSlot(i - 1)].name.c_str(); }

static void drawList() {
  int count = listCount();
  frame.fillScreen(rgb(theme.bg));
  frame.setTextDatum(middle_center);
  frame.setFont(&fonts::lgfxJapanGothic_24);
  frame.setTextColor(rgb(theme.muted));
  frame.drawString("アプリ", W / 2, 70);
  if (listIndex >= count) listIndex = 0;
  int first = constrain(listIndex - LIST_ROWS / 2, 0, max(0, count - LIST_ROWS));
  frame.setFont(&fonts::lgfxJapanGothic_28);
  for (int row = 0; row < LIST_ROWS && first + row < count; row++) {
    int  y   = LIST_TOP + row * LIST_ROW;
    bool sel = first + row == listIndex;
    if (sel) frame.fillRoundRect(70, y, W - 140, LIST_ROW - 8, 14, rgb(theme.accent));
    frame.setTextColor(rgb(sel ? theme.bg : first + row == 0 ? theme.muted : theme.fg));
    frame.drawString(listName(first + row), W / 2, y + (LIST_ROW - 8) / 2);
  }
  frame.setFont(&fonts::lgfxJapanGothic_20);
  frame.setTextColor(rgb(theme.muted));
  if (count == 1) frame.drawString("アプリはサイトから送れます", W / 2, H / 2 + 30);
  frame.drawString("A 次へ   B 決定", W / 2, H - 50);
  frame.pushSprite(0, 0);
}

// ---- 設定画面: 明るさ・音量は左半分のタップで下げ、右半分で上げる。振動は行のタップで切り替え ----
static const int SET_Y[3] = {150, 233, 316}, SET_MINUS = 95, SET_PLUS = 371, SET_HALF = 40;

static void drawStepRow(int y, const char* label, int level) {
  frame.setFont(&fonts::lgfxJapanGothic_20);
  frame.setTextColor(rgb(theme.muted));
  frame.drawString(label, W / 2, y - 26);
  for (int x : {SET_MINUS, SET_PLUS}) {
    frame.fillCircle(x, y, 32, rgb(theme.surface));
    frame.fillRect(x - 12, y - 2, 24, 5, rgb(theme.fg));
    if (x == SET_PLUS) frame.fillRect(x - 2, y - 12, 5, 24, rgb(theme.fg));
  }
  for (int i = 0; i < 5; i++)  // 5 段の目盛り
    frame.fillRoundRect(150 + i * 34, y - 2, 28, 20, 5, rgb(i < level ? theme.accent : theme.surface));
}

static void drawSettings() {
  frame.fillScreen(rgb(theme.bg));
  frame.setTextDatum(middle_center);
  frame.setFont(&fonts::lgfxJapanGothic_24);
  frame.setTextColor(rgb(theme.muted));
  frame.drawString("設定", W / 2, 70);
  drawStepRow(SET_Y[0], "明るさ", brightLevel);
  drawStepRow(SET_Y[1], volumeLevel ? "音量" : "音量 (消音)", volumeLevel);
  frame.fillRoundRect(120, SET_Y[2] - 30, W - 240, 60, 30, rgb(vibrateOn ? theme.accent : theme.surface));
  frame.setFont(&fonts::lgfxJapanGothic_24);
  frame.setTextColor(rgb(vibrateOn ? theme.bg : theme.muted));
  frame.drawString(vibrateOn ? "振動 ON" : "振動 OFF", W / 2, SET_Y[2]);
  frame.setFont(&fonts::lgfxJapanGothic_20);
  frame.setTextColor(rgb(theme.muted));
  frame.drawString("タッチで変更   B 戻る", W / 2, H - 50);
  frame.pushSprite(0, 0);
}

static void settingsTap(int x, int y) {
  int row = -1;
  for (int i = 0; i < 3; i++)
    if (abs(y - SET_Y[i]) <= SET_HALF) row = i;
  if (row < 0) return;
  int step = x < W / 2 ? -1 : 1;
  if (row == 0) {
    brightLevel = constrain(brightLevel + step, 1, 5);
    prefs.putUChar("bright", brightLevel);
  } else if (row == 1) {
    volumeLevel = constrain(volumeLevel + step, 0, 5);
    prefs.putUChar("volume", volumeLevel);
  } else {
    vibrateOn = !vibrateOn;
    prefs.putBool("vibrate", vibrateOn);
  }
  applySettings();
  if (row == 1) M5.Speaker.tone(1760, 80, 0, true);  // 変えた音量で鳴らして確かめられるようにする
  if (row == 2) buzz(80);
}

// 画面幅に合わせて折り返しながら文章を描く
static void drawWrapped(const std::string& text, int y, int maxWidth, int lineHeight, int maxLines) {
  std::string line;
  int         lines = 0;
  size_t      i     = 0;
  while (i <= text.size() && lines < maxLines) {
    size_t n = 1;  // UTF-8 の 1 文字ぶんの長さ
    while (i + n < text.size() && ((uint8_t)text[i + n] & 0xC0) == 0x80) n++;
    std::string ch = i < text.size() ? text.substr(i, n) : "";
    if (i == text.size() || ch == "\n" || frame.textWidth((line + ch).c_str()) > maxWidth) {
      frame.drawString(line.c_str(), W / 2, y + lines++ * lineHeight);
      line.clear();
      if (i == text.size()) break;
      if (ch == "\n") ch.clear();
    }
    line += ch;
    i += n;
  }
}

static void drawMessage() {
  frame.fillScreen(rgb(theme.bg));
  frame.setTextDatum(middle_center);
  frame.setFont(&fonts::lgfxJapanGothic_24);
  frame.setTextColor(rgb(theme.accent2));
  frame.drawString("アプリを止めました", W / 2, 110);
  frame.setFont(&fonts::lgfxJapanGothic_20);
  frame.setTextColor(rgb(theme.fg));
  drawWrapped(message, 170, 330, 28, 6);
  frame.setTextColor(rgb(theme.muted));
  frame.drawString("ボタンで戻る", W / 2, H - 70);
  frame.pushSprite(0, 0);
}

static void drawProgress(bool first) {
  static const char* LABEL[] = {"", "文字盤を受信中", "効果音を受信中", "アプリを受信中"};
  auto&     d  = M5.Display;
  const int bw = 260, bh = 18, bx = (W - bw) / 2, by = H / 2;
  uint32_t  got = rx.received, total = rx.size;
  d.setTextDatum(middle_center);
  if (first) {
    d.fillScreen(rgb(theme.bg));
    d.setFont(&fonts::lgfxJapanGothic_28);
    d.setTextColor(rgb(theme.fg), rgb(theme.bg));
    d.drawString(LABEL[rx.kind <= KIND_APP ? rx.kind : 0], W / 2, by - 50);
    d.drawRect(bx - 3, by - 3, bw + 6, bh + 6, rgb(theme.muted));
  }
  if (total == 0) return;
  d.fillRect(bx, by, (uint64_t)bw * got / total, bh, rgb(theme.accent));
  char buf[40];
  snprintf(buf, sizeof(buf), "  %u / %u kB  ", (unsigned)(got / 1024), (unsigned)(total / 1024));
  d.setFont(&fonts::lgfxJapanGothic_24);
  d.setTextColor(rgb(theme.fg), rgb(theme.bg));
  d.drawString(buf, W / 2, by + 60);
}

// ---- BLE からの要求を処理する -----------------------------------------------------
static void handleRequests() {
  if (commitPending) commitTransfer();

  if (reqSetTime.exchange(false)) {
    time_t         epoch = pendingEpoch;
    struct timeval tv    = {epoch, 0};
    settimeofday(&tv, nullptr);
    if (M5.Rtc.isEnabled()) M5.Rtc.setDateTime(gmtime(&epoch));
    tzOffsetMin = pendingTz;
    prefs.putShort("tz", tzOffsetMin);
    applyTimezone();
  }
  if (reqTheme) {
    prefs.putBytes("theme", pendingTheme, sizeof(pendingTheme));
    reqTheme = false;
    loadTheme();
    app.setTheme(theme);
    redraw = true;
  }
  if (reqPlay.exchange(false)) playSound();
  if (reqBuzz.exchange(false)) buzz(250);
  if (uint16_t c = reqClear.exchange(0)) {
    if (c & 1) {
      LittleFS.remove(FACE_PATH);
      hasFace = false;
    }
    if (c & 2) {
      LittleFS.remove(SOUND_PATH);
      adoptSound(nullptr, 0);
    }
    bool appsChanged = false;
    for (int slot = 0; slot < APP_SLOTS; slot++) {
      if (!(c & (4u << slot))) continue;
      if (mode == MODE_APP && appSlot == slot) goHome();
      LittleFS.remove(appPath(slot).c_str());
      LittleFS.remove(dataPath(slot).c_str());
      scanApp(slot);
      appsChanged = true;
    }
    if (appsChanged) {
      publishApps();
      buzz(100);  // テーマの転送で消すときは震えない (色が届いたときに画面が変わる)
    }
    redraw = true;
  }
  if (reqHome.exchange(false)) goHome();
  int run = reqRun.exchange(-1);
  if (run >= 0) launchApp(run);
}

// ---- setup / loop -------------------------------------------------------------
void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  W = M5.Display.width();
  H = M5.Display.height();

  prefs.begin("face", false);
  tzOffsetMin = prefs.getShort("tz", 540);
  brightLevel = constrain((int)prefs.getUChar("bright", 3), 1, 5);
  volumeLevel = constrain((int)prefs.getUChar("volume", 4), 0, 5);
  vibrateOn   = prefs.getBool("vibrate", true);
  applySettings();
  loadTheme();
  applyTimezone();
  if (M5.Rtc.isEnabled()) M5.Rtc.setSystemTimeFromRtc();  // RTC は UTC で持つ

  for (M5Canvas* c : {&bg, &frame}) {
    c->setColorDepth(16);
    c->setPsram(true);
    c->createSprite(W, H);
  }

  if (!LittleFS.begin(true)) M5_LOGE("LittleFS mount failed");
  loadSavedFiles();
  scanApps();
  setupBle();
  drawClock(true);
}

void loop() {
  static bool     wasReceiving = false, bothHeld = false;
  static uint32_t lastProgress = 0, lastFrame = 0, bothSince = 0;
  M5.update();
  handleRequests();

  // A と B の同時長押しは、どの画面でも時計に戻る
  bool both = M5.BtnA.isPressed() && M5.BtnB.isPressed();
  if (both && !bothSince) bothSince = millis();
  if (!both) bothSince = 0, bothHeld = false;
  if (bothSince && !bothHeld && millis() - bothSince > 800) {
    bothHeld = true;
    buzz(60);
    goHome();
  }

  bool clickA = M5.BtnA.wasClicked(), clickB = M5.BtnB.wasClicked();
  auto touch  = M5.Touch.getDetail();
  bool tap    = touch.wasClicked();

  if (rxState == ST_RECEIVING) {  // 受信中は進み具合だけを表示する
    if (!wasReceiving || millis() - lastProgress > 150) {
      drawProgress(!wasReceiving);
      lastProgress = millis();
    }
    wasReceiving = true;
  } else {
    if (wasReceiving) redraw = true;
    wasReceiving = false;

    switch (mode) {
      case MODE_HOME:
        if (clickA || tap) playSound();
        if (clickB) {
          listIndex = 0;
          setMode(MODE_LIST);
        } else {
          drawClock(redraw);
          redraw = false;
        }
        break;

      case MODE_LIST: {
        int count = listCount();
        if (clickA) listIndex = (listIndex + 1) % count, redraw = true, modeSince = millis();
        if (tap) {  // 行をタップしたらそれを開く
          int first = constrain(listIndex - LIST_ROWS / 2, 0, max(0, count - LIST_ROWS));
          int row   = (touch.y - LIST_TOP) / LIST_ROW;
          if (touch.y >= LIST_TOP && row < LIST_ROWS && first + row < count) listIndex = first + row, clickB = true;
        }
        if (clickB && listIndex == 0) {
          setMode(MODE_SETTINGS);
        } else if (clickB) {
          launchApp(listSlot(listIndex - 1));
        } else if (millis() - modeSince > 20000) {
          goHome();
        } else if (redraw) {
          drawList();
          redraw = false;
        }
        break;
      }

      case MODE_SETTINGS:
        if (tap) settingsTap(touch.x, touch.y), redraw = true, modeSince = millis();
        if (clickB) {
          listIndex = 0;
          setMode(MODE_LIST);
        } else if (millis() - modeSince > 30000) {
          goHome();
        } else if (redraw) {
          drawSettings();
          redraw = false;
        }
        break;

      case MODE_APP: {
        bool ok = true;
        if (clickA) ok = app.button("A");
        if (ok && clickB) ok = app.button("B");
        if (ok && touch.wasPressed()) ok = app.touch(touch.x, touch.y);  // 触れた瞬間に渡す (離すまで待つと、指が動いたり長く触れたりした分を取りこぼす)
        if (ok && (redraw || millis() - lastFrame >= (uint32_t)(1000 / app.fps()))) {
          lastFrame = millis();
          redraw    = false;
          ok        = app.frame();
          if (ok) frame.pushSprite(0, 0);
        }
        if (!ok) appFailed();
        else if (app.exitRequested()) goHome();
        break;
      }

      case MODE_MESSAGE:
        if (clickA || clickB || tap || millis() - modeSince > 15000) {
          goHome();
        } else if (redraw) {
          drawMessage();
          redraw = false;
        }
        break;
    }
  }

  if (buzzUntil && (int32_t)(millis() - buzzUntil) >= 0) {
    M5.Power.setVibration(0);
    buzzUntil = 0;
  }
  delay(5);
}
