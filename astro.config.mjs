// Astroプロジェクト全体の設定ファイル。
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');

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
    remarkPlugins: [remarkSyncInternalLinkTitles, remarkPrefixInternalUrls, remarkWrapAsideIcon],
  },
});
