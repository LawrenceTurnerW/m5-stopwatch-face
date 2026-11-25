#!/bin/sh
# PC 用のテストプログラムをビルドする: tools/host-test/build.sh  →  tools/host-test/host_test
set -e
cd "$(dirname "$0")"
Q=../../lib/quickjs
mkdir -p obj
for f in quickjs libregexp libunicode dtoa; do
  [ obj/$f.o -nt $Q/$f.c ] || cc -c -std=gnu11 -O1 -g -w -fsanitize=address,undefined -D_GNU_SOURCE -I$Q $Q/$f.c -o obj/$f.o &
done
wait
c++ -std=gnu++11 -O1 -g -Wall -Wextra -fsanitize=address,undefined -I$Q ../../src/app_runtime.cpp host_main.cpp obj/*.o -o host_test -lm -lpthread
echo built: $(pwd)/host_test
