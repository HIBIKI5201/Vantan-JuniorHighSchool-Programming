// Astroプロジェクト全体の設定ファイル。
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

// GitHub Pagesは https://hibiki5201.github.io/Vantan-JuniorHighSchool-Programming/ のように
// リポジトリ名がパスに入る「プロジェクトページ」として公開される。
// レッスンのMarkdown本文中の画像パス(例: /lessons/xxx/image.png)や、Scratch wikiの用語ページへの
// サイト内リンク(例: /courses/scratch-wiki/00/)はビルド時にただの文字列なので、
// このプラグインでbaseを自動的に先頭へ付け足す(手作業で全ファイルを書き換えずに済むようにするため)。
const BASE = '/Vantan-JuniorHighSchool-Programming';

function remarkPrefixInternalUrls() {
  return (tree) => {
    visit(tree, ['image', 'link'], (node) => {
      if (node.url && node.url.startsWith('/') && !node.url.startsWith(BASE)) {
        node.url = BASE + node.url;
      }
    });
  };
}

// Scratch wikiの用語ページへのリンクを `[クローン](wiki:クローン)` と書けるようにする。
// `/courses/scratch-wiki/05/` のようにページ番号を手で書くと、用語を1つ足して番号がずれた時に
// 全レッスンのリンクを直す羽目になるので、用語名から番号を引くのはビルド時にやる。
// 対応する用語ページが見つからない場合はビルド時に警告を出し、リンクを外して文字だけ残す。
let wikiTermMapCache = null;

function getWikiTermMap() {
  if (wikiTermMapCache) return wikiTermMapCache;
  const map = new Map();
  const dir = path.join(LESSONS_DIR, 'scratch-wiki');
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const nn = file.match(/^(\d{2})\.md$/)?.[1];
      if (!nn) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const title = raw.match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1];
      if (!title) continue;
      // "初期化（しょきか）" のように読みガナ付きのタイトルでも "初期化" で引けるようにする
      const keys = new Set([title, title.replace(/（.*?）/g, '').trim()]);
      for (const key of keys) if (key) map.set(key, `/courses/scratch-wiki/${nn}/`);
    }
  }
  wikiTermMapCache = map;
  return map;
}

function remarkResolveWikiTerms() {
  return (tree, file) => {
    const map = getWikiTermMap();
    visit(tree, 'link', (node) => {
      if (!node.url?.startsWith('wiki:')) return;
      const term = node.url.slice('wiki:'.length).trim();
      const resolved = map.get(term);
      if (resolved) {
        node.url = resolved;
        return;
      }
      console.warn(
        `[wiki用語] "${term}" に対応するScratch wikiのページが見つかりません: ${file.path ?? ''}`
      );
      node.url = '';
      node.data = { ...node.data, hName: 'span' };
    });
  };
}

// 体験授業のハブページやScratch wikiのように、リンクの文字が本文中に手書きされている場合、
// リンク先のレッスンのtitleを後から変更すると、リンクの文字だけ古いままになってしまう
// (例: 04.mdのtitleを変えても、00.md内の"[2. 処理](/courses/taiken-jugyo/04/)"という
// 文字列は自動では変わらない)。これを防ぐため、/courses/<slug>/<NN>/ 形式の内部リンクは、
// リンク先レッスンファイルのtitleを読み取って、リンクの文字を毎回上書きする
// (BASEを付け足す前の、素のパスのうちに処理する必要があるので remarkPrefixInternalUrls より前に置く)。
function remarkSyncInternalLinkTitles() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      const m = node.url.match(/^\/courses\/([a-z0-9-]+)\/(\d{2})\/$/);
      if (!m) return;
      const [, courseSlug, nn] = m;
      const lessonFile = path.join(LESSONS_DIR, courseSlug, `${nn}.md`);
      if (!fs.existsSync(lessonFile)) return;
      const raw = fs.readFileSync(lessonFile, 'utf8');
      const titleMatch = raw.match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/m);
      if (!titleMatch) return;
      const title = titleMatch[1].replace(/\\"/g, '"');
      if (node.children?.length === 1 && node.children[0].type === 'text') {
        node.children[0].value = title;
      }
    });
  };
}

