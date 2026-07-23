// Astroプロジェクト全体の設定ファイル。
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';

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
    remarkPlugins: [remarkPrefixInternalUrls, remarkWrapAsideIcon],
  },
});
