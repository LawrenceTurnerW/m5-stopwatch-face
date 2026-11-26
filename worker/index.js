// サイトの裏側: 「みんなの投稿」の API。それ以外の URL は web/ の静的ファイルをそのまま返す。
//
//   GET    /api/apps            一覧 (新しい順、コードは含まない)
//   GET    /api/apps/:id        1 件 (コードつき)
//   POST   /api/apps            投稿 { code }。名前と説明はコード先頭の // @name / // @description から取る
//   GET/POST/DELETE /api/themes…  配色 (6 色と名前) の投稿。形は apps と同じで、POST は { name, colors: ["#rrggbb" x 6] }
//   DELETE /api/apps/:id        削除。Authorization: Bearer <投稿時の削除キー か 管理者トークン>
//   GET/POST /api/generate     AI にアプリや配色を作ってもらう (worker/generate.js)
//   POST   /api/apps/:id/report 通報。別々の人から HIDE_AT 件たまると一覧から外れる (データは残り、管理者が判断する)
//
// アカウントは無い。投稿はすぐ公開される。コードは本体でもプレビューでも隔離して動くので、
// ここで見るのは大きさと形式だけ。

import { generate } from './generate.js';

const MAX_CODE = 64 * 1024;  // 本体が受け取れる上限と同じ
const MAX_NAME = 40, MAX_DESC = 120, MAX_THEME_NAME = 24;
const LIST_LIMIT = 100;
const HIDE_AT = 3;           // この数の通報で一覧から外す
const DAILY_POSTS = 300;     // サイト全体の 1 日の投稿数の上限 (荒らされたときの歯止め)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const fail = (status, message) => json({ error: message }, status);

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256 = async text => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
const randomId = bytes => hex(crypto.getRandomValues(new Uint8Array(bytes)));

// コード先頭のコメントから取り出す。制御文字は落とし、長すぎるものは切る。
function meta(code, key, max) {
  const m = new RegExp(`^\\s*//\\s*@${key}\\s+(.+)$`, 'm').exec(code.slice(0, 600));
  return (m ? m[1] : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// 時間をかけて比べる (文字列の一致位置から推測されないように)
function sameText(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 相手の IP。テスト用の設定 (TEST_MODE、手元の .dev.vars だけに書く) のときは、ヘッダーで差し替えられる。
const clientIp = (env, request) =>
  (env.TEST_MODE && request.headers.get('x-test-ip')) || request.headers.get('cf-connecting-ip') || 'unknown';

async function limited(env, request, kind) {
  if (!env.LIMITER || env.TEST_MODE) return false;
  return !(await env.LIMITER.limit({ key: `${kind}:${clientIp(env, request)}` })).success;
}

async function listPosts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, description, length(code) AS size, created_at FROM posts WHERE reports < ?1 ORDER BY created_at DESC LIMIT ?2',
  ).bind(HIDE_AT, LIST_LIMIT).all();
  return json({ apps: results });
}

async function getPost(env, id) {
  const row = await env.DB.prepare('SELECT id, name, description, code, created_at FROM posts WHERE id = ?1').bind(id).first();
  return row ? json(row) : fail(404, '見つかりません');
}

async function createPost(env, request) {
  if (await limited(env, request, 'post')) return fail(429, '投稿が続いています。少し待ってからもう一度どうぞ');
  if (Number(request.headers.get('content-length') || 0) > MAX_CODE * 4) return fail(413, 'アプリが大きすぎます (64kB まで)');
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, '形式が正しくありません'); }
  const code = body && typeof body.code === 'string' ? body.code : '';
  if (!code.trim()) return fail(400, 'コードが空です');
  if (new TextEncoder().encode(code).length > MAX_CODE) return fail(413, 'アプリが大きすぎます (64kB まで)');
  const name = meta(code, 'name', MAX_NAME);
  if (!name) return fail(400, '先頭に // @name 名前 を書いてください');
  if (!/\bfunction\s+draw\s*\(|\bdraw\s*=/.test(code)) return fail(400, 'draw() がありません');

  const now = Math.floor(Date.now() / 1000);
  const today = await env.DB.prepare('SELECT count(*) AS n FROM posts WHERE created_at > ?1').bind(now - 86400).first();
  if (today.n >= DAILY_POSTS) return fail(429, 'きょうの投稿数が上限に達しました。あしたまたどうぞ');

  const codeHash = await sha256(code);
  const same = await env.DB.prepare('SELECT id FROM posts WHERE code_hash = ?1').bind(codeHash).first();
  if (same) return fail(409, '同じ内容のアプリがすでに投稿されています');

  const id = randomId(8), deleteKey = randomId(24);
  await env.DB.prepare('INSERT INTO posts (id, name, description, code, code_hash, delete_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(id, name, meta(code, 'description', MAX_DESC), code, codeHash, await sha256(deleteKey), now).run();
  return json({ id, name, deleteKey }, 201);
}

async function deletePost(env, request, table, id) {
  if (await limited(env, request, 'delete')) return fail(429, '少し待ってからもう一度どうぞ');
  const key = (/^Bearer\s+(\S+)$/.exec(request.headers.get('authorization') || '') || [])[1] || '';
  if (!key) return fail(401, '削除キーが必要です');
  const row = await env.DB.prepare(`SELECT delete_hash FROM ${table} WHERE id = ?1`).bind(id).first();
  if (!row) return fail(404, '見つかりません');
  const admin = env.ADMIN_TOKEN && sameText(key, env.ADMIN_TOKEN);
  if (!admin && !sameText(await sha256(key), row.delete_hash)) return fail(403, '削除キーが違います');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM reports WHERE post_id = ?1').bind(id),
    env.DB.prepare(`DELETE FROM ${table} WHERE id = ?1`).bind(id),
  ]);
  return json({ deleted: id });
}

