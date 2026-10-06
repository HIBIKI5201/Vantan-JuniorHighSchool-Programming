// 授業資料(Markdown)から、検索・管理用のSQLite索引を作るスクリプト。
//
//   npm run index        → .index/lessons.db を作り直す
//
// Markdownが元データ(製本)で、このDBはそこから毎回作り直す「索引」にすぎない。
// DBに書き込んでもMarkdownには戻らないので、直す時は必ずMarkdownの方を直すこと。
// .index/ は .gitignore 済み。消しても次の実行でまた作られる。
//
// 検索は scripts/query-lessons.mjs (npm run q) から行う。テーブルの中身は下の SCHEMA を参照。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const COURSES_DIR = path.join(REPO_ROOT, 'src', 'content', 'courses');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');
export const INDEX_PATH = path.join(REPO_ROOT, '.index', 'lessons.db');

const SCHEMA = `
-- コース1件 = src/content/courses/<slug>.md 1ファイル
CREATE TABLE courses (
  slug        TEXT PRIMARY KEY,   -- 例: suiyo-2026-7-9
  title       TEXT,               -- 例: 水曜日ゲーム
  period      TEXT,               -- 例: 2026 7~9月
  day_of_week TEXT,
  sort_order  INTEGER,            -- トップページでの並び順(frontmatterのorder)
  status      TEXT,
  note        TEXT
);

-- 授業回1件 = src/content/lessons/<course>/<NN>.md 1ファイル
CREATE TABLE lessons (
  id           TEXT PRIMARY KEY,  -- 例: suiyo-2026-7-9/02
  course       TEXT REFERENCES courses(slug),
  lesson_order INTEGER,           -- #0, #1, #2...
  title        TEXT,
  status       TEXT,              -- complete / partial / draft
  session_date TEXT,              -- 本文の「授業日:」の行(無ければNULL)
  note         TEXT,
  file         TEXT,              -- リポジトリからの相対パス
  line_count   INTEGER,
  char_count   INTEGER
);

-- 見出し(# 〜 ######)
CREATE TABLE headings (
  lesson_id TEXT REFERENCES lessons(id),
  line_no   INTEGER,
  level     INTEGER,
  text      TEXT
);

-- 本文の全行。全文検索(LIKE)と、どの見出しの下にあるかを引くために持つ
CREATE TABLE lines (
  lesson_id TEXT REFERENCES lessons(id),
  line_no   INTEGER,
  section   TEXT,                 -- 直前の見出しの文字列
  text      TEXT
);

-- [表示](wiki:用語) の用語リンク
CREATE TABLE term_links (
  lesson_id  TEXT REFERENCES lessons(id),
  line_no    INTEGER,
  section    TEXT,
  label      TEXT,                -- リンクの表示文字
  target     TEXT,                -- wiki: の後ろ
  wiki_order INTEGER              -- 解決できたScratch wikiページの番号(できなければNULL)
);

-- Scratch wiki の用語ページ(lessons の scratch-wiki コースと同じもの)
CREATE TABLE wiki_terms (
  wiki_order INTEGER PRIMARY KEY,
  title      TEXT,                -- 例: 初期化（しょきか）
  short      TEXT                 -- 読みがなを外したもの。例: 初期化
);

-- 本文から参照している画像(/lessons/... のもの)
CREATE TABLE images (
  lesson_id TEXT REFERENCES lessons(id),
  line_no   INTEGER,
  section   TEXT,
  alt       TEXT,
  url       TEXT,
  file_exists INTEGER             -- public/ に実体があれば1
);

-- public/lessons/ にある画像ファイル(使われていない画像を探すため)
CREATE TABLE public_images (
  url   TEXT PRIMARY KEY,
  bytes INTEGER
);

-- 本文中の外部URL
CREATE TABLE links (
  lesson_id TEXT REFERENCES lessons(id),
  line_no   INTEGER,
  section   TEXT,
  url       TEXT,
  kind      TEXT                  -- scratch / forms / youtube / other
);

-- 「# 目標」の下の箇条書き
CREATE TABLE goals (
  lesson_id TEXT REFERENCES lessons(id),
  line_no   INTEGER,
  text      TEXT
);

CREATE INDEX idx_lines_lesson ON lines(lesson_id);
CREATE INDEX idx_term_target ON term_links(target);
CREATE INDEX idx_images_url ON images(url);
`;

// check-lessons.mjs と同じ読み方(Astro側のスキーマに出てくるのは単純な key: value だけ)
function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return null;
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    data[kv[1]] = value;
  }
  return data;
}

const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
const stripReading = (s) => s.replace(/（.*?）/g, '').trim();
const toInt = (v) => (v === undefined || v === '' ? null : Number(v));

function linkKind(url) {
  if (/scratch\.mit\.edu/.test(url)) return 'scratch';
  if (/forms\.gle|docs\.google\.com\/forms/.test(url)) return 'forms';
  if (/youtube\.com|youtu\.be/.test(url)) return 'youtube';
  return 'other';
}

function walkFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

