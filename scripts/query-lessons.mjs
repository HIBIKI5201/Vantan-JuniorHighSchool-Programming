// 授業資料の索引(SQLite)を検索するスクリプト。実行のたびに索引を作り直すので、常に最新のMarkdownが対象。
//
//   npm run q                       → 用意してある検索の一覧
//   npm run q -- missing-shots      → 名前付きの検索を実行
//   npm run q -- term クローン       → 引数つきの検索
//   npm run q -- "SELECT * FROM lessons WHERE status = 'draft'"   → SQLをそのまま実行
//
// テーブルの中身は scripts/build-index.mjs の SCHEMA を参照。
// 索引は読むためだけのもの。資料を直す時はMarkdownの方を直すこと。

import { DatabaseSync } from 'node:sqlite';
import { buildIndex, INDEX_PATH } from './build-index.mjs';

// 名前付きの検索。? には コマンドの後ろに書いた引数が順に入る
const QUERIES = {
  status: {
    desc: 'まだ complete になっていない回(制作中・画像待ち)',
    sql: `
      SELECT l.id, l.title, l.status, l.note
      FROM lessons l
      WHERE l.status != 'complete' AND l.course != 'scratch-wiki'
      ORDER BY l.id`,
  },
  'missing-shots': {
    desc: 'スクショの実体がまだ無い画像枠(回ごとの枚数)',
    sql: `
      SELECT l.id, l.title, l.status, COUNT(*) AS missing,
             (SELECT COUNT(*) FROM images a WHERE a.lesson_id = l.id) AS total
      FROM images i JOIN lessons l ON l.id = i.lesson_id
      WHERE i.file_exists = 0
      GROUP BY l.id ORDER BY l.id`,
  },
  'missing-shots-detail': {
    args: '<回のid 例: suiyo-2026-7-9/06>',
    desc: 'その回で実体が無い画像枠を、行番号と見出しつきで出す',
    sql: `
      SELECT i.line_no, i.section, i.url
      FROM images i
      WHERE i.lesson_id = ? AND i.file_exists = 0
      ORDER BY i.line_no`,
  },
  'unused-images': {
    desc: 'public/lessons/ にあるのに、どの回からも参照されていない画像',
    sql: `
      SELECT p.url, p.bytes
      FROM public_images p
      WHERE p.url NOT IN (SELECT url FROM images)
      ORDER BY p.url`,
  },
  term: {
    args: '<用語>',
    desc: 'その用語にリンクしている回を、コースの並び順に出す(初めて教えた回が分かる)',
    sql: `
      SELECT l.id, l.title, COUNT(*) AS links, MIN(t.line_no) AS first_line
      FROM term_links t
      JOIN lessons l ON l.id = t.lesson_id
      JOIN wiki_terms w ON w.wiki_order = t.wiki_order
      WHERE ? IN (w.title, w.short)
      GROUP BY l.id
      ORDER BY l.course, l.lesson_order`,
  },
  terms: {
    desc: 'Scratch wikiの用語ごとに、リンクしている回の数(0の用語はどこからも使われていない)',
    sql: `
      SELECT w.wiki_order, w.title,
             COUNT(DISTINCT t.lesson_id) AS lessons, COUNT(t.lesson_id) AS links
      FROM wiki_terms w LEFT JOIN term_links t ON t.wiki_order = w.wiki_order
      GROUP BY w.wiki_order
      ORDER BY lessons DESC, w.wiki_order`,
  },
  'broken-terms': {
    desc: 'Scratch wikiのページに解決できない用語リンク',
    sql: `
      SELECT t.lesson_id, t.line_no, t.label, t.target
      FROM term_links t WHERE t.wiki_order IS NULL
      ORDER BY t.lesson_id, t.line_no`,
  },
  search: {
    args: '<言葉>',
    desc: '本文にその言葉が出てくる行を探す',
    sql: `
      SELECT ln.lesson_id, ln.line_no, ln.section, ln.text
      FROM lines ln
      WHERE ln.text LIKE '%' || ? || '%'
      ORDER BY ln.lesson_id, ln.line_no`,
  },
  goals: {
    args: '[コースのslug]',
    desc: '各回の「目標」の一覧(コースを指定するとそのコースだけ)',
    sql: `
      SELECT g.lesson_id, l.title, g.text
      FROM goals g JOIN lessons l ON l.id = g.lesson_id
      WHERE ? IS NULL OR l.course = ?
      ORDER BY l.course, l.lesson_order, g.line_no`,
    optionalArgs: true, // 引数を省略できる(SQLの ? 2つに同じ値を入れる)
  },
  links: {
    args: '[種類: scratch / forms / youtube / other]',
    desc: '本文中の外部リンク(種類を指定するとその種類だけ)',
    sql: `
      SELECT k.lesson_id, k.line_no, k.kind, k.url
      FROM links k
      WHERE ? IS NULL OR k.kind = ?
      ORDER BY k.lesson_id, k.line_no`,
    optionalArgs: true, // 引数を省略できる(SQLの ? 2つに同じ値を入れる)
  },
  courses: {
    desc: 'コースごとの回数・状態・スクショの枚数',
    sql: `
      SELECT c.slug, c.title, c.period, c.status,
             COUNT(DISTINCT l.id) AS lessons,
             SUM(l.status = 'draft') AS drafts,
             (SELECT COUNT(*) FROM images i JOIN lessons x ON x.id = i.lesson_id WHERE x.course = c.slug) AS images
      FROM courses c LEFT JOIN lessons l ON l.course = c.slug
      GROUP BY c.slug
      ORDER BY c.sort_order DESC`,
  },
  tables: {
    desc: '索引にあるテーブルと列の一覧(自分でSQLを書く時に)',
    sql: `
      SELECT m.name AS "table", p.name AS "column", p.type
      FROM sqlite_master m JOIN pragma_table_info(m.name) p
      WHERE m.type = 'table'
      ORDER BY m.name, p.cid`,
  },
};

