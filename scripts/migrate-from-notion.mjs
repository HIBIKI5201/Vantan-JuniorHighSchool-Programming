// Notionからエクスポートした「バンタン中等部」フォルダの中身を、
// src/content/courses・src/content/lessons・public/lessons に変換して取り込むスクリプト。
//
// 使い方:
//   1. Notionでコースのページ(例:「金曜ゲーム（金曜日, 2026 7~9月）」)を開く
//   2. 「•••」→ エクスポート → Markdown & CSV → 「サブページを含む」を必ずON にして書き出す
//   3. 展開したフォルダを、このリポジトリの _notion-source/ 以下に
//      Notion上のフォルダ名のまま置く(例: _notion-source/金曜ゲーム（金曜日, 2026 7~9月）/)
//   4. 下の COURSES 配列に、そのフォルダに対応するコース定義を追加する
//   5. `node scripts/migrate-from-notion.mjs` を実行する
//
// 注意: このスクリプトは既存の同名レッスンファイルを上書きします。
// 手動で書き足した内容(このリポジトリで直接書いたaside説明文など)がある場合は、
// 再実行前に git で差分を確認してください。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = path.join(REPO_ROOT, "_notion-source");
const LESSONS_DIR = path.join(REPO_ROOT, "src", "content", "lessons");
const COURSES_DIR = path.join(REPO_ROOT, "src", "content", "courses");
const PUBLIC_LESSONS_DIR = path.join(REPO_ROOT, "public", "lessons");

// ここに、_notion-source/ 以下にあるコースフォルダを追加していく。
// "#N タイトル.md" という命名のファイルが並ぶ、通常の週替わりレッスン用コースの定義。
const COURSES = [
  {
    srcFolder: "金曜ゲーム（金曜日, 2026 1~3月）",
    slug: "kinyo-2026-1-3",
    title: "金曜ゲーム",
    dayOfWeek: "金曜日",
    period: "2026 1~3月",
    order: 20,
  },
  {
    srcFolder: "火曜ゲーム（火曜日, 2026 1~3月）",
    slug: "kayo-2026-1-3",
    title: "火曜ゲーム",
    dayOfWeek: "火曜日",
    period: "2026 1~3月",
    order: 21,
  },
  {
    srcFolder: "金曜ゲーム（金曜日, 2026 4~6月）",
    slug: "kinyo-2026-4-6",
    title: "金曜ゲーム",
    dayOfWeek: "金曜日",
    period: "2026 4~6月",
    order: 22,
  },
  {
    srcFolder: "金曜ゲーム（金曜日, 2026 7~9月）",
    slug: "kinyo-2026-7-9",
    title: "金曜ゲーム",
    dayOfWeek: "金曜日",
    period: "2026 7~9月",
    order: 23,
  },
  {
    srcFolder: "水曜日ゲー（水金曜日, 2026 7~9月）",
    slug: "suiyo-2026-7-9",
    title: "水曜日ゲーム",
    dayOfWeek: "水曜日",
    period: "2026 7~9月",
    order: 24,
  },
  {
    srcFolder: "シューティングゲーム（金曜日, 2025 10~12月）",
    slug: "shooting-2025-10-12",
    title: "シューティングゲーム",
    dayOfWeek: "金曜日",
    period: "2025 10~12月",
    order: 5,
  },
  {
    srcFolder: "ブロック崩しゲーム（火曜日, 2025 10~12月）",
    slug: "block-kuzushi-2025-10-12",
    title: "ブロック崩しゲーム",
    dayOfWeek: "火曜日",
    period: "2025 10~12月",
    order: 6,
  },
];

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function yamlString(s) {
  return JSON.stringify(s);
}

function findSiblingImageDir(courseDir, baseName) {
  const candidate = path.join(courseDir, baseName);
  if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  return courseDir;
}

