// FireShotフォルダに増えたスクショを、トークンを使わずに待ち受けて、資料の空き枠に並べる補助。
//
//   node scripts/shot-watch.mjs wait  [--dir <フォルダ>] [--timeout <分>] [--interval <秒>]
//   node scripts/shot-watch.mjs slots <courseSlug> <回数>
//   node scripts/shot-watch.mjs place <画像> <courseSlug> <回数> <番号> [x,y,w,h ...]
//   node scripts/shot-watch.mjs ack   <画像> [<画像> ...]      # 取り込み済みにする
//   node scripts/shot-watch.mjs seen  [--dir <フォルダ>]       # 今あるものを全部「取り込み済み」にする(最初の1回)
//
// wait   : 新しい(取り込み済みでない)pngが出るまで、ただ待つ。出たら1回だけJSONを出して終わる。
//          待っている間は何も出力しない = Claudeのトークンを使わない。
//          Bashの run_in_background で動かすと、終わった時にClaudeが呼び戻される。
// slots  : その回の md を読んで、画像がまだ無い枠を「番号 / 手順の見出し」で出す。
// place  : 画像を image-番号.png としてコピーし、座標があれば赤枠も付ける(mark-frame.mjs)。
// ack    : 取り込み済みの印を付ける(次の wait で出てこなくなる)。
//
// 取り込み済みの記録: <リポジトリ>/.shot-watch.json (gitignore済み)
import { readdir, readFile, writeFile, stat, copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.shot-watch.json');
const DEFAULT_DIR = 'C:\\Users\\takut\\Downloads\\FireShot';

// Git Bash の /c/Users/... 形式のパスは、Nodeでは C:\c\Users... と解釈されてしまうので直す
const winPath = (p) => p.replace(/^\/([a-zA-Z])\//, (_, d) => `${d.toUpperCase()}:/`);

const argv = process.argv.slice(2).map(winPath);
const cmd = argv.shift();
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE, 'utf8'));
  } catch {
    return { seen: [], hashes: [] };
  }
};
const saveState = (s) => writeFile(STATE, JSON.stringify(s, null, 1));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const listPngs = async (dir) => {
  const names = (await readdir(dir)).filter((n) => /\.png$/i.test(n));
  const out = [];
  for (const n of names) {
    const p = path.join(dir, n);
    const st = await stat(p);
    out.push({ name: n, path: p, size: st.size, mtime: st.mtimeMs });
  }
  return out.sort((a, b) => a.mtime - b.mtime || a.name.localeCompare(b.name));
};

