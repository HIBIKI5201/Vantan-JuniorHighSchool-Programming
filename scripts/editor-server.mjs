// 授業資料を書くためのエディタ(/editor)を、npm run dev の中だけで動かすためのプラグイン。
//
// なぜAstroのページ(src/pages/editor.astro)にしないのか:
//   - ファイルを保存するAPIが必要だが、このサイトは静的ビルド(GitHub Pages)なので
//     Astroのエンドポイントでは書き込みができない。
//   - エディタは講師の手元だけで使うものなので、公開サイト(dist/)に混ざってほしくない。
// Viteのdevサーバーにミドルウェアとして差し込むと、この2つが同時に解決する。
// configureServerはdevサーバーの時しか呼ばれないので、npm run build の成果物には一切入らない。
//
// 入口:
//   http://localhost:4321/editor/       エディタ本体(editor/ 以下のファイルをそのまま配信)
//   http://localhost:4321/__editor/api  読み書き用のAPI
//
// 画面側のコードは editor/ にある(editor/index.html, editor/editor.js, editor/md-blocks.js)。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const COURSES_DIR = path.join(REPO_ROOT, 'src', 'content', 'courses');
const PUBLIC_LESSONS_DIR = path.join(REPO_ROOT, 'public', 'lessons');
const EDITOR_DIR = path.join(REPO_ROOT, 'editor');

const API_PREFIX = '/__editor/api/';

// 受け取ったcourseSlug/回数をそのままパスに混ぜると、リポジトリの外のファイルを
// 読み書きできてしまう。形が合っているものだけ通す。
const SLUG_RE = /^[a-z0-9-]+$/;
const NN_RE = /^\d{2}$/;

function assertSlug(slug) {
  if (typeof slug !== 'string' || !SLUG_RE.test(slug)) throw new Error(`courseSlugが不正です: ${slug}`);
  return slug;
}

function assertNn(nn) {
  const value = String(nn ?? '');
  if (!NN_RE.test(value)) throw new Error(`回数(2桁)が不正です: ${nn}`);
  return value;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// ---------------------------------------------------------------- frontmatter

// 一覧表示に必要な項目だけ取り出す簡易版。
// 本文のパース(ブロック化)は画面側の editor/md-blocks.js がやる。
function readFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!hit) continue;
    let value = hit[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    out[hit[1]] = value;
  }
  return out;
}

// ---------------------------------------------------------------- 一覧を作る

function listCourses() {
  if (!fs.existsSync(COURSES_DIR)) return [];
  const courses = [];
  for (const file of fs.readdirSync(COURSES_DIR)) {
    if (!file.endsWith('.md')) continue;
    const slug = file.replace(/\.md$/, '');
    const fm = readFrontmatter(fs.readFileSync(path.join(COURSES_DIR, file), 'utf8'));
    courses.push({
      slug,
      title: fm.title ?? slug,
      period: fm.period ?? '',
      dayOfWeek: fm.dayOfWeek ?? '',
      status: fm.status ?? 'complete',
      order: Number(fm.order ?? 0),
      lessons: listLessons(slug),
    });
  }
  // トップページと同じ並び(orderが大きいほど新しい)
  courses.sort((a, b) => b.order - a.order);
  return courses;
}

function listLessons(courseSlug) {
  const dir = path.join(LESSONS_DIR, courseSlug);
  if (!fs.existsSync(dir)) return [];
  const lessons = [];
  for (const file of fs.readdirSync(dir)) {
    const nn = file.match(/^(\d{2})\.md$/)?.[1];
    if (!nn) continue;
    const raw = fs.readFileSync(path.join(dir, file), 'utf8');
    const fm = readFrontmatter(raw);
    lessons.push({
      nn,
      order: Number(fm.order ?? Number(nn)),
      title: fm.title ?? `#${Number(nn)}`,
      status: fm.status ?? 'complete',
      shots: countShots(raw, courseSlug, nn),
    });
  }
  lessons.sort((a, b) => a.order - b.order);
  return lessons;
}

// 本文が参照している画像のうち、public/ に実体があるのは何枚か。
// 「スクショがあと何枚足りないか」を一覧に出すため(npm run check と同じ見方)。
function countShots(raw, courseSlug, nn) {
  const refs = [...raw.matchAll(/!\[[^\]]*\]\((\/lessons\/[^)\s]+)\)/g)].map((m) => m[1]);
  let ready = 0;
  for (const ref of refs) {
    const rel = decodeURIComponent(ref).split('/').filter(Boolean);
    if (fs.existsSync(path.join(REPO_ROOT, 'public', ...rel))) ready += 1;
  }
  return { total: refs.length, ready };
}

