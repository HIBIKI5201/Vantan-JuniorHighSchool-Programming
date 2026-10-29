// 用語(Scratch wiki)の一覧が変わったら、Astroのキャッシュを消すスクリプト。
//
// なぜ必要か:
//   asideから用語カードを自動で足す仕組み(remarkAutoWikiTerms)は、
//   用語ページを1つ足すだけで既存のレッスンにもリンクが増える、というのが売り。
//   ところがAstroは一度書き出したページをキャッシュ(node_modules/.astro)に持っていて、
//   レッスンのMarkdownが変わっていないと再生成してくれない。
//   そのため「用語を足したのにカードが出ない」ということが起きる。
//
//   そこで用語の一覧をハッシュにして覚えておき、変わっていたらキャッシュを消す。
//   「覚えること」に埋め込むwikiの範囲(<!-- wiki-summary --> 〜 <!-- /wiki-summary -->)も
//   同じ理由でレッスン側に反映されないので、その範囲の中身もハッシュに含める。
//   スクショも同じで、実体が無い画像は「準備中」の枠に差し替えて書き出すので、
//   あとから public/lessons/ に置いてもMarkdownが同じだと枠のまま残る。
//   なので、置いてあるスクショの一覧もハッシュに含める。
//   npm run build / npm run dev の前に自動で走る(package.jsonのprebuild/predev)。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WIKI_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons', 'scratch-wiki');
const SHOTS_DIR = path.join(REPO_ROOT, 'public', 'lessons');
const HASH_FILE = path.join(REPO_ROOT, 'node_modules', '.wiki-terms-hash');
const CACHES = [
  path.join(REPO_ROOT, 'node_modules', '.astro'),
  path.join(REPO_ROOT, '.astro'),
];

if (!fs.existsSync(WIKI_DIR)) process.exit(0);

const titles = fs
  .readdirSync(WIKI_DIR)
  .filter((f) => /^\d{2}\.md$/.test(f))
  .map((f) => {
    const raw = fs.readFileSync(path.join(WIKI_DIR, f), 'utf8');
    const title = raw.match(/^title:\s*"(.*)"\s*$/m)?.[1] ?? '';
    const summary = [...raw.matchAll(/<!--\s*wiki-summary\s*-->([\s\S]*?)<!--\s*\/wiki-summary\s*-->/g)]
      .map((m) => m[1].replace(/\r\n/g, '\n'))
      .join('\n');
    return `${f}:${title}\n${summary}`;
  })
  .sort();

// public/lessons/<courseSlug>/<NN>/ に置いてあるスクショの一覧
const shots = fs.existsSync(SHOTS_DIR)
  ? fs
      .readdirSync(SHOTS_DIR, { recursive: true })
      .map((f) => String(f).replace(/\\/g, '/'))
      .filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f))
      .sort()
  : [];

const hash = crypto
  .createHash('sha1')
  .update(titles.join('\n'))
  .update('\n--shots--\n')
  .update(shots.join('\n'))
  .digest('hex');
const previous = fs.existsSync(HASH_FILE) ? fs.readFileSync(HASH_FILE, 'utf8').trim() : '';

if (hash === previous) process.exit(0);

let cleared = 0;
for (const dir of CACHES) {
  if (!fs.existsSync(dir)) continue;
  fs.rmSync(dir, { recursive: true, force: true });
  cleared += 1;
}

fs.mkdirSync(path.dirname(HASH_FILE), { recursive: true });
fs.writeFileSync(HASH_FILE, hash);

console.log(
  `用語・埋め込む概要・スクショのどれかが${previous ? '変わりました' : '登録されました'}` +
    `(用語${titles.length}件 / スクショ${shots.length}枚)。` +
    (cleared ? 'キャッシュを消したので、全レッスンを作り直します。' : '')
);