// 1レッスン分の.mdファイルを読み込み、画像をコピーしてパスを付け替え、
// 内部リンク(他ページへの.mdリンク)をテキストだけに変換してから書き出す。
function processLesson({ courseDir, filename, order, title, courseSlug, fileDirOverride }) {
  const readDir = fileDirOverride ?? courseDir;
  const raw = fs.readFileSync(path.join(readDir, filename), "utf8");
  const baseName = filename.replace(/ [0-9a-f]{32}\.md$/i, "");
  const imageDir = findSiblingImageDir(courseDir, baseName);
  const paddedOrder = String(order).padStart(2, "0");
  const destImgDir = path.join(PUBLIC_LESSONS_DIR, courseSlug, paddedOrder);

  const missing = [];
  let content = raw.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => {
    const decoded = decodeURIComponent(url);
    const originalFilename = path.basename(decoded);
    const newFilename = originalFilename.replace(/\s+/g, "-");
    // 通常は同名の隣接フォルダの画像を参照するが、Scratch wikiのように
    // 別コースの画像を "../他のフォルダ/画像.png" と相対参照している場合もあるので、
    // まずreadDir基準でその相対パスをそのまま解決してみる。
    const relativeResolved = path.resolve(readDir, decoded);
    const srcImgPath = fs.existsSync(relativeResolved) ? relativeResolved : path.join(imageDir, originalFilename);
    if (fs.existsSync(srcImgPath)) {
      ensureDir(destImgDir);
      fs.copyFileSync(srcImgPath, path.join(destImgDir, newFilename));
      return `![${alt}](/lessons/${courseSlug}/${paddedOrder}/${newFilename})`;
    }
    missing.push(originalFilename);
    return `*[画像が見つかりません: ${originalFilename}（元のNotionエクスポートに含まれていませんでした）]*`;
  });

  content = content.replace(/\[([^\]]+)\]\([^)]*\.md[^)]*\)/g, "$1");

  const frontmatter = `---\ncourse: ${yamlString(courseSlug)}\norder: ${order}\ntitle: ${yamlString(title)}\nstatus: complete\n---\n\n`;

  ensureDir(path.join(LESSONS_DIR, courseSlug));
  fs.writeFileSync(path.join(LESSONS_DIR, courseSlug, `${paddedOrder}.md`), frontmatter + content.trim() + "\n");

  if (missing.length) console.warn(`  [${courseSlug}/${paddedOrder}] 画像が見つかりません: ${missing.join(", ")}`);
}

function writeCourse({ slug, title, dayOfWeek, period, order, note }) {
  const fm = [
    "---",
    `title: ${yamlString(title)}`,
    `period: ${yamlString(period)}`,
    `dayOfWeek: ${yamlString(dayOfWeek)}`,
    `order: ${order}`,
    "status: complete",
    note ? `note: ${yamlString(note)}` : null,
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");
  ensureDir(COURSES_DIR);
  fs.writeFileSync(path.join(COURSES_DIR, `${slug}.md`), fm);
}

for (const c of COURSES) {
  const courseDir = path.join(SRC_ROOT, c.srcFolder);
  if (!fs.existsSync(courseDir)) {
    console.warn(`スキップ: ${c.srcFolder} が _notion-source/ に見つかりません`);
    continue;
  }
  const files = fs.readdirSync(courseDir).filter((f) => /^#\d+.*\.md$/.test(f));
  console.log(`=== ${c.title}${c.period} (${files.length} lessons) ===`);
  for (const filename of files) {
    const m = filename.match(/^#(\d+)\s+(.*?)( [0-9a-f]{32})?\.md$/i);
    const order = parseInt(m[1], 10);
    const title = `#${m[1]} ${m[2]}`;
    processLesson({ courseDir, filename, order, title, courseSlug: c.slug });
  }
  writeCourse(c);
}

// --- Scratch wiki: "#N" 形式ではない用語集。ファイルとタイトルを手動で対応付ける ---
const scratchWikiDir = path.join(SRC_ROOT, "Scratch wiki");
const scratchWikiLessons = [
  { file: "変数 3594374a1f76801e934ed0b504684459.md", order: 0, title: "変数" },
  { file: "条件 34c4374a1f7680e3bf36cc3b605067e4.md", order: 1, title: "条件" },
  { file: "初期化（しょきか） 2fe4374a1f7680de892fc2ca236095fd.md", order: 2, title: "初期化（しょきか）" },
  { file: "メッセージ 2fe4374a1f768078a60ecd253643decf.md", order: 3, title: "メッセージ" },
  { file: "インゲーム・アウトゲーム 3454374a1f76808bbb4cc392fdbd372b.md", order: 4, title: "インゲーム・アウトゲーム" },
];
if (fs.existsSync(scratchWikiDir)) {
  console.log(`=== Scratch wiki (${scratchWikiLessons.length} lessons) ===`);
  for (const l of scratchWikiLessons) {
    processLesson({ courseDir: scratchWikiDir, filename: l.file, order: l.order, title: l.title, courseSlug: "scratch-wiki" });
  }
  writeCourse({ slug: "scratch-wiki", title: "Scratch wiki", dayOfWeek: "-", period: "リファレンス資料", order: 1 });
} else {
  console.warn("スキップ: Scratch wiki が _notion-source/ に見つかりません");
}

console.log("完了");
