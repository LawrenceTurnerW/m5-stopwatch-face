// サイト (web/index.html) の通しテスト。疑似 BLE デバイス (mock.js) を相手に動かし、
// プレビューの API が実機側エンジン (tools/host-test/host_test) と同じ結果になることも確かめる。
//
//   準備: tools/host-test/build.sh を実行し、npm i playwright (と npx playwright install chromium)
//   実行: node tools/browser-test/test.js
const { chromium } = require('playwright');
const zlib = require('zlib'), fs = require('fs'), os = require('os'), path = require('path'), cp = require('child_process');
const P = path.resolve(__dirname, '../..');
const HOST = P + '/tools/host-test/host_test';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swtest-'));

// テスト用の画像 (PNG) と音声 (WAV) を作る
function makePng(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 3 + 1) + 1 + x * 3;
    raw[i] = x * 255 / w; raw[i + 1] = y * 255 / h; raw[i + 2] = 127 + 120 * Math.sin(x / 23) * Math.cos(y / 31);
  }
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const head = Buffer.alloc(13);
  head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function makeWav(seconds) {
  const n = 44100 * seconds, b = Buffer.alloc(44 + n * 4);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 4, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.round(12000 * Math.sin(i * 2 * Math.PI * 660 / 44100)), 44 + i * 4);
    b.writeInt16LE(Math.round(12000 * Math.sin(i * 2 * Math.PI * 880 / 44100)), 46 + i * 4);
  }
  return b;
}
const PHOTO = path.join(TMP, 'photo.png'), TONE = path.join(TMP, 'tone.wav');
fs.writeFileSync(PHOTO, makePng(1200, 800));
fs.writeFileSync(TONE, makeWav(3));
let passed = 0;
const assert = (c, m) => { if (!c) throw new Error('FAIL: ' + m); passed++; console.log('  ok  ' + m); };
const host = (file, steps) => {
  const r = cp.spawnSync(HOST, [file, steps], { encoding: 'utf8' });
  if (/Sanitizer|runtime error/.test(r.stderr)) throw new Error('sanitizer: ' + r.stderr.slice(0, 500));
  return r.stdout.trim().split('\n');
};
const strip = lines => lines.filter(l => !l.startsWith('storeSave')).map(l => l.replace(/ mem=\d+kB$/, ''));

