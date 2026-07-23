# 授業資料の記法ルール

このサイトが読み込む `src/content/courses/` と `src/content/lessons/` の中身をどう書くか、
というルールをまとめたもの。Notionから移行した過去の資料も、これから新しく書く資料も、
このルールに合わせる。

## ディレクトリ構成

```text
src/content/
├── courses/
│   └── <courseSlug>.md       # コース1つにつき1ファイル(例: kinyo-2026-1-3.md)
└── lessons/
    └── <courseSlug>/
        └── <NN>.md           # 授業回1つにつき1ファイル。NNは "00", "01"... の2桁ゼロ埋め
public/
└── lessons/
    └── <courseSlug>/
        └── <NN>/
            └── imageX.png     # そのレッスンで使う画像
```

`courseSlug` は好きな文字列でよいが、既存のものは `<曜日ローマ字>-<年>-<開始月>-<終了月>` の形式
(例: `kinyo-2026-1-3` = 金曜日, 2026年1〜3月期)。

## コースのfrontmatter (`src/content/courses/<slug>.md`)

```yaml
---
title: "金曜ゲーム"        # コース名(曜日・期間を含まない)
period: "2026 1~3月"       # 表示用の期間
dayOfWeek: "金曜日"
order: 20                  # トップページでの並び順(大きいほど上に表示)
status: complete           # "complete" | "partial"
note: "..."                # status: partial の時の補足(任意)
---
```

本文は基本的に空でよい(トップページ・コース一覧ページはfrontmatterしか見ていない)。

## レッスンのfrontmatter (`src/content/lessons/<courseSlug>/<NN>.md`)

```yaml
---
course: "kinyo-2026-1-3"   # 対応するコースのslug
order: 3                   # "#3" などの回数。NN(ファイル名)と一致させる
title: "#3 敵を作ろう"      # 一覧・ページタイトルに表示される
sessionDate: "2026-02-06"  # 任意
status: complete           # "complete" | "partial"
note: "..."                # status: partial の時の補足(任意)
---
```

## 本文の記法

本文はNotionのMarkdownエクスポートに準じた書き方をそのまま使う。

### 見出し

- `# タイトル` … ページ冒頭で1回だけ。レッスンの正式名称(例: `# #3 敵を作ろう`)
- `## 目標` `## 見本` `## やってみよう` `## 終わり` `## エクストラ課題` … 大セクション
- `### 見出し` … `## やってみよう` の中の各手順セクション

### 画像

```markdown
![image.png](/lessons/kinyo-2026-1-3/03/image.png)
```

- パスは必ず **`/lessons/<courseSlug>/<NN>/ファイル名`** というサイトルート相対パスにする。
  GitHub Pagesのbase path(`/Vantan-JuniorHighSchool-Programming`)は
  `astro.config.mjs` のremarkプラグインがビルド時に自動で付け足すので、**自分で書かない**。
- ファイル名の半角スペースはハイフンに置き換える(例: `image 1.png` → `image-1.png`)。
  これはURLにスペースが入る事故を防ぐため。
- 画像の実体は `public/lessons/<courseSlug>/<NN>/` に置く。

### コールアウト(吹き出し)

```markdown
<aside>
💡

説明文1行目。

説明文2行目(段落を分けたい時は空行を入れる)。

</aside>
```

- 1行目は絵文字(基本は💡)。2行目以降が本文。
- `Layout.astro` のグローバルCSSが `aside` タグを自動でカード風にスタイリングするので、
  クラス名などは付けなくてよい。
- **書く内容のトーン**(中学生向けであることを踏まえて):
  - です・ます調で、生徒に語りかけるように書く(「〜しましょう」「〜ですね」)。
  - 新しく作る変数名・ブロック名は、英単語の意味を添えて説明する
    (例: 「名前は"MoveSpeed"にします。意味はそのまま「移動のスピード」ですね。」)。
  - 「なぜこの操作が必要か」を先に一言添えてから、具体的な手順の説明に入る。
  - 「こうすると〜になります」という因果関係の説明を使うと分かりやすい。
  - 詳しい手順は aside の外に番号付きリスト(`1.` `2.` ...)として書く。asideの中に手順を
    書かない。

### 内部リンクについて(既知の制限)

Notionのエクスポートには、他の授業ページへのリンク(`[初期化とは](../Scratch wiki/....md)`)が
含まれることがあるが、このサイトはそれらを解決できない。`scripts/migrate-from-notion.mjs` が
自動的にリンクを外してテキストだけ残すようになっている。手で新しく書く場合も、他レッスンへの
Markdownリンクは書かず、プレーンテキストにしておく。

## 画像が見つからない場合の表記

Notionのエクスポートに画像の実体が含まれていなかった場合は、壊れた画像リンクにする代わりに
次の形式のテキストを入れる(`scripts/migrate-from-notion.mjs` が自動でこの形にする):

```markdown
*[画像が見つかりません: image 2.png（元のNotionエクスポートに含まれていませんでした）]*
```

## Notionから新しいコース/レッスンを取り込む手順

1. Notionで対象のページを開き、「•••」→ エクスポート → Markdown & CSV
   → **「サブページを含む」に必ずチェックを入れて**書き出す
   (チェックを忘れると画像やレッスン本文が抜け落ちる)。
2. 展開したフォルダを `_notion-source/` 以下にNotion上のフォルダ名のまま置く。
3. `scripts/migrate-from-notion.mjs` の `COURSES` 配列にコース定義を追加する。
4. `node scripts/migrate-from-notion.mjs` を実行する。
5. `npm run dev` でプレビューして確認する。

`#N タイトル.md` という命名のコースにしか対応していない(体験授業のような特殊な構成は
スクリプト内で個別に処理したため、新しく同様のコースを追加する場合はスクリプトを直接編集する)。