// Scratchの画面かどうか・ダイアログが出ているかを、左上の色だけで判定する。
//   normal : Scratchの紫のヘッダー (コード画面・音タブ・コスチュームタブなど)
//   dialog : 画面全体が青く暗くなっている (変数・メッセージの作成ダイアログ)
//   other  : それ以外
async function analyze(file) {
  const img = sharp(file.path);
  const meta = await img.metadata();
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const px = (x, y) => {
    const i = (Math.min(y, info.height - 1) * info.width + Math.min(x, info.width - 1)) * 3;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const [r, g, b] = px(10, 20);
  const dist = (c, t) => Math.hypot(c[0] - t[0], c[1] - t[1], c[2] - t[2]);
  let kind = 'other';
  if (dist([r, g, b], [133, 92, 214]) < 45) kind = 'normal';
  else if (b > 200 && b > r + 60) kind = 'dialog';
  // 白一色に近い(何も写っていない)画像
  let blank = false;
  {
    const n = Math.min(data.length / 3, 20000);
    let sum = 0;
    let sum2 = 0;
    const step = Math.max(1, Math.floor(data.length / 3 / n));
    let cnt = 0;
    for (let i = 0; i < data.length; i += 3 * step) {
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += v;
      sum2 += v * v;
      cnt++;
    }
    const mean = sum / cnt;
    blank = sum2 / cnt - mean * mean < 4;
  }
  const hash = createHash('sha1').update(data).digest('hex').slice(0, 12);
  const title = (file.name.match(/^FireShot Capture \d+ - (.*?)( - \[.*\])?\.png$/i) || [])[1] || '';
  return { w: meta.width, h: meta.height, kind, blank, hash, title };
}

async function cmdWait() {
  const dir = opt('dir', DEFAULT_DIR);
  const timeoutMin = Number(opt('timeout', '60'));
  const interval = Number(opt('interval', '3')) * 1000;
  const state = await loadState();
  const seen = new Set(state.seen);
  const deadline = Date.now() + timeoutMin * 60000;
  // 1枚ずつ撮るたびに呼び戻されないよう、最後の新着から --quiet 秒(既定20)静かになるまで待ってまとめて返す
  const quiet = Number(opt('quiet', '20')) * 1000;
  let lastSizes = new Map();
  let lastChange = 0;
  let lastCount = 0;
  while (Date.now() < deadline) {
    const files = existsSync(dir) ? await listPngs(dir) : [];
    const fresh = files.filter((f) => !seen.has(f.name));
    // 書き込み途中を避ける: 前回のポーリングから大きさが変わっていないものだけ
    const settled = fresh.filter((f) => lastSizes.get(f.name) === f.size && f.size > 0);
    const changed = fresh.length !== lastCount || fresh.some((f) => lastSizes.get(f.name) !== f.size);
    if (changed) lastChange = Date.now();
    lastCount = fresh.length;
    lastSizes = new Map(fresh.map((f) => [f.name, f.size]));
    if (settled.length > 0 && settled.length === fresh.length && Date.now() - lastChange >= quiet) {
      const known = new Set(state.hashes);
      const items = [];
      for (const f of settled) {
        const a = await analyze(f);
        const dup = known.has(a.hash) || items.some((x) => x.hash === a.hash);
        items.push({ file: f.path, name: f.name, time: new Date(f.mtime).toTimeString().slice(0, 5), ...a, dup });
      }
      console.log(JSON.stringify({ status: 'new', count: items.length, items }, null, 1));
      return;
    }
    await sleep(interval);
  }
  console.log(JSON.stringify({ status: 'idle', note: `${timeoutMin}分間、新しい画像はありませんでした` }));
}

async function cmdSlots() {
  const [course, nn] = argv;
  if (!course || !nn) throw new Error('使い方: slots <courseSlug> <回数>');
  const num = String(nn).padStart(2, '0');
  const md = await readFile(path.join(ROOT, 'src/content/lessons', course, `${num}.md`), 'utf8');
  const lines = md.split(/\r?\n/);
  let heading = '';
  const rows = [];
  for (const line of lines) {
    const h = line.match(/^###\s+(.*)/);
    if (h) heading = h[1];
    const m = line.match(new RegExp(`/lessons/${course}/${num}/image-(\\d+)\\.png`));
    if (m) {
      const idx = Number(m[1]);
      const have = existsSync(path.join(ROOT, 'public/lessons', course, num, `image-${idx}.png`));
      rows.push({ idx, heading, have });
    }
  }
  const missing = rows.filter((r) => !r.have);
  console.log(`${course}/${num}: 全${rows.length}枚 / 未着${missing.length}枚`);
  for (const r of missing) console.log(`  image-${r.idx}\t${r.heading}`);
}

async function cmdPlace() {
  const [src, course, nn, idx, ...boxes] = argv;
  if (!src || !course || !nn || idx === undefined) throw new Error('使い方: place <画像> <courseSlug> <回数> <番号> [x,y,w,h ...]');
  const num = String(nn).padStart(2, '0');
  const dir = path.join(ROOT, 'public/lessons', course, num);
  await mkdir(dir, { recursive: true });
  const dest = path.join(dir, `image-${idx}.png`);
  await copyFile(src, dest);
  if (boxes.length) {
    execFileSync('node', [path.join(ROOT, 'scripts/mark-frame.mjs'), dest, ...boxes], { stdio: 'inherit' });
  }
  console.log(`置きました: ${path.relative(ROOT, dest)}${boxes.length ? ` (赤枠${boxes.length}個)` : ''}`);
}

async function cmdAck() {
  const state = await loadState();
  const seen = new Set(state.seen);
  const hashes = new Set(state.hashes);
  for (const p of argv) {
    seen.add(path.basename(p));
    if (existsSync(p)) hashes.add((await analyze({ path: p, name: path.basename(p) })).hash);
  }
  await saveState({ seen: [...seen], hashes: [...hashes] });
  console.log(`取り込み済みにしました: ${argv.length}件`);
}

async function cmdSeen() {
  const dir = opt('dir', DEFAULT_DIR);
  const files = await listPngs(dir);
  const state = await loadState();
  const seen = new Set(state.seen);
  for (const f of files) seen.add(f.name);
  await saveState({ seen: [...seen], hashes: state.hashes });
  console.log(`今ある${files.length}件を取り込み済みにしました`);
}

const cmds = { wait: cmdWait, slots: cmdSlots, place: cmdPlace, ack: cmdAck, seen: cmdSeen };
if (!cmds[cmd]) {
  console.error('サブコマンド: wait | slots | place | ack | seen');
  process.exit(1);
}
await cmds[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
