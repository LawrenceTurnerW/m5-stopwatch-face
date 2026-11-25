// ESP32 (ESP-IDF 4.4) でリンクを通すための補助。QuickJS 本体のファイルには手を入れていない。
#ifdef ESP_PLATFORM
#include <pthread.h>

// ESP-IDF 4.4 の pthread には pthread_condattr_destroy が無い。QuickJS は Atomics.wait() の
// 準備でしか呼ばず、ESP-IDF の condattr は解放するものを持たないので、何もしない実装で足りる。
// (新しい SDK が本物を持っている場合はそちらが使われる)
__attribute__((weak)) int pthread_condattr_destroy(pthread_condattr_t* attr) {
  (void)attr;
  return 0;
}
#endif