// Scratch wikiの用語一覧。エディタの用語ブロックの候補に出す。
function listWikiTerms() {
  const dir = path.join(LESSONS_DIR, 'scratch-wiki');
  if (!fs.existsSync(dir)) return [];
  const terms = [];
  for (const file of fs.readdirSync(dir)) {
    const nn = file.match(/^(\d{2})\.md$/)?.[1];
    if (!nn) continue;
    const fm = readFrontmatter(fs.readFileSync(path.join(dir, file), 'utf8'));
    if (!fm.title) continue;
    terms.push({
      nn,
      // "初期化（しょきか）" → wiki:初期化 でも引けるので、素の名前も候補に持たせる
      title: fm.title,
      plain: fm.title.replace(/（.*?）/g, '').trim(),
    });
  }
  terms.sort((a, b) => a.nn.localeCompare(b.nn));
  return terms;
}

// ---------------------------------------------------------------- 読み書き

function lessonPath(courseSlug, nn) {
  return path.join(LESSONS_DIR, assertSlug(courseSlug), `${assertNn(nn)}.md`);
}

function readLesson(courseSlug, nn) {
  const file = lessonPath(courseSlug, nn);
  if (!fs.existsSync(file)) throw new Error(`ファイルがありません: ${path.relative(REPO_ROOT, file)}`);
  const shotsDir = path.join(PUBLIC_LESSONS_DIR, courseSlug, assertNn(nn));
  const images = fs.existsSync(shotsDir)
    ? fs.readdirSync(shotsDir).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f)).sort()
    : [];
  return {
    course: courseSlug,
    nn: assertNn(nn),
    markdown: fs.readFileSync(file, 'utf8'),
    images,
    relPath: path.relative(REPO_ROOT, file).split(path.sep).join('/'),
  };
}

// 保存。書き手が消してしまった時に戻せるよう、直前の内容を .editor-backup/ に1つ残す。
function writeLesson(courseSlug, nn, markdown) {
  if (typeof markdown !== 'string' || !markdown.trim()) throw new Error('本文が空です');
  const file = lessonPath(courseSlug, nn);
  // 改行コードは元のファイルに合わせる。Windowsのチェックアウトでは手元のファイルが
  // CRLFになっていることがあり、LFで書き戻すと中身は同じなのにgitが「変更あり」と言い出す。
  let useCrlf = false;
  if (fs.existsSync(file)) {
    const previous = fs.readFileSync(file, 'utf8');
    useCrlf = previous.includes('\r\n');
    const backupDir = path.join(REPO_ROOT, '.editor-backup', courseSlug);
    fs.mkdirSync(backupDir, { recursive: true });
    fs.copyFileSync(file, path.join(backupDir, `${assertNn(nn)}.md.bak`));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const normalized = markdown.replace(/\r\n/g, '\n');
  fs.writeFileSync(file, useCrlf ? normalized.replace(/\n/g, '\r\n') : normalized);
  return { saved: path.relative(REPO_ROOT, file).split(path.sep).join('/') };
}

// 貼り付けた画像を public/lessons/<course>/<NN>/ に置く。
// 名前は既存の命名規則に合わせて image-0.png から順に埋めていく。
function saveImage(courseSlug, nn, dataUrl, preferredName) {
  assertSlug(courseSlug);
  assertNn(nn);
  const m = /^data:image\/(png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? '');
  if (!m) throw new Error('画像データの形式が読めません(png/jpeg/gif/webpのみ)');
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const dir = path.join(PUBLIC_LESSONS_DIR, courseSlug, nn);
  fs.mkdirSync(dir, { recursive: true });

  let name = preferredName;
  if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) {
    let i = 0;
    while (fs.existsSync(path.join(dir, `image-${i}.${ext}`))) i += 1;
    name = `image-${i}.${ext}`;
  }
  fs.writeFileSync(path.join(dir, name), Buffer.from(m[2], 'base64'));
  return { name, url: `/lessons/${courseSlug}/${nn}/${name}` };
}

