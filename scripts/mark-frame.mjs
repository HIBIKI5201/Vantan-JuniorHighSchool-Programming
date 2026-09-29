// スクショの「変更した部分」に赤い枠線を付ける(コード画面のブロック画像用)。
//
// 使い方:
//   npm run mark -- <画像> <x,y,w,h> [<x,y,w,h> ...]
//   例) npm run mark -- public/lessons/suiyo-2026-7-9/05/image-1.png 620,340,420,110
//
// - 座標は画像のピクセル(左上が0,0)。x,yが枠の左上、w,hが幅と高さ。
//   Readで画像を1回見て、変更したブロックの位置を目で当てる。
// - 各値の末尾に % を付けると画像サイズに対する割合になる (例: 30%,40%,25%,10%)。
// - 枠は元のファイルに上書きする。やり直したい時は撮り直す(二重に枠が付くのを防ぐため)。
// - 枠は少し外側に広げて描く(ブロックに線が重ならないように)。
// - 変数やメッセージの作成ダイアログなど、画面全体を見せる画像には使わない。
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const [file, ...boxArgs] = process.argv.slice(2);
if (!file || boxArgs.length === 0) {
  console.error('使い方: npm run mark -- <画像> <x,y,w,h> [<x,y,w,h> ...]');
  process.exit(1);
}

const input = await readFile(file);
const { width, height } = await sharp(input).metadata();
const stroke = Math.max(4, Math.round(width / 380));
const pad = stroke * 2;
const RED = '#ff0000';

const num = (raw, total) => (raw.endsWith('%') ? (parseFloat(raw) / 100) * total : parseFloat(raw));

const rects = boxArgs.map((arg) => {
  const p = arg.split(',');
  if (p.length !== 4) {
    console.error(`枠の指定が読めません: ${arg}  (x,y,w,h の形で書く)`);
    process.exit(1);
  }
  const [x, y, w, h] = [num(p[0], width), num(p[1], height), num(p[2], width), num(p[3], height)];
  if ([x, y, w, h].some(Number.isNaN)) {
    console.error(`枠の指定が数字ではありません: ${arg}`);
    process.exit(1);
  }
  const rx = Math.max(stroke / 2, x - pad);
  const ry = Math.max(stroke / 2, y - pad);
  const rw = Math.min(width - stroke / 2 - rx, w + pad * 2);
  const rh = Math.min(height - stroke / 2 - ry, h + pad * 2);
  return `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" rx="${stroke}" fill="none" stroke="${RED}" stroke-width="${stroke}"/>`;
});

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${rects.join('')}</svg>`;
const out = await sharp(input).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
await writeFile(file, out);
console.log(`赤枠を${rects.length}個付けました: ${file} (${width}x${height})`);
