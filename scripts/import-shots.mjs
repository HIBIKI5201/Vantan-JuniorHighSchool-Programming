// 授業中に撮ったスクリーンショットを、資料の命名規則どおりに並べ替えるスクリプト。
//
//   node scripts/import-shots.mjs <courseSlug> <回数> [--dry-run]
//
// 例:
//   npm run shots -- kinyo-2026-7-9 3 --dry-run   # 何がどう変わるか見るだけ
//   npm run shots -- kinyo-2026-7-9 3             # 実際にリネームする
//
// やること:
//   public/lessons/<courseSlug>/<NN>/ の中の、image*.png 以外の画像ファイルを
//   撮った順(ファイル名の日時 → 更新日時)に image.png / image-1.png / image-2.png … へ改名する。
//
// Windowsのスクリーンショットは「スクリーンショット 2026-08-21 005102.png」のように
// 空白と日本語が入っていて、そのままではURLに使えないため。
//
// 既にある image*.png は動かさない。その続きの番号から埋めていく。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [courseSlug, orderArg] = args.filter((a) => !a.startsWith('--'));

if (!courseSlug || !orderArg) {
  console.error('使い方: node scripts/import-shots.mjs <courseSlug> <回数> [--dry-run]');
  process.exit(1);
}

const nn = String(Number(orderArg)).padStart(2, '0');
const dir = path.join(REPO_ROOT, 'public', 'lessons', courseSlug, nn);

if (!fs.existsSync(dir)) {
  console.error(`フォルダがありません: ${path.relative(REPO_ROOT, dir)}`);
  console.error('先に npm run new-lesson で回を作るか、courseSlugと回数を確認してください。');
  process.exit(1);
}

const files = fs.readdirSync(dir).filter((f) => IMAGE_EXT.test(f));
const already = files.filter((f) => /^image(-\d+)?\.(png|jpe?g|gif|webp)$/i.test(f));
const incoming = files.filter((f) => !already.includes(f));

if (!incoming.length) {
  console.log(`並べ替えるファイルはありません (image*.png が ${already.length}枚 あります)`);
  process.exit(0);
}

// 撮った順に並べる。ファイル名に日時が入っていればそれを優先し、無ければ更新日時を使う。
function sortKey(name) {
  const digits = name.replace(/\D/g, '');
  if (digits.length >= 8) return digits;
  return String(fs.statSync(path.join(dir, name)).mtimeMs);
}
incoming.sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

// 空いている番号を探す
const usedSlots = new Set(
  already.map((f) => {
    const m = f.match(/^image(?:-(\d+))?\./i);
    return m ? Number(m[1] ?? 0) : -1;
  })
);
let slot = 0;
const nextSlot = () => {
  while (usedSlots.has(slot)) slot += 1;
  usedSlots.add(slot);
  return slot;
};

const plan = incoming.map((name) => {
  const n = nextSlot();
  const ext = path.extname(name).toLowerCase();
  return { from: name, to: n === 0 ? `image${ext}` : `image-${n}${ext}` };
});

console.log(`${path.relative(REPO_ROOT, dir)} の ${plan.length}枚を並べ替えます`);
console.log('(撮った順に番号を振ります。順番が違ったら、あとで手で入れ替えてください)');
console.log('');
for (const { from, to } of plan) console.log(`  ${from}\n    → ${to}`);
console.log('');

if (dryRun) {
  console.log('--dry-run なので、実際には変えていません。');
  process.exit(0);
}

for (const { from, to } of plan) {
  fs.renameSync(path.join(dir, from), path.join(dir, to));
}

console.log(`完了しました。npm run dev で並び順を確認してください。`);
console.log(`順番が違っていたら、そのフォルダの中でファイル名を入れ替えれば直せます。`);