(async () => {
  const server = cp.spawn('python3', ['-m', 'http.server', '8765', '--bind', '127.0.0.1'], { cwd: P + '/web', stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 800));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1100 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  // このテストは静的サーバーで動かすので /api/ は 404 になる (投稿の欄は出ないのが正しい)。それだけは数えない。
  page.on('console', m => m.type() === 'error' && !/\/api\//.test(m.location().url) && errors.push(m.text()));
  await page.addInitScript({ path: path.join(__dirname, 'mock.js') });
  await page.goto('http://127.0.0.1:8765/index.html');
  const tab = name => page.click(`nav button[data-tab=${name}]`);
  const lastRow = async () => { await tab('transfer'); return page.$eval('#results tr', tr => Array.from(tr.cells, c => c.textContent)); };
  const idle = () => page.waitForFunction(() => !document.getElementById('connect').disabled);
  const mock = () => page.evaluate(() => window.__mock);
  const consoleText = () => page.textContent('#console');
  const waitConsole = text => page.waitForFunction(t => document.getElementById('console').textContent.includes(t), text, { timeout: 8000 });

  try {
    console.log('接続');
    await page.click('#connect'); await idle();
    let m = await mock();
    assert(m.commands[0][0] === 0x10 && m.commands[0].length === 7, '接続時に SET_TIME を送る');
    assert(await page.$$eval('#slot option', o => o.length) === 8 && (await page.textContent('#slot')).includes('空き'), 'アプリ置き場が 8 個表示される');

    console.log('テーマカラー');
    assert(await page.inputValue('#themeText') === '#101216,#1A1D24,#E8EAF0,#9AA1B0,#5CC8FF,#FFA500', '初期テーマの共有文字列');
    await page.click('#presets button:has-text("サクラ")');
    assert(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()) === '#fff5f7', 'プリセットでページの配色が変わる');
    await page.fill('#themeText', '0a0a0a 222222 fafafa 777777 00ff88 ff0066'); await page.dispatchEvent('#themeText', 'input');
    assert(await page.inputValue('#color-accent') === '#00ff88', '貼り付けた文字列から色を取り込む');
    await page.click('#sendTheme'); await idle();
    m = await mock();
    assert(JSON.stringify(m.theme) === JSON.stringify([10, 10, 10, 34, 34, 34, 250, 250, 250, 119, 119, 119, 0, 255, 136, 255, 0, 102]), 'SET_THEME で 6 色 x RGB を送る');
    assert(m.commands.at(-1)[0] === 0x14 && m.commands.at(-1).length === 19, 'SET_THEME のコマンド長 (転送の最後に送る)');
    assert(m.commands.slice(-3, -1).every(c => c[0] === m.commands.at(-2)[0]) && m.files.length === 0, '画像も音も選んでいなければ、本体の文字盤と効果音を消す');

    console.log('文字盤と効果音');
    await page.setInputFiles('#imgFile', PHOTO);
    await page.waitForFunction(() => document.getElementById('imgSize').textContent.includes('kB'));
    for (const [mtu, mode] of [[247, 'nr'], [23, 'nr'], [517, 'wr']]) {
      await page.evaluate(v => { window.__mockCfg.mtu = v; window.__mock.maxChunk = 0; }, mtu);
      await tab('transfer'); await page.selectOption('#mode', mode); await tab('theme');
      await page.click('#sendTheme'); await idle();
      const row = await lastRow(); await tab('theme');
      m = await mock();
      assert(row[8] === 'OK' && m.maxChunk === Math.min(mtu - 3, 512), `MTU ${mtu} / ${mode}: 送信成功、チャンク ${m.maxChunk}`);
    }
    const jpg = Buffer.from(m.files[0].b64, 'base64');
    const begin = Buffer.from(m.commands.find(c => c[0] === 1));
    const transparent = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = c.height = 64; face.img = await createImageBitmap(c); const out = faceCanvasForExport().getContext('2d').getImageData(233, 233, 1, 1).data; return [...out].slice(0, 3).join(); });
    assert(transparent === '10,10,10', '透過のある画像は、透けた部分が背景色になる');
    await page.setInputFiles('#imgFile', PHOTO); await page.waitForTimeout(500);
    assert(begin.readUInt32LE(3) === jpg.length && begin.readUInt32LE(7) === zlib.crc32(jpg), 'BEGIN のサイズと CRC32 が zlib と一致');
    assert(jpg[0] === 0xFF && jpg[1] === 0xD8 && m.files.every(f => f.b64 === m.files[0].b64), 'JPEG が 3 回とも同じバイト列で届く');
    await page.evaluate(() => { window.__mockCfg.mtu = 247; });
    await tab('transfer'); await page.selectOption('#mode', 'nr'); await tab('theme');
    await page.click('#sounds button:text-is("チャイム")');
    await page.waitForFunction(() => document.getElementById('sndSize').textContent.includes('kB'));
    const sndSize = await page.textContent('#sndSize'), sndSamples = await page.evaluate(() => sound.pcm.length);
    const before = (await mock()).files.length;
    await page.click('#sendTheme'); await idle();
    m = await mock();
    const kinds = m.files.slice(before).map(f => f.kind);
    assert(JSON.stringify(kinds) === '[1,2]' && m.commands.at(-1)[0] === 0x14, '「本体に転送」で文字盤・効果音・色をまとめて送る');
    const snd = Buffer.from(m.files.at(-1).b64, 'base64');
    assert(snd.subarray(0, 4).toString() === 'SWP1' && snd.readUInt32LE(4) === 16000 && snd.length === 8 + sndSamples * 2 && sndSamples > 8000, '効果音の形式と長さ');

    console.log('異常系');
    await page.evaluate(() => { window.__mockCfg.corrupt = true; });
    await page.click('#sendTheme'); await idle();
    assert((await lastRow())[8].includes('CRC'), 'データ化けを CRC エラーとして表示');
    await tab('theme');
    await page.evaluate(() => { window.__mockCfg.corrupt = false; window.__mockCfg.dropChunk = 3; });
    await page.click('#sendTheme'); await idle();
    assert((await lastRow())[8].includes('応答がありません') && (await mock()).commands.at(-1)[0] === 3, '欠落をタイムアウトとして表示し ABORT を送る');
    await page.evaluate(() => { window.__mockCfg.dropChunk = -1; });

    console.log('プレビュー');
    await tab('apps');
    const samples = JSON.parse(fs.readFileSync(P + '/web/apps/index.json', 'utf8')).length;
    await page.waitForFunction(n => document.querySelectorAll('#gallery button').length === n + 1, samples);
    assert(true, `ギャラリーに「新規」とサンプル ${samples} 個が並ぶ`);
    await page.click('#gallery button:text-is("新規")');  // ひな形は onButton で print する
    await page.waitForTimeout(1200);
    await page.click('#btnA');
    await waitConsole('[プレビュー] ボタン A');
    assert(true, 'プレビューのボタン A がアプリの onButton に届く');
    await page.click('#screen', { position: { x: 160, y: 160 } });
    await page.fill('#code', '// @name テスト\nfunction onTouch(x, y) { print("touch", x, y); }\nfunction draw() { g.clear(theme.accent); g.fillCircle(233, 233, 100, 0xff0000); }');
    await page.waitForTimeout(1200);
    await page.frameLocator('#screen iframe').locator('canvas').click({ position: { x: 80, y: 240 } });
    await waitConsole('touch ');
    const [tx, ty] = /touch (\d+) (\d+)/.exec(await consoleText()).slice(1).map(Number);
    assert(Math.abs(tx - 117) <= 3 && Math.abs(ty - 350) <= 3, `タップ位置が 466px の座標でアプリに届く (${tx}, ${ty})`);

    for (const [name, code, expect] of [
      ['文法エラーを行番号つきで表示', 'function draw() {\n  g.clear(;\n}', /SyntaxError.*\(2 行目\)/],
      ['実行時エラーを行番号つきで表示', 'function draw() {\n  g.clear();\n  nothing.here = 1;\n}', /ReferenceError.*\(3 行目\)/],
      ['draw() がないとき', 'function setup() {}', /draw\(\) がありません/],
      ['draw() の無限ループを止める', 'function draw() { for (;;) {} }', /draw\(\) が制限時間を超えたので止めました/],
      ['読み込み中の無限ループを止める', 'for (;;) {}\nfunction draw() {}', /読み込み が制限時間を超えたので止めました/],
      ['setup() の無限ループを止める', 'function setup() { for (;;) {} }\nfunction draw() {}', /setup\(\) が制限時間を超えたので止めました/],
    ]) {
      await page.evaluate(() => { document.getElementById('console').textContent = ''; });
      await page.fill('#code', code);
      await page.waitForFunction(re => new RegExp(re).test(document.getElementById('console').textContent), expect.source, { timeout: 10000 });
      assert(await page.textContent('#appStatus') === '止まりました', name);
    }
    assert(await page.evaluate(() => 1 + 1) === 2, '無限ループのあともページは操作できる');

    console.log('隔離');
    await page.evaluate(() => { document.getElementById('console').textContent = ''; });
    await page.fill('#code', `function draw() {}
print([typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof importScripts, typeof document, typeof window, typeof navigator,
  typeof indexedDB, typeof postMessage, typeof self, typeof setTimeout, typeof localStorage, typeof parent, typeof Worker].join(","));
print("std", typeof Date, typeof JSON, typeof Math, typeof Promise, typeof Map, typeof g, typeof theme.accent);
try { print("up", String(globalThis.constructor)); } catch (e) { print("up-error"); }`);
    await waitConsole('std function object object function function object number');
    const iso = await consoleText();
    assert(iso.includes(Array(14).fill('undefined').join(',')), 'アプリから通信・DOM・ページ本体・タイマーに触れない');
    const sandbox = await page.$eval('#screen iframe', f => f.getAttribute('sandbox'));
    assert(sandbox === 'allow-scripts', 'プレビューは allow-scripts だけの sandbox iframe');

    console.log('実機側エンジンとプレビューの一致');
    await tab('theme'); await page.click('#presets button:has-text("ミッドナイト")'); await tab('apps');  // 実機側テストの既定テーマに合わせる
    const cases = P + '/tools/host-test/cases/';
    const conf = fs.readFileSync(cases + 'conformance.js', 'utf8');
    const steps = 'f,A,B,T:12:345,f';
    const want = strip(host(cases + 'conformance.js', steps)), have = await page.evaluate(([c, s]) => preview.trace(c, s), [conf, steps]);
    const diff = want.map((l, i) => l === have[i] ? null : `#${i} 実機側: ${l}\n      プレビュー: ${have[i]}`).filter(Boolean);
    assert(want.length === have.length && diff.length === 0, `API 適合テストの記録が完全一致 (${want.length} 行)` + (diff.length ? '\n' + diff.slice(0, 5).join('\n') : ''));
    for (const app of JSON.parse(fs.readFileSync(P + '/web/apps/index.json', 'utf8')).map(a => a.file.replace(/\.js$/, ''))) {
      const code = fs.readFileSync(`${P}/web/apps/${app}.js`, 'utf8'), st = 'f,A,f,B,f,T:100:100,f';
      const w = strip(host(`${P}/web/apps/${app}.js`, st)).map(l => l.split(' ')[0]);
      const h = (await page.evaluate(([c, s]) => preview.trace(c, s), [code, st])).map(l => l.split(' ')[0]);
      if (app === 'dice') {  // 乱数で目の数が変わるので、使われた呼び出しの種類だけを比べる
        assert([...new Set(w)].sort().join() === [...new Set(h)].sort().join() && h.at(-1) === 'END', `サンプル ${app}: 呼び出しの種類が一致`);
        continue;
      }
      assert(w.join() === h.join() && w.at(-1) === 'END', `サンプル ${app}: 呼び出しの並びが一致 (${w.length} 行)`);
    }
    for (const [file, same] of [['no_draw', true], ['bad_color', true], ['store_big', true], ['loop_draw', true], ['loop_setup', true], ['runtime_error', false], ['button_error', true], ['syntax', false]]) {
      const w = host(cases + file + '.js', 'f,A,f').at(-1);
      const h = (await page.evaluate(([c, s]) => preview.trace(c, s), [fs.readFileSync(cases + file + '.js', 'utf8'), 'f,A,f'])).at(-1);
      const line = s => (/\((\d+) 行目\)/.exec(s) || [])[1];
      assert(w.startsWith('ERROR') && h.startsWith('ERROR') && line(w) === line(h) && (!same || w === h), `エラー ${file}: ${same ? '同じメッセージ' : '同じ行番号'} → ${h.slice(6, 70)}`);
    }
    for (const file of ['arrow_draw', 'print_flood', 'async', 'exit', 'escape']) {
      const w = strip(host(cases + file + '.js', 'f,A,f')), h = await page.evaluate(([c, s]) => preview.trace(c, s), [fs.readFileSync(cases + file + '.js', 'utf8'), 'f,A,f']);
      assert(w.join('\n') === h.join('\n'), `動作 ${file}: 記録が一致 (${w.length} 行)` + (w.join('\n') === h.join('\n') ? '' : `\n実機側:\n${w.join('\n')}\nプレビュー:\n${h.join('\n')}`));
    }

    console.log('アプリのインストール');
    await page.click('#gallery button:has-text("ストップウォッチ")');
    await page.waitForFunction(() => document.getElementById('code').value.includes('@name ストップウォッチ'));
    await page.selectOption('#slot', '2');
    await page.click('#installApp'); await idle();
    m = await mock();
    const appFile = m.files.at(-1);
    assert(appFile.kind === 3 && appFile.slot === 2 && Buffer.from(appFile.b64, 'base64').toString() === fs.readFileSync(P + '/web/apps/stopwatch.js', 'utf8'), 'アプリが置き場 3 にそのまま届く');
    assert(JSON.stringify(m.commands.at(-1)) === '[32,2]' && m.running === 2, '保存後に RUN を送る');
    await tab('apps');
    assert((await page.textContent('#slot')).includes('3: ストップウォッチ'), '本体のアプリ一覧を読み直して表示する');
    await waitConsole('[本体] > 起動: ストップウォッチ');
    assert(true, '本体からのログをコンソールに表示する');
    await page.click('#homeApp'); await idle();
    await page.click('#deleteApp'); await idle();
    m = await mock();
    assert(JSON.stringify(m.commands.slice(-2)) === '[[33],[19,3,2]]' && !(await page.textContent('#slot')).includes('ストップウォッチ'), 'HOME と削除のコマンド');

    console.log('共有リンク');
    const link = await page.evaluate(() => appLink(document.getElementById('code').value));
    assert(link.includes('#app=') && link.length < 2500, `共有リンクにアプリが入る (${link.length} 文字)`);
    const page2 = await ctx.newPage();
    await page2.goto(link);
    await page2.waitForFunction(() => document.getElementById('code').value.includes('@name ストップウォッチ'));
    assert(await page2.isVisible('#shared') && await page2.isVisible('#tab-apps') && await page2.inputValue('#code') === fs.readFileSync(P + '/web/apps/stopwatch.js', 'utf8'), 'リンクを開くとアプリが読み込まれ、確認を促す');
    await page2.goto('http://127.0.0.1:8765/index.html#theme=FFF5F7,FFE3EA,4A2B3A,A77C8C,E8558A,F2A541'); await page2.reload();
    assert(await page2.inputValue('#color-accent') === '#e8558a', 'テーマのリンクで色が切り替わる');
    await page2.close();

    await page.click('#connect'); await idle();
    assert(await page.textContent('#state') === '未接続' && await page.isDisabled('#installApp'), '切断すると未接続に戻る');
    assert(!(await page.isVisible('#community')) && !(await page.isVisible('#postApp')) && !(await page.isVisible('#ai')) && !(await page.isVisible('#aiTheme')) && !(await page.isVisible('#themePosts')) && !(await page.isVisible('#postTheme')), 'API のない場所では投稿と AI の欄を出さない');
    assert(errors.length === 0, 'ページのエラーなし ' + errors.join(' / '));

    console.log(`\n${passed} 項目すべて成功`);
  } finally {
    await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e.message); process.exit(1); });