export function buildIndex(dbPath = INDEX_PATH) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  // 作り直しの途中で失敗しても前の索引が残るように、一時ファイルに作ってから置き換える
  const tmpPath = `${dbPath}.tmp`;
  fs.rmSync(tmpPath, { force: true });
  const db = new DatabaseSync(tmpPath);
  db.exec(SCHEMA);
  db.exec('BEGIN');

  // ---- コース ----
  const insCourse = db.prepare('INSERT INTO courses VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const file of fs.readdirSync(COURSES_DIR).filter((f) => f.endsWith('.md')).sort()) {
    const fm = parseFrontmatter(fs.readFileSync(path.join(COURSES_DIR, file), 'utf8')) ?? {};
    insCourse.run(
      file.replace(/\.md$/, ''),
      fm.title ?? null,
      fm.period ?? null,
      fm.dayOfWeek ?? null,
      toInt(fm.order),
      fm.status ?? 'complete',
      fm.note ?? null
    );
  }

  // ---- Scratch wiki の用語 ----
  const insTerm = db.prepare('INSERT INTO wiki_terms VALUES (?, ?, ?)');
  const termToOrder = new Map();
  const wikiDir = path.join(LESSONS_DIR, 'scratch-wiki');
  for (const file of fs.existsSync(wikiDir) ? fs.readdirSync(wikiDir).sort() : []) {
    if (!/^\d{2}\.md$/.test(file)) continue;
    const title = parseFrontmatter(fs.readFileSync(path.join(wikiDir, file), 'utf8'))?.title;
    if (!title) continue;
    const order = Number(file.slice(0, 2));
    insTerm.run(order, title, stripReading(title));
    termToOrder.set(title, order);
    if (stripReading(title)) termToOrder.set(stripReading(title), order);
  }

  // ---- 授業回 ----
  const insLesson = db.prepare('INSERT INTO lessons VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const insHeading = db.prepare('INSERT INTO headings VALUES (?, ?, ?, ?)');
  const insLine = db.prepare('INSERT INTO lines VALUES (?, ?, ?, ?)');
  const insTermLink = db.prepare('INSERT INTO term_links VALUES (?, ?, ?, ?, ?, ?)');
  const insImage = db.prepare('INSERT INTO images VALUES (?, ?, ?, ?, ?, ?)');
  const insLink = db.prepare('INSERT INTO links VALUES (?, ?, ?, ?, ?)');
  const insGoal = db.prepare('INSERT INTO goals VALUES (?, ?, ?)');
  const setSessionDate = db.prepare('UPDATE lessons SET session_date = ? WHERE id = ?');

  let lessonCount = 0;
  for (const courseSlug of fs.readdirSync(LESSONS_DIR).sort()) {
    const dir = path.join(LESSONS_DIR, courseSlug);
    if (!fs.statSync(dir).isDirectory()) continue;

    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.md')) continue;
      const filePath = path.join(dir, file);
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw.split(/\r?\n/);
      const fm = parseFrontmatter(raw) ?? {};
      const id = `${courseSlug}/${file.replace(/\.md$/, '')}`;

      // frontmatterの終わりの行(本文はその次から)
      let bodyStart = 0;
      if (lines[0] === '---') {
        const close = lines.indexOf('---', 1);
        if (close > 0) bodyStart = close + 1;
      }

      // 行ごとのテーブルが外部キーで lessons を指すので、先に回の行を入れておく
      const body = lines.slice(bodyStart).join('\n');
      insLesson.run(
        id,
        fm.course ?? courseSlug,
        toInt(fm.order),
        fm.title ?? null,
        fm.status ?? 'complete',
        fm.sessionDate ?? null,
        fm.note ?? null,
        rel(filePath),
        lines.length,
        body.length
      );

      let sessionDate = null;
      let section = null;
      let inGoals = false;

      lines.forEach((line, i) => {
        if (i < bodyStart) return;
        const lineNo = i + 1;

        const h = line.match(/^(#{1,6})\s+(.*?)\s*$/);
        if (h) {
          section = h[2];
          insHeading.run(id, lineNo, h[1].length, h[2]);
          inGoals = h[1].length === 1 && /^目標$/.test(h[2]);
        } else if (inGoals) {
          const item = line.match(/^[-*]\s+(.*)$/);
          if (item) insGoal.run(id, lineNo, item[1].trim());
        }

        insLine.run(id, lineNo, section, line);

        const date = line.match(/^授業日[:：]\s*(.+)$/);
        if (date && !sessionDate) sessionDate = date[1].trim();

        for (const m of line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
          const url = decodeURIComponent(m[2]);
          if (!url.startsWith('/lessons/')) continue;
          const abs = path.join(PUBLIC_DIR, ...url.split('/').filter(Boolean));
          insImage.run(id, lineNo, section, m[1], url, fs.existsSync(abs) ? 1 : 0);
        }

        for (const m of line.matchAll(/\[([^\]]*)\]\(wiki:([^)]+)\)/g)) {
          const target = m[2].trim();
          const order = termToOrder.get(target) ?? termToOrder.get(stripReading(target)) ?? null;
          insTermLink.run(id, lineNo, section, m[1], target, order);
        }

        for (const m of line.matchAll(/https?:\/\/[^\s)<>"'`]+/g)) {
          insLink.run(id, lineNo, section, m[0], linkKind(m[0]));
        }
      });

      if (sessionDate) setSessionDate.run(sessionDate, id);
      lessonCount += 1;
    }
  }

  // ---- public/lessons/ の画像 ----
  const insPublic = db.prepare('INSERT INTO public_images VALUES (?, ?)');
  for (const p of walkFiles(path.join(PUBLIC_DIR, 'lessons'))) {
    insPublic.run('/' + path.relative(PUBLIC_DIR, p).split(path.sep).join('/'), fs.statSync(p).size);
  }

  db.exec('COMMIT');
  db.close();
  fs.renameSync(tmpPath, dbPath);
  return { lessonCount, termCount: termToOrder.size };
}

// npm run index で直接実行された時だけ動く(query-lessons.mjs からは関数として呼ぶ)
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { lessonCount } = buildIndex();
  console.log(`レッスン ${lessonCount}件の索引を作りました → ${rel(INDEX_PATH)}`);
}
