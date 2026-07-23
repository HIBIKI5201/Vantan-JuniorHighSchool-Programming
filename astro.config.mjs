// Astroプロジェクト全体の設定ファイル。
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';

// GitHub Pagesは https://hibiki5201.github.io/Vantan-JuniorHighSchool-Programming/ のように
// リポジトリ名がパスに入る「プロジェクトページ」として公開される。
// レッスンのMarkdown本文中の画像パス(例: /lessons/xxx/image.png)はビルド時にただの文字列なので、
// このプラグインでbaseを自動的に先頭へ付け足す(手作業で全ファイルを書き換えずに済むようにするため)。
const BASE = '/Vantan-JuniorHighSchool-Programming';

function remarkPrefixImageBase() {
  return (tree) => {
    visit(tree, 'image', (node) => {
      if (node.url && node.url.startsWith('/') && !node.url.startsWith(BASE)) {
        node.url = BASE + node.url;
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
    remarkPlugins: [remarkPrefixImageBase],
  },
});
