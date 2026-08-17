// 授業資料が docs/content-notation.md のルールから外れていないかを機械的に調べるスクリプト。
//
//   node scripts/check-lessons.mjs
//
// 見るところ:
//   [エラー]  frontmatterの不足 / course名やorderとファイル名の食い違い
//   [エラー]  wiki:用語 が Scratch wiki のページに解決できない
//   [エラー]  status: complete なのにスクショが足りない
//   [警告]    スクショ待ちの枚数(status: partial の間は正常なので警告どまり)
//   [警告]    用語リンクのページ番号直書き / 「◯◯とは：」の前置き
//   [警告]    手順の見出し(###)に画像やasideが無い
//   [警告]    asideの閉じ忘れ
//   [情報]    public/ にあるのに本文から参照されていない画像
//
// エラーが1件でもあれば終了コード1を返すので、そのままCIにも掛けられる。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const COURSES_DIR = path.join(REPO_ROOT, 'src', 'content', 'courses');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

const errors = [];
const warnings = [];
const infos = [];

const rel = (p) => path.relative(REPO_ROOT, p).split(path.sep).join('/');
const err = (file, line, msg) => errors.push({ file, line, msg });
const warn = (file, line, msg) => warnings.push({ file, line, msg });
const info = (file, line, msg) => infos.push({ file, line, msg });

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

// ---- Scratch wiki の用語一覧を作る ----------------------------------------

const wikiTerms = new Set();
const wikiDir = path.join(LESSONS_DIR, 'scratch-wiki');
if (fs.existsSync(wikiDir)) {
  for (const file of fs.readdirSync(wikiDir)) {
    if (!/^\d{2}\.md$/.test(file)) continue;
    const raw = fs.readFileSync(path.join(wikiDir, file), 'utf8');
    const title = parseFrontmatter(raw)?.title;
    if (!title) continue;
    wikiTerms.add(title);
    const stripped = title.replace(/（.*?）/g, '').trim();
    if (stripped) wikiTerms.add(stripped);
  }
}

// ---- コース一覧 -------------------------------------------------------------

const courseSlugs = new Set(
  fs.existsSync(COURSES_DIR)
    ? fs.readdirSync(COURSES_DIR).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
    : []
);

// ---- レッスンを1ファイルずつ調べる ------------------------------------------

const referencedImages = new Set();
let lessonCount = 0;
let pendingShots = 0;

