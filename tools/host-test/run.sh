#!/bin/sh
# サンプルアプリとテスト用スクリプトを PC 上のエンジンで実行し、最後の 1 行を並べて表示する。
# メモリ破壊などを検出したら失敗で終わる。  使い方: sh tools/host-test/run.sh
cd "$(dirname "$0")"
[ -x ./host_test ] || sh ./build.sh
fail=0
for f in ../../web/apps/*.js cases/*.js; do
  out=$(./host_test "$f" "f,A,f,B,f,T:100:100,f" 2>&1)
  if echo "$out" | grep -q "Sanitizer\|runtime error:"; then fail=1; echo "!! $f"; echo "$out" | grep -m3 "Sanitizer\|runtime error:"; fi
  printf '%-28s %s\n' "$(basename "$f")" "$(echo "$out" | grep "^END\|^ERROR" | tail -1 | cut -c1-90)"
done
exit $fail