// npm run check / new-lesson をエディタのボタンから回せるようにする。
// 書き手にターミナルを触らせないため。
function runNodeScript(scriptName, args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(REPO_ROOT, 'scripts', scriptName), ...args], {
      cwd: REPO_ROOT,
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, output: out }));
    child.on('error', (err) => resolve({ code: 1, output: String(err) }));
  });
}

// ---------------------------------------------------------------- HTTP

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    // 貼り付けた画像がbase64で来るので、上限は大きめに取る
    const LIMIT = 24 * 1024 * 1024;
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > LIMIT) reject(new Error('リクエストが大きすぎます'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('JSONとして読めませんでした'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// editor/ 以下のファイルをそのまま返す。
function serveEditorFile(res, relative) {
  const target = path.join(EDITOR_DIR, relative === '' ? 'index.html' : relative);
  // editor/ の外に出ていないことを確認する
  if (!target.startsWith(EDITOR_DIR) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('見つかりません');
    return;
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(target)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(fs.readFileSync(target));
}

async function handleApi(action, req, res) {
  const url = new URL(req.url, 'http://localhost');

  if (action === 'tree' && req.method === 'GET') {
    return sendJson(res, 200, { courses: listCourses(), wikiTerms: listWikiTerms() });
  }

  if (action === 'lesson' && req.method === 'GET') {
    const course = url.searchParams.get('course');
    const nn = url.searchParams.get('nn');
    return sendJson(res, 200, readLesson(assertSlug(course), assertNn(nn)));
  }

  if (action === 'lesson' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, writeLesson(assertSlug(body.course), assertNn(body.nn), body.markdown));
  }

  if (action === 'image' && req.method === 'POST') {
    const body = await readBody(req);
    return sendJson(res, 200, saveImage(body.course, body.nn, body.dataUrl, body.name));
  }

  if (action === 'check' && req.method === 'POST') {
    return sendJson(res, 200, await runNodeScript('check-lessons.mjs', []));
  }

  if (action === 'new-lesson' && req.method === 'POST') {
    const body = await readBody(req);
    const args = [assertSlug(body.course), String(Number(body.order)), String(body.title ?? '')];
    if (body.steps) args.push(String(Number(body.steps)));
    const result = await runNodeScript('new-lesson.mjs', args);
    return sendJson(res, result.code === 0 ? 200 : 400, result);
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('そのAPIはありません');
}

/**
 * Astroのintegrationとして astro.config.mjs に足す。
 * devサーバーの時だけ /editor と /__editor/api/* を引き受ける。
 */
export function editorServer() {
  return {
    name: 'lesson-editor',
    hooks: {
      'astro:config:setup': ({ updateConfig, logger }) => {
        // Viteプラグインとして差し込む。astro:server:setup で登録するとAstro自身の
        // ルーティングより後ろに並び、/editor がAstroの404に取られてしまうため。
        // configureServer を return せずに書くと、Astroのミドルウェアより先に通る。
        updateConfig({
          vite: {
            plugins: [
              {
                name: 'lesson-editor-middleware',
                apply: 'serve',
                configureServer(server) {
                  attachEditorRoutes(server, logger);
                },
              },
            ],
          },
        });
      },
    },
  };
}

function attachEditorRoutes(server, logger) {
  const handle = async (req, res, next) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    // baseが付いた形(/Vantan-.../editor)でも来られるようにしておく
    const local = pathname.replace(/^\/Vantan-JuniorHighSchool-Programming/, '') || '/';

    if (local.startsWith(API_PREFIX)) {
      const action = local.slice(API_PREFIX.length).replace(/\/$/, '');
      try {
        await handleApi(action, req, res);
      } catch (err) {
        logger.warn(`[editor] ${err.message}`);
        sendJson(res, 400, { error: err.message });
      }
      return;
    }

    if (local === '/editor' || local === '/editor/') {
      return serveEditorFile(res, 'index.html');
    }
    if (local.startsWith('/editor/')) {
      return serveEditorFile(res, local.slice('/editor/'.length));
    }

    next();
  };

  // ミドルウェアの列の先頭に入れる。普通に use() で足すと、HTMLを求めるリクエストを
  // Astro自身のハンドラが先に取ってしまい、/editor がAstroの404になる
  // (curlでは通るのにブラウザでは404、という分かりにくい状態になった)。
  server.middlewares.use(handle);
  server.middlewares.stack.unshift(server.middlewares.stack.pop());

  logger.info('✏️  授業資料エディタ: http://localhost:4321/editor/');
}
