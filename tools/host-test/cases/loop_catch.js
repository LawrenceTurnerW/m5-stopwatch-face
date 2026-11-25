// 打ち切りは try/catch で握りつぶせない
function draw() { try { for (;;) {} } catch (e) { print("caught"); } finally { for (;;) {} } }