// レッスンを先に書いて、Scratchで作った完成品のスクリーンショットは後から撮って貼る、
// という進め方をするため、本文には最初から ![image.png](/lessons/xxx/03/image.png) を書いておく。
// public/ に実体がまだ無い間は壊れた画像アイコンが出てしまうので、ビルド時にファイルの有無を調べて、
// 無ければ「スクリーンショット準備中」のプレースホルダーに差し替える。
// 画像をpublic/の所定のフォルダに置けば、次のビルドから自動でその画像が表示される
// (本文のMarkdownは書き換えなくてよい)。
// ※ <p>の中に入るので、置き換え先は<span>にしておくこと(<div>だと段落が分断されて壊れる)。
function remarkMissingImagePlaceholder() {
  return (tree) => {
    visit(tree, 'image', (node) => {
      if (!node.url || !node.url.startsWith('/lessons/')) return;
      const rel = decodeURIComponent(node.url).split('/').filter(Boolean);
      if (fs.existsSync(path.join(PUBLIC_DIR, ...rel))) return;
      const fileName = rel[rel.length - 1];
      node.type = 'html';
      node.value =
        '<span class="shot-placeholder">' +
        '<span class="shot-placeholder-icon">📸</span>' +
        '<span class="shot-placeholder-text">スクリーンショット準備中</span>' +
        `<span class="shot-placeholder-file">${fileName}</span>` +
        '</span>';
      delete node.url;
      delete node.alt;
      delete node.title;
    });
  };
}

// 見本プロジェクトや今日のひとことフォームのリンクは、Notionの書き方をそのまま引き継いで
// URLを裸で1行書く形になっている。そのままだと本文に長いURLがそのまま表示されて読みにくいので、
// 「リンクの文字がURLそのもの」の時だけ、分かりやすい日本語のラベルに置き換える。
// (自分で [好きな文字](url) と書いた場合は、その文字を尊重してここでは触らない)
const AUTOLINK_LABELS = [
  { test: /^https?:\/\/scratch\.mit\.edu\/projects\//, label: '先生の見本プロジェクト' },
  { test: /^https?:\/\/(forms\.gle|docs\.google\.com\/forms)/, label: '今日のひとことフォーム' },
];

function remarkFriendlyLinkText() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      if (node.children?.length !== 1) return;
      const child = node.children[0];
      if (child.type !== 'text' || child.value !== node.url) return;
      const hit = AUTOLINK_LABELS.find((entry) => entry.test.test(node.url));
      if (!hit) return;
      child.value = hit.label;
    });
  };
}

// Notionのコールアウトは <aside>\n💡\n\n本文... という形式で書き出される。
// <aside> の直後に空行が無いため、CommonMarkのHTMLブロック規則により
// "<aside>\n💡" の2行がまとめて生のHTMLとして扱われ、💡が<p>で囲まれずに
// テキストノードのまま出力されてしまう(本文側の段落だけが正しく<p>になる)。
// そのままだとCSSで「最初の<p> = アイコン」として位置指定できないので、
// この2行だけのHTMLブロックを見つけて、アイコン部分を<p class="aside-icon">で囲み直す。
function remarkWrapAsideIcon() {
  return (tree) => {
    visit(tree, 'html', (node) => {
      const m = node.value.match(/^(<aside[^>]*>)\r?\n([^\n]+)$/);
      if (m) {
        node.value = `${m[1]}\n<p class="aside-icon">${m[2]}</p>`;
      }
    });
  };
}

export default defineConfig({
  site: 'https://hibiki5201.github.io',
  base: BASE,
  trailingSlash: 'always',
  build: {
    format: 'directory',
  },
  markdown: {
    // 順番が大事:
    // wiki:用語 を実パスに直す → リンク文字をタイトルと同期 → 画像の実体チェック →
    // 裸URLのラベル付け → baseの付与 → asideアイコンの整形
    remarkPlugins: [
      remarkResolveWikiTerms,
      remarkSyncInternalLinkTitles,
      remarkMissingImagePlaceholder,
      remarkFriendlyLinkText,
      remarkPrefixInternalUrls,
      remarkWrapAsideIcon,
    ],
  },
});
