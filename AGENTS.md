# AGENTS.md

バンタン中等部のプログラミング授業(Scratch)資料を公開するAstro製の静的サイト。
元々はNotionで管理していた資料を、この静的サイトに移行している途中。

## このリポジトリで作業する前に

- 授業資料(Markdown)の書き方のルールは **[docs/content-notation.md](docs/content-notation.md)** に
  まとまっている。レッスンのfrontmatter・画像パス・`<aside>`コールアウトの書き方は
  必ずそれに従うこと。
- 本文の言い回し(トーン)は **[docs/writing-voice.md](docs/writing-voice.md)** に、
  既存資料を数えて抜き出してある。新しく書いた文章はこれと突き合わせること。
- Claude Codeで書く場合は `.claude/skills/` のスキルを使う。
  授業回は `lesson-writer`、用語ページは `wiki-term-writer`。
- Notionから新しいコースを取り込む/更新する時は **[scripts/migrate-from-notion.mjs](scripts/migrate-from-notion.mjs)**
  を使う(使い方はスクリプト冒頭のコメントと `docs/content-notation.md` の最後を参照)。

## 開発コマンド

```bash
npm install
npm run dev       # 書きながら確認(制作中の回も出る)  :4321
npm run release   # 生徒が見る画面を確認(制作中は出ない)  :4322
npm run check     # 記法・用語リンク・スクショの検査
npm run new-lesson -- <courseSlug> <回数> "<タイトル>"   # 回の雛形を作る
npm run shots -- <courseSlug> <回数>                    # 撮ったスクショを命名規則に並べ替える
npm run build     # ./dist に静的ビルド
```

Windowsでは `dev.bat` / `release.bat` をダブルクリックしても同じことができる。

`main` にpushすると `.github/workflows/deploy.yaml` が自動でビルドし、GitHub Pages
(`https://hibiki5201.github.io/Vantan-JuniorHighSchool-Programming/`) に公開される。

## 技術構成

- Astro (Content Collections: `src/content/courses/`, `src/content/lessons/`)
- レッスン本文中の画像パスは `astro.config.mjs` のremarkプラグインがビルド時にbase pathを
  自動付与する。手書きのMarkdownでは `/lessons/...` のようにbaseなしのルート相対パスで書く。
- `<aside>💡 ...</aside>` はNotionのコールアウト記法をそのまま使い、`src/layouts/Layout.astro`
  のグローバルCSSで見た目を付けている(専用コンポーネント化はしていない)。

## 現状のコンテンツの状態

全9コースを移行済み: 体験授業 / 金曜ゲーム(2026 1~3月, 4~6月, 7~9月) / 火曜ゲーム(2026 1~3月) /
水曜日ゲーム(2026 7~9月) / シューティングゲーム(2025 10~12月) / ブロック崩しゲーム(2025 10~12月) /
Scratch wiki(用語集)。

水曜日ゲーム(2026 7~9月)は現在進行中のコースのため、レッスンは届いている分(#1, #2)のみ。
今後の回が増えたら `_notion-source/` を更新して `scripts/migrate-from-notion.mjs` を再実行する。

**注意:** `_notion-source/` 以下のフォルダ名は要確認。Notionのフォルダ階層が
エクスポートごとに微妙に変わることがある(例: `プライベート、シェア/バンタン中等部/...` の場合と
`プライベート、シェア/バンタン/バンタン中等部/...` の場合がある)。パスを決め打ちで確認して
「中身がない」と判断する前に、`Glob` などワイルドカードを使って実際の階層を確認すること。

`_notion-source/` はNotionエクスポートの生データの一時保管場所(`.gitignore`済み、コミットしない)。
