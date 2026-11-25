// ミニアプリ (JavaScript) を QuickJS で動かす実行環境。
// 画面や音には AppHost 経由でしか触れないので、アプリができることは API の範囲に限られる。
#pragma once
#include <string>

#include "app_host.h"

struct JSRuntime;
struct JSContext;

class AppRuntime {
 public:
  // ---- 制限 ----
  static constexpr size_t kMaxSource     = 64 * 1024;    // スクリプトの最大サイズ
  static constexpr size_t kMemoryLimit   = 1024 * 1024;  // JS ヒープの上限
  static constexpr size_t kStackLimit    = 32 * 1024;    // JS が使える C スタック
  static constexpr int    kLoadBudgetMs  = 1000;         // 読み込みと setup() の制限時間
  static constexpr int    kFrameBudgetMs = 250;          // draw() とイベント 1 回の制限時間
  static constexpr size_t kMaxStore      = 4096;         // store.save() で保存できる JSON の大きさ
  static constexpr int    kMaxPrints     = 8;            // 1 回の呼び出しで出せる print() の行数

  explicit AppRuntime(AppHost& host);
  ~AppRuntime();

  // スクリプトを読み込んで setup() まで実行する。失敗したら false を返し、理由は error() で取れる。
  bool start(const char* code, size_t len, const AppTheme& theme);
  void setTheme(const AppTheme& theme);
  bool frame();                   // draw() を 1 回呼ぶ
  bool button(const char* name);  // onButton("A" | "B")
  bool touch(int x, int y);       // onTouch(x, y)
  void stop();                    // 保存待ちのデータを書き出して終了する

  bool running() const { return ctx_ != nullptr; }
  bool exitRequested() const { return exitRequested_; }
  int  fps() const { return fps_; }
  const std::string& error() const { return error_; }
  size_t memoryUsed() const;

  // ---- 以下は API の実装 (app_runtime.cpp) から使う ----
  AppHost& host() { return host_; }
  AppTheme theme_;
  int      fps_           = 10;
  bool     exitRequested_ = false;
  int      prints_        = 0;
  bool     storeDirty_    = false;
  bool     storeLoaded_   = false;
  std::string storeJson_;
  uint32_t deadline_ = 0;
  bool     timedOut_ = false;

 private:
  bool call(int fnIndex, int argc, void* argv, int budgetMs, const char* what);
  bool fail(const char* what);
  void flushStore(bool force);
  void installApi();

  AppHost&    host_;
  JSRuntime*  rt_  = nullptr;
  JSContext*  ctx_ = nullptr;
  void*       fns_ = nullptr;  // JSValue[4]: setup, draw, onButton, onTouch
  std::string error_;
  uint32_t    lastStoreWrite_ = 0;
};
