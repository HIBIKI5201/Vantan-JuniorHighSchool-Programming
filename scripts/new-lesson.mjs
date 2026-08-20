// 新しい授業回のMarkdownを、docs/content-notation.md のルールに沿った雛形で作るスクリプト。
//
//   node scripts/new-lesson.mjs <courseSlug> <回数> "<タイトル>" [手順の数]
//
// 例:
//   node scripts/new-lesson.mjs kinyo-2026-7-9 4 "タイトルとリザルトを作ろう"
//   node scripts/new-lesson.mjs suiyo-2026-7-9 3 "敵を作ろう" 8
//
// やること:
//   - src/content/lessons/<courseSlug>/<NN>.md を作る(既にあれば何もしない)
//   - public/lessons/<courseSlug>/<NN>/ の空フォルダを作る(スクショの置き場所)
//   - 手順の数だけ ### 見出し + スクショ + aside + 番号リスト の雛形を並べる
//
// スクショはあとから public/lessons/<courseSlug>/<NN>/ に置けばよい。
// 実体が無い間は astro.config.mjs のremarkプラグインが「準備中」表示に差し替えるので、
// 画像リンクは最初から本文に書いたままで構わない。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const COURSES_DIR = path.join(REPO_ROOT, 'src', 'content', 'courses');
const PUBLIC_LESSONS_DIR = path.join(REPO_ROOT, 'public', 'lessons');

const [courseSlug, orderArg, title, stepsArg] = process.argv.slice(2);

if (!courseSlug || !orderArg || !title) {
  console.error('使い方: node scripts/new-lesson.mjs <courseSlug> <回数> "<タイトル>" [手順の数]');
  process.exit(1);
}

const order = Number(orderArg);
if (!Number.isInteger(order) || order < 0 || order > 99) {
  console.error(`回数は0〜99の整数で指定してください: ${orderArg}`);
  process.exit(1);
}
const nn = String(order).padStart(2, '0');
const stepCount = stepsArg ? Number(stepsArg) : 6;

if (!fs.existsSync(path.join(COURSES_DIR, `${courseSlug}.md`))) {
  console.error(`コースが見つかりません: src/content/courses/${courseSlug}.md`);
  console.error('先にコースのファイルを作るか、courseSlugを確認してください。');
  process.exit(1);
}

const lessonPath = path.join(LESSONS_DIR, courseSlug, `${nn}.md`);
if (fs.existsSync(lessonPath)) {
  console.error(`すでに存在します: ${path.relative(REPO_ROOT, lessonPath)}`);
  process.exit(1);
}

const today = new Date();
const createdAt = `${today.getFullYear()}年${today.getMonth() + 1}月${today.getDate()}日`;

// 画像は image-0.png, image-1.png, image-2.png ... という並びにする(既存の資料と同じ命名)。
let imageIndex = 0;
const nextImage = () => {
  const name = `image-${imageIndex}.png`;
  imageIndex += 1;
  return `![image.png](/lessons/${courseSlug}/${nn}/${name})`;
};

const steps = Array.from({ length: stepCount }, (_, i) => {
  return `### 手順${i + 1}の見出し

${nextImage()}

<aside>
💡

ここで「なぜこれをするのか」を一言書いてから、「何をするか」を説明する。
新しく作る変数名やブロック名は、英単語の意味を添えて説明する。

</aside>

1. 具体的な操作
2. 具体的な操作
`;
}).join('\n');

const body = `---
course: "${courseSlug}"
order: ${order}
title: "#${order} ${title}"
status: partial
note: "スクリーンショットは授業のあとに追加します。"
---

# #${order} ${title}

作成日時: ${createdAt}
授業日: （授業日を入れる）

# 目標

- ゴール1
- ゴール2
- ゴール3

# 見本

先生のプロジェクトです！
完成品として参考にしてください。

（先生のプロジェクトURLを入れる）

## 今日のひとことを書こう！

https://forms.gle/2pMUF3bXP67FiUdA8

# やってみよう

## 大きなまとまりの見出し

${steps}
# 終わり

これで今日は終わりです！

## エクストラ課題

### 追加でやってみること

説明。
`;

fs.mkdirSync(path.dirname(lessonPath), { recursive: true });
fs.writeFileSync(lessonPath, body);

const imageDir = path.join(PUBLIC_LESSONS_DIR, courseSlug, nn);
fs.mkdirSync(imageDir, { recursive: true });

console.log(`作成しました: ${path.relative(REPO_ROOT, lessonPath)}`);
console.log(`スクショの置き場所: ${path.relative(REPO_ROOT, imageDir)}`);
console.log(`スクショの想定枚数: ${stepCount}枚 (image-0.png 〜 image-${stepCount - 1}.png)`);
console.log('');
console.log('次にやること:');
console.log('  1. 本文を書く(用語リンクは [クローン](wiki:クローン) の形で単独の段落に置く)');
console.log('  2. node scripts/check-lessons.mjs で確認');
console.log('  3. スクショが揃ったら frontmatter の status を complete に戻す');
