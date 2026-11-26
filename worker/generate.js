// AI にミニアプリや配色を作ってもらう API。OpenRouter を経由して呼ぶ。
//
//   GET  /api/generate   使えるかどうか { available }
//   POST /api/generate   { kind: "app", prompt, code?, error? }  →  { code }
//                        { kind: "theme", prompt }               →  { colors: ["#rrggbb" x 6] }
//
// API キーは Worker の秘密情報 (OPENROUTER_API_KEY) にだけ置く。訪問者の入力でお金がかかるので、
// 入力の長さ・出力の長さ・1 人あたりの回数・サイト全体の回数をここで縛る。キー側にも上限額がある。
import { APP_SYSTEM, THEME_SYSTEM } from './prompt.js';

const DEFAULT_MODEL = 'deepseek/deepseek-v4.1-flash';
const MAX_PROMPT = 400;          // 頼む文章の長さ (文字)
const MAX_CODE = 24 * 1024;      // 「いまのコードを変える」で渡せるコードの大きさ
const MAX_ERROR = 300;
const MAX_TOKENS = { app: 12000, theme: 600 };  // 出力の上限。アプリは 1000 前後で収まることが多いが、凝ったものに余裕を持たせる
const DAILY_PER_PERSON = 50;     // 同じ IP から 1 日に
const DAILY_TOTAL = 300;         // サイト全体で 1 日に
const TIMEOUT_MS = 90000;

const sha256 = async text =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');

// きょうの回数を 1 増やして、増やしたあとの数を返す
async function bump(env, day, who) {
  const row = await env.DB.prepare(
    'INSERT INTO usage (day, who, n) VALUES (?1, ?2, 1) ON CONFLICT (day, who) DO UPDATE SET n = n + 1 RETURNING n',
  ).bind(day, who).first();
  return row.n;
}

// AI の返事からコードブロックの中身を取り出す (ブロックが無ければ全体をコードとみなす)
export function extractCode(text) {
  const blocks = [...text.matchAll(/```[a-zA-Z]*\n([\s\S]*?)```/g)].map(m => m[1]);
  const open = /```[a-zA-Z]*\n([\s\S]*)$/.exec(text);  // 途中で切れて閉じていない場合
  const code = blocks.length ? blocks.sort((a, b) => b.length - a.length)[0] : open ? open[1] : text;
  return code.trim() + '\n';
}

export function extractColors(text) {
  const found = text.match(/#[0-9a-fA-F]{6}\b/g) || [];
  return found.length >= 6 ? found.slice(0, 6).map(c => c.toUpperCase()) : null;
}

async function askModel(env, kind, messages) {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      authorization: 'Bearer ' + env.OPENROUTER_API_KEY,
      'content-type': 'application/json',
      'http-referer': 'https://github.com/LawrenceTurnerW/m5-stopwatch-face',
      'x-title': 'M5 StopWatch face',
    },
    body: JSON.stringify({
      model: env.GEN_MODEL || DEFAULT_MODEL,
      messages,
      max_tokens: MAX_TOKENS[kind],
      temperature: kind === 'theme' ? 0.9 : 0.4,
      reasoning: { enabled: false },  // 考える分で出力の枠を使い切ることがあったので切る (速くもなる)
      // 入力を学習に使う提供元には流さない。あとは安い順
      provider: { data_collection: 'deny', sort: 'price' },
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || !data.choices || !data.choices[0]) {
    console.error('openrouter', response.status, JSON.stringify(data && data.error || data).slice(0, 300));
    return { failed: response.status };
  }
  const text = String(data.choices[0].message.content || '');
  // 中身は記録しない。長さと終わり方、使ったトークン数だけ残す (うまく読み取れないときの手がかり)
  console.log('openrouter', kind, data.provider, data.choices[0].finish_reason, 'chars', text.length, JSON.stringify(data.usage || {}).slice(0, 200));
  return { text, cut: data.choices[0].finish_reason === 'length', usage: data.usage };
}

export async function generate(env, request, { json, fail, limited, clientIp }) {
  if (request.method === 'GET') return json({ available: !!env.OPENROUTER_API_KEY, perDay: DAILY_PER_PERSON });
  if (request.method !== 'POST') return fail(405, 'その操作はできません');
  if (!env.OPENROUTER_API_KEY) return fail(503, 'AI はいま使えません');
  if (await limited(env, request, 'generate')) return fail(429, '続けて頼みすぎです。少し待ってからもう一度どうぞ');

  let body;
  try { body = await request.json(); } catch (e) { return fail(400, '形式が正しくありません'); }
  const kind = body && body.kind;
  const text = v => (typeof v === 'string' ? v : '');
  const prompt = text(body && body.prompt).trim();
  if (kind !== 'app' && kind !== 'theme') return fail(400, '形式が正しくありません');
  if (!prompt) return fail(400, '作りたいものを書いてください');
  if (prompt.length > MAX_PROMPT) return fail(400, `長すぎます (${MAX_PROMPT} 文字まで)`);
  const code = kind === 'app' ? text(body.code) : '';
  if (new TextEncoder().encode(code).length > MAX_CODE) return fail(413, 'いまのコードが大きすぎて、AI に渡せません');
  const error = kind === 'app' ? text(body.error).slice(0, MAX_ERROR) : '';

  const day = new Date().toISOString().slice(0, 10);
  const who = await sha256(`${day}:${clientIp(env, request)}:${env.ADMIN_TOKEN || ''}`);
  if ((await bump(env, day, who)) > DAILY_PER_PERSON) return fail(429, `きょうの回数 (${DAILY_PER_PERSON} 回) を使い切りました。あしたまたどうぞ`);
  if ((await bump(env, day, '*')) > DAILY_TOTAL) return fail(429, 'きょうはサイト全体の上限に達しました。あしたまたどうぞ');

  const messages = [{ role: 'system', content: kind === 'app' ? APP_SYSTEM : THEME_SYSTEM }];
  if (code.trim()) {
    messages.push({ role: 'user', content: `いまのコードです。\n\`\`\`js\n${code}\n\`\`\`\n${error ? `\n実行すると次のエラーが出ます: ${error}\n` : ''}\nこのコードを次のように直して、全体を書き直してください: ${prompt}` });
  } else {
    messages.push({ role: 'user', content: kind === 'app' ? `次のアプリを作ってください: ${prompt}` : `次の雰囲気の配色を作ってください: ${prompt}` });
  }

  let answer;
  try { answer = await askModel(env, kind, messages); } catch (e) { console.error('openrouter', String(e)); answer = { failed: 0 }; }
  if (answer.failed !== undefined) return fail(answer.failed === 402 ? 503 : 502, answer.failed === 402 ? 'AI の利用枠を使い切りました。管理者が補充するまで使えません' : 'AI から返事をもらえませんでした。もう一度試してください');

  if (kind === 'theme') {
    const colors = extractColors(answer.text);
    return colors ? json({ colors }) : fail(502, 'AI の返事から色を読み取れませんでした。もう一度試してください');
  }
  const out = extractCode(answer.text);
  if (!/\bdraw\b/.test(out)) return fail(502, 'AI の返事からアプリを読み取れませんでした。もう一度試してください');
  return json({ code: out, cut: answer.cut });
}