// ---- 表の形で出す(全角は2文字分として幅をそろえる) ------------------------

const width = (s) => [...s].reduce((n, ch) => n + (/[ᄀ-￿]/.test(ch) ? 2 : 1), 0);
const MAX_COL = 60;

function truncate(s) {
  if (width(s) <= MAX_COL) return s;
  let out = '';
  for (const ch of s) {
    if (width(out + ch) > MAX_COL - 1) break;
    out += ch;
  }
  return out + '…';
}

function printRows(rows) {
  if (!rows.length) {
    console.log('(該当なし)');
    return;
  }
  const cols = Object.keys(rows[0]);
  const cells = rows.map((r) => cols.map((c) => truncate(r[c] === null ? '' : String(r[c]))));
  const widths = cols.map((c, i) => Math.max(width(c), ...cells.map((row) => width(row[i]))));
  const pad = (s, w) => s + ' '.repeat(w - width(s));
  const line = (row) => row.map((s, i) => pad(s, widths[i])).join('  ').trimEnd();
  console.log(line(cols));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of cells) console.log(line(row));
  console.log(`\n${rows.length}件`);
}

function printHelp() {
  console.log('使い方: npm run q -- <検索の名前> [引数]   または   npm run q -- "SELECT ..."\n');
  const names = Object.keys(QUERIES);
  const w = Math.max(...names.map((n) => width(`${n} ${QUERIES[n].args ?? ''}`)));
  for (const name of names) {
    const head = `${name} ${QUERIES[name].args ?? ''}`.trimEnd();
    console.log(`  ${head}${' '.repeat(w - width(head))}  ${QUERIES[name].desc}`);
  }
}

// ---- 実行 -------------------------------------------------------------------

const [first, ...rest] = process.argv.slice(2);
if (!first || first === '--help' || first === '-h') {
  printHelp();
  process.exit(0);
}

buildIndex();
const db = new DatabaseSync(INDEX_PATH, { readOnly: true });

try {
  const named = QUERIES[first];
  if (named) {
    const params = named.optionalArgs ? [rest[0] ?? null, rest[0] ?? null] : rest;
    printRows(db.prepare(named.sql).all(...params));
  } else if (/^\s*(SELECT|WITH|PRAGMA)\b/i.test(first)) {
    printRows(db.prepare([first, ...rest].join(' ')).all());
  } else {
    console.log(`「${first}」という検索はありません。\n`);
    printHelp();
    process.exitCode = 1;
  }
} catch (e) {
  console.error(`SQLのエラー: ${e.message}`);
  process.exitCode = 1;
} finally {
  db.close();
}