async function reportPost(env, request, table, id) {
  if (await limited(env, request, 'report:' + id)) return fail(429, '少し待ってからもう一度どうぞ');
  if (!(await env.DB.prepare(`SELECT 1 FROM ${table} WHERE id = ?1`).bind(id).first())) return fail(404, '見つかりません');
  // 同じ人が何度押しても 1 件。IP そのものは残さず、秘密の値を混ぜたハッシュだけを覚える。
  const who = await sha256(`${id}:${clientIp(env, request)}:${env.ADMIN_TOKEN || ''}`);
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO reports (post_id, who) VALUES (?1, ?2)').bind(id, who),
    env.DB.prepare(`UPDATE ${table} SET reports = (SELECT count(*) FROM reports WHERE post_id = ?1) WHERE id = ?1`).bind(id),
  ]);
  return json({ reported: id });
}

async function listThemes(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, colors, created_at FROM themes WHERE reports < ?1 ORDER BY created_at DESC LIMIT ?2',
  ).bind(HIDE_AT, LIST_LIMIT).all();
  return json({ themes: results.map(r => ({ ...r, colors: r.colors.split(',') })) });
}

async function createTheme(env, request) {
  if (await limited(env, request, 'post')) return fail(429, '投稿が続いています。少し待ってからもう一度どうぞ');
  let body;
  try { body = await request.json(); } catch (e) { return fail(400, '形式が正しくありません'); }
  const name = (body && typeof body.name === 'string' ? body.name : '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_THEME_NAME);
  if (!name) return fail(400, '配色の名前を入れてください');
  const colors = body && Array.isArray(body.colors) ? body.colors : [];
  if (colors.length !== 6 || !colors.every(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))) return fail(400, '色は "#rrggbb" を 6 つ指定してください');
  const text = colors.join(',').toLowerCase();

  const now = Math.floor(Date.now() / 1000);
  const today = await env.DB.prepare('SELECT count(*) AS n FROM themes WHERE created_at > ?1').bind(now - 86400).first();
  if (today.n >= DAILY_POSTS) return fail(429, 'きょうの投稿数が上限に達しました。あしたまたどうぞ');
  if (await env.DB.prepare('SELECT id FROM themes WHERE colors = ?1').bind(text).first()) return fail(409, '同じ配色がすでに投稿されています');

  const id = randomId(8), deleteKey = randomId(24);
  await env.DB.prepare('INSERT INTO themes (id, name, colors, delete_hash, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(id, name, text, await sha256(deleteKey), now).run();
  return json({ id, name, colors: text.split(','), deleteKey }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // ほかのサイトのページから勝手に投稿・削除されないようにする (ブラウザは Origin を付けてくる)
    const origin = request.headers.get('origin');
    if (request.method !== 'GET' && origin && origin !== url.origin) return fail(403, 'このサイトからのみ使えます');
    try {
      if (url.pathname === '/api/generate') return await generate(env, request, { json, fail, limited, clientIp });
      const m = /^\/api\/(apps|themes)(?:\/([0-9a-f]{16})(\/report)?)?$/.exec(url.pathname);
      if (!m) return fail(404, '見つかりません');
      const [, what, id, report] = m, table = what === 'apps' ? 'posts' : 'themes';
      if (!id && request.method === 'GET') return await (what === 'apps' ? listPosts(env) : listThemes(env));
      if (!id && request.method === 'POST') return await (what === 'apps' ? createPost(env, request) : createTheme(env, request));
      if (id && !report && request.method === 'GET' && what === 'apps') return await getPost(env, id);
      if (id && !report && request.method === 'DELETE') return await deletePost(env, request, table, id);
      if (id && report && request.method === 'POST') return await reportPost(env, request, table, id);
      return fail(405, 'その操作はできません');
    } catch (e) {
      console.error(e);
      return fail(500, 'サーバーでエラーが起きました');
    }
  },
};