for (const courseSlug of fs.readdirSync(LESSONS_DIR)) {
  const dir = path.join(LESSONS_DIR, courseSlug);
  if (!fs.statSync(dir).isDirectory()) continue;

  if (!courseSlugs.has(courseSlug)) {
    err(rel(dir), 0, `src/content/courses/${courseSlug}.md がありません`);
  }

  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith('.md')) continue;
    const filePath = path.join(dir, file);
    const fileRel = rel(filePath);
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    lessonCount += 1;

    // --- frontmatter ---
    const fm = parseFrontmatter(raw);
    if (!fm) {
      err(fileRel, 1, 'frontmatterがありません');
      continue;
    }
    for (const key of ['course', 'order', 'title', 'status']) {
      if (fm[key] === undefined) err(fileRel, 1, `frontmatterに ${key} がありません`);
    }
    if (fm.course && fm.course !== courseSlug) {
      err(fileRel, 1, `course が "${fm.course}" ですが、フォルダは "${courseSlug}" です`);
    }
    const nnFromName = file.match(/^(\d{2})\.md$/)?.[1];
    if (!nnFromName) {
      err(fileRel, 1, 'ファイル名は "00.md" のような2桁ゼロ埋めにしてください');
    } else if (fm.order !== undefined && Number(fm.order) !== Number(nnFromName)) {
      err(fileRel, 1, `order(${fm.order}) とファイル名(${nnFromName}) が合っていません`);
    }
    if (fm.status && !['complete', 'partial'].includes(fm.status)) {
      err(fileRel, 1, `status は complete か partial にしてください: "${fm.status}"`);
    }

    // --- 本文を1行ずつ ---
    let missingShots = 0;
    let totalShots = 0;
    let asideDepth = 0;
    const headingLines = [];

    lines.forEach((line, i) => {
      const lineNo = i + 1;

      if (/^###\s+/.test(line)) headingLines.push({ lineNo, index: i });
      if (/<aside>/.test(line)) asideDepth += 1;
      if (/<\/aside>/.test(line)) asideDepth -= 1;

      // 画像
      for (const m of line.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
        const url = m[1];
        if (!url.startsWith('/lessons/')) continue;
        totalShots += 1;
        referencedImages.add(decodeURIComponent(url));
        const abs = path.join(PUBLIC_DIR, ...decodeURIComponent(url).split('/').filter(Boolean));
        if (!fs.existsSync(abs)) missingShots += 1;
      }

      // 用語リンク
      for (const m of line.matchAll(/\[([^\]]*)\]\(wiki:([^)]+)\)/g)) {
        if (!wikiTerms.has(m[2].trim())) {
          err(fileRel, lineNo, `wiki:${m[2]} に対応するScratch wikiのページがありません`);
        }
      }
      if (/\]\(\/courses\/scratch-wiki\/\d{2}\/\)/.test(line)) {
        warn(fileRel, lineNo, '用語リンクはページ番号直書きではなく [用語](wiki:用語) で書いてください');
      }
      if (/^[^\[\n]*[：:]\s*\[[^\]]*\]\((wiki:|\/courses\/scratch-wiki\/)/.test(line)) {
        warn(fileRel, lineNo, '「◯◯とは：」の前置きは不要です(用語カードとして表示されます)');
      }
    });

    if (asideDepth !== 0) {
      warn(fileRel, 0, `<aside> の開き閉じが合っていません (差: ${asideDepth})`);
    }

    // 「やってみよう」の中の手順見出しだけ、画像とasideが揃っているかを見る。
    // 「覚えること」や「エクストラ課題」の見出しは説明だけのことが多いので対象にしない。
    const tryStart = lines.findIndex((l) => /^#{1,3}\s*やってみよう\s*$/.test(l));
    const tryEnd = lines.findIndex(
      (l, i) => i > tryStart && tryStart >= 0 && /^#{1,3}\s*(終わり|終了)/.test(l)
    );
    if (tryStart >= 0) {
      const limit = tryEnd >= 0 ? tryEnd : lines.length;
      for (const h of headingLines) {
        if (h.index < tryStart || h.index >= limit) continue;
        // 次の見出しが来るまでを、その手順のかたまりとして見る
        let end = h.index + 1;
        while (end < limit && !/^#{1,6}\s+/.test(lines[end])) end += 1;
        const chunk = lines.slice(h.index + 1, end).join('\n');
        if (!/!\[/.test(chunk)) {
          warn(fileRel, h.lineNo, '手順の見出しにスクショの画像がありません');
        } else if (!/<aside>/.test(chunk)) {
          warn(fileRel, h.lineNo, '手順の見出しにasideの説明がありません');
        }
      }
    }

    if (missingShots > 0) {
      pendingShots += missingShots;
      if (fm.status === 'complete') {
        err(fileRel, 0, `status: complete ですがスクショが ${missingShots}/${totalShots} 枚足りません`);
      } else {
        warn(fileRel, 0, `スクショ待ち ${missingShots}/${totalShots} 枚`);
      }
    } else if (totalShots > 0 && fm.status === 'partial') {
      warn(fileRel, 0, `スクショは全部揃っています。status を complete にできます`);
    }
  }
}

// ---- public/ にあるのに使われていない画像 -----------------------------------

function walkPublicLessons(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walkPublicLessons(p);
    else {
      const url = '/' + path.relative(PUBLIC_DIR, p).split(path.sep).join('/');
      if (!referencedImages.has(url)) info('public', 0, `本文から参照されていません: ${url}`);
    }
  }
}
walkPublicLessons(path.join(PUBLIC_DIR, 'lessons'));

// ---- 結果を出す -------------------------------------------------------------

const show = (label, list) => {
  if (!list.length) return;
  console.log(`\n${label} (${list.length}件)`);
  for (const item of list) {
    const where = item.line ? `${item.file}:${item.line}` : item.file;
    console.log(`  ${where}\n    ${item.msg}`);
  }
};

console.log(`レッスン ${lessonCount}件 / Scratch wiki 用語 ${wikiTerms.size}個 を確認しました。`);
show('エラー', errors);
show('警告', warnings);
if (infos.length) console.log(`\n情報 (${infos.length}件) — 使われていない画像があります(--verboseで一覧)`);
if (process.argv.includes('--verbose')) show('情報', infos);

console.log('');
if (errors.length) {
  console.log(`❌ エラー ${errors.length}件。直してから公開してください。`);
  process.exit(1);
}
console.log(`✅ エラーなし (警告 ${warnings.length}件 / スクショ待ち ${pendingShots}枚)`);
