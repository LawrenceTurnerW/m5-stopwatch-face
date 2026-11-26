// 「みんなの投稿」API の通しテスト。手元の Worker を相手に動かす。
//   準備: npx wrangler@4 d1 migrations apply m5-stopwatch-face --local && npx wrangler@4 dev --port 8787
//   実行: node tools/api-test/test.js   (.dev.vars に ADMIN_TOKEN=local-admin-token と TEST_MODE=1 を書いておく)
const BASE = process.env.BASE || 'http://127.0.0.1:8787';
const ADMIN = process.env.ADMIN_TOKEN || 'local-admin-token';
let failed = 0, count = 0;
const assert = (ok, name) => { count++; if (!ok) failed++; console.log(`  ${ok ? 'ok ' : 'NG '} ${name}`); };
const call = async (method, path, body, headers = {}) => {
  const r = await fetch(BASE + path, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json().catch(() => null) };
};
const app = (name, extra = '') => `// @name ${name}\n// @description テスト用 ${extra}\nfunction draw() { g.clear(); } // ${Math.random()}`;

(async () => {
  const made = [];
  try {
    let r = await call('POST', '/api/apps', { code: app('  テスト <b>1</b>\u0007  ') });
    assert(r.status === 201 && /^[0-9a-f]{16}$/.test(r.data.id) && /^[0-9a-f]{48}$/.test(r.data.deleteKey), '投稿すると ID と削除キーが返る');
    const first = r.data; made.push(first.id);
    assert(first.name === 'テスト <b>1</b>', '名前は @name から取り、前後の空白と制御文字を落とす');

    r = await call('GET', '/api/apps');
    const row = r.data.apps.find(a => a.id === first.id);
    assert(r.status === 200 && row && row.size > 0 && row.code === undefined && row.delete_hash === undefined, '一覧に載り、コードと削除キーは含まれない');
    r = await call('GET', '/api/apps/' + first.id);
    assert(r.status === 200 && r.data.code.includes('function draw') && r.data.delete_hash === undefined && r.data.reports === undefined, '1 件を取るとコードが返る');

    r = await call('POST', '/api/apps', { code: r.data.code });
    assert(r.status === 409, '同じコードの二重投稿は断る');
    assert((await call('POST', '/api/apps', { code: 'function draw() {}' })).status === 400, '@name が無いと断る');
    assert((await call('POST', '/api/apps', { code: '// @name x\nlet a = 1;' })).status === 400, 'draw() が無いと断る');
    assert((await call('POST', '/api/apps', { code: '' })).status === 400, '空は断る');
    assert((await call('POST', '/api/apps', { code: app('大きい') + '\n//' + 'あ'.repeat(30000) })).status === 413, '64kB を超えると断る');
    assert((await call('POST', '/api/apps', { code: app('ok') + '\n//' + 'a'.repeat(60000) }).then(x => { if (x.data && x.data.id) made.push(x.data.id); return x.status; })) === 201, '64kB 以内なら通る');
    r = await call('POST', '/api/apps', { code: app('な'.repeat(100)) }); made.push(r.data.id);
    assert(r.status === 201 && r.data.name.length === 40, '長い名前は 40 文字に切る');
    assert((await call('POST', '/api/apps', { code: app('よそ') }, { origin: 'https://evil.example' })).status === 403, 'ほかのサイトからの投稿は断る');

    assert((await call('DELETE', '/api/apps/' + first.id)).status === 401, '削除キーなしでは消せない');
    assert((await call('DELETE', '/api/apps/' + first.id, null, { authorization: 'Bearer ' + 'f'.repeat(48) })).status === 403, '違う削除キーでは消せない');
    assert((await call('GET', '/api/apps/' + first.id)).status === 200, '失敗した削除のあとも残っている');
    assert((await call('DELETE', '/api/apps/' + first.id, null, { authorization: 'Bearer ' + first.deleteKey })).status === 200, '投稿者の削除キーで消せる');
    assert((await call('GET', '/api/apps/' + first.id)).status === 404, '消したものは取れない');

    const second = made[1];
    for (let i = 0; i < 4; i++) r = await call('POST', `/api/apps/${second}/report`, null, { 'x-test-ip': '10.0.0.1' });
    assert(r.status === 200 && (await call('GET', '/api/apps')).data.apps.some(a => a.id === second), '同じ人が何度通報しても 1 件と数える');
    for (const ip of ['10.0.0.2', '10.0.0.3']) await call('POST', `/api/apps/${second}/report`, null, { 'x-test-ip': ip });
    r = await call('GET', '/api/apps');
    assert(!r.data.apps.some(a => a.id === second), '別々の 3 人から通報されると一覧から外れる');
    assert((await call('DELETE', '/api/apps/' + second, null, { authorization: 'Bearer ' + ADMIN })).status === 200, '管理者トークンで消せる');

    // 配色の投稿
    const c6 = () => Array.from({ length: 6 }, () => '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'));
    const mine = c6();
    r = await call('POST', '/api/themes', { name: '  テスト配色  ', colors: mine.map(c => c.toUpperCase()) });
    assert(r.status === 201 && r.data.name === 'テスト配色' && r.data.colors.join() === mine.join() && r.data.deleteKey, '配色を投稿すると ID と削除キーが返る (色は小文字にそろえる)');
    const th = r.data;
    r = await call('GET', '/api/themes');
    const trow = r.data.themes.find(t => t.id === th.id);
    assert(trow && trow.colors.length === 6 && trow.delete_hash === undefined, '配色の一覧に 6 色つきで載る');
    assert((await call('POST', '/api/themes', { name: '同じ', colors: mine })).status === 409, '同じ配色の二重投稿は断る');
    assert((await call('POST', '/api/themes', { name: '', colors: c6() })).status === 400, '名前のない配色は断る');
    assert((await call('POST', '/api/themes', { name: 'x', colors: c6().slice(0, 5) })).status === 400 && (await call('POST', '/api/themes', { name: 'x', colors: ['red', ...c6().slice(1)] })).status === 400, '色の数や形式が違う配色は断る');
    assert((await call('DELETE', '/api/themes/' + th.id, null, { authorization: 'Bearer ' + 'f'.repeat(48) })).status === 403, '配色: 違う削除キーでは消せない');
    for (const ip of ['10.1.0.1', '10.1.0.2', '10.1.0.3']) await call('POST', `/api/themes/${th.id}/report`, null, { 'x-test-ip': ip });
    assert(!(await call('GET', '/api/themes')).data.themes.some(t => t.id === th.id), '配色: 別々の 3 人から通報されると一覧から外れる');
    assert((await call('DELETE', '/api/themes/' + th.id, null, { authorization: 'Bearer ' + th.deleteKey })).status === 200, '配色: 投稿者の削除キーで消せる');

    // AI 生成: 実際に AI を呼ぶと料金がかかるので、呼ぶ前に断られる場合だけを確かめる
    r = await call('GET', '/api/generate');
    assert(r.status === 200 && typeof r.data.available === 'boolean', 'AI が使えるかどうかを返す');
    assert((await call('POST', '/api/generate', { kind: 'app', prompt: '' })).status === 400, 'AI: 空の依頼は断る');
    assert((await call('POST', '/api/generate', { kind: 'app', prompt: 'あ'.repeat(401) })).status === 400, 'AI: 長すぎる依頼は断る');
    assert((await call('POST', '/api/generate', { kind: 'other', prompt: 'x' })).status === 400, 'AI: 知らない種類は断る');
    assert((await call('POST', '/api/generate', { kind: 'app', prompt: 'x', code: 'a'.repeat(30000) })).status === 413, 'AI: 大きすぎるコードは断る');
    assert((await call('POST', '/api/generate', { kind: 'app', prompt: 'x' }, { origin: 'https://evil.example' })).status === 403, 'AI: ほかのサイトからは使えない');

    assert((await call('GET', '/api/apps/zzzz')).status === 404 && (await call('GET', '/api/nothing')).status === 404, '形式の違う URL は 404');
    assert((await call('PUT', '/api/apps')).status === 405, '対応しない操作は 405');
    const page = await fetch(BASE + '/');
    assert(page.status === 200 && (await page.text()).includes('みんなの投稿'), '/api/ 以外はサイトを返す');
  } finally {
    for (const id of made) await call('DELETE', '/api/apps/' + id, null, { authorization: 'Bearer ' + ADMIN });
  }
  console.log(failed ? `\n${failed} 件失敗` : `\n${count} 項目すべて成功`);
  process.exit(failed ? 1 : 0);
})();
