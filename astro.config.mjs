// Astroプロジェクト全体の設定ファイル。
import { defineConfig } from 'astro/config';
import { visit } from 'unist-util-visit';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.dirname(fileURLToPath(import.meta.url));
const LESSONS_DIR = path.join(REPO_ROOT, 'src', 'content', 'lessons');
const PUBLIC_DIR = path.join(REPO_ROOT, 'public');

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

// Scratch wikiの用語ページへのリンクを `[クローン](wiki:クローン)` と書けるようにする。
// `/courses/scratch-wiki/05/` のようにページ番号を手で書くと、用語を1つ足して番号がずれた時に
// 全レッスンのリンクを直す羽目になるので、用語名から番号を引くのはビルド時にやる。
// 対応する用語ページが見つからない場合はビルド時に警告を出し、リンクを外して文字だけ残す。
let wikiTermMapCache = null;
const wikiTitleByUrl = new Map();

function getWikiTermMap() {
  if (wikiTermMapCache) return wikiTermMapCache;
  const map = new Map();
  const dir = path.join(LESSONS_DIR, 'scratch-wiki');
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const nn = file.match(/^(\d{2})\.md$/)?.[1];
      if (!nn) continue;
      const raw = fs.readFileSync(path.join(dir, file), 'utf8');
      const title = raw.match(/^title:\s*"((?:[^"\\]|\\.)*)"\s*$/m)?.[1];
      if (!title) continue;
      // "初期化（しょきか）" のように読みガナ付きのタイトルでも "初期化" で引けるようにする
      const keys = new Set([title, title.replace(/（.*?）/g, '').trim()]);
      const url = `/courses/scratch-wiki/${nn}/`;
      wikiTitleByUrl.set(url, title);
      for (const key of keys) if (key) map.set(key, url);
    }
  }
  wikiTermMapCache = map;
  return map;
}

function remarkResolveWikiTerms() {
  return (tree, file) => {
    const map = getWikiTermMap();
    visit(tree, 'link', (node) => {
      if (!node.url?.startsWith('wiki:')) return;
      const term = node.url.slice('wiki:'.length).trim();
      const resolved = map.get(term);
      if (resolved) {
        node.url = resolved;
        // リンクの文字も用語ページの正式タイトルに揃える
        // (「初期化」と書いても「初期化（しょきか）」と表示される)
        const title = wikiTitleByUrl.get(resolved);
        if (title && node.children?.length === 1 && node.children[0].type === "text") {
          node.children[0].value = title;
        }
        return;
      }
      console.warn(
        `[wiki用語] "${term}" に対応するScratch wikiのページが見つかりません: ${file.path ?? ''}`
      );
      node.url = '';
      node.data = { ...node.data, hName: 'span' };
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
      // 用語リンクの文字は remarkResolveWikiTerms / remarkAutoWikiTerms 側で
      // 正式タイトルに揃えているので、ここでは触らない
      if (courseSlug === "scratch-wiki") return;
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

// レッスンを先に書いて、Scratchで作った完成品のスクリーンショットは後から撮って貼る、
// という進め方をするため、本文には最初から ![image.png](/lessons/xxx/03/image.png) を書いておく。
// public/ に実体がまだ無い間は壊れた画像アイコンが出てしまうので、ビルド時にファイルの有無を調べて、
// 無ければ「スクリーンショット準備中」のプレースホルダーに差し替える。
// 画像をpublic/の所定のフォルダに置けば、次のビルドから自動でその画像が表示される
// (本文のMarkdownは書き換えなくてよい)。
// ※ <p>の中に入るので、置き換え先は<span>にしておくこと(<div>だと段落が分断されて壊れる)。
function remarkMissingImagePlaceholder() {
  return (tree) => {
    visit(tree, 'image', (node) => {
      if (!node.url || !node.url.startsWith('/lessons/')) return;
      const rel = decodeURIComponent(node.url).split('/').filter(Boolean);
      if (fs.existsSync(path.join(PUBLIC_DIR, ...rel))) return;
      const fileName = rel[rel.length - 1];
      node.type = 'html';
      node.value =
        '<span class="shot-placeholder">' +
        '<span class="shot-placeholder-icon">📸</span>' +
        '<span class="shot-placeholder-text">スクリーンショット準備中</span>' +
        `<span class="shot-placeholder-file">${fileName}</span>` +
        '</span>';
      delete node.url;
      delete node.alt;
      delete node.title;
    });
  };
}

// 見本プロジェクトや今日のひとことフォームのリンクは、Notionの書き方をそのまま引き継いで
// URLを裸で1行書く形になっている。そのままだと本文に長いURLがそのまま表示されて読みにくいので、
// 「リンクの文字がURLそのもの」の時だけ、分かりやすい日本語のラベルに置き換える。
// (自分で [好きな文字](url) と書いた場合は、その文字を尊重してここでは触らない)
const AUTOLINK_LABELS = [
  { test: /^https?:\/\/scratch\.mit\.edu\/projects\//, label: '先生の見本プロジェクト' },
  { test: /^https?:\/\/(forms\.gle|docs\.google\.com\/forms)/, label: '今日のひとことフォーム' },
];

function remarkFriendlyLinkText() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      if (node.children?.length !== 1) return;
      const child = node.children[0];
      if (child.type !== 'text' || child.value !== node.url) return;
      const hit = AUTOLINK_LABELS.find((entry) => entry.test.test(node.url));
      if (!hit) return;
      child.value = hit.label;
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


// 本文にScratch wikiの用語が出てきたら、その見出しのまとまりの最後に用語カードを自動で足す。
// 毎回 [クローン](wiki:クローン) と手で書かなくても済むようにするため。
//
// 「どこに付けるか」が肝になる。ただ最初に見つかった所に付けると、
// たとえば「敵の体力の変数を作る」の手順に、”このスプライトのみ”という選択肢の名前を拾って
// 『スプライト』のカードが付いてしまう。その手順はスプライトの話ではないので邪魔になる。
//
// そこで次のようにしている:
//   - **”...” で囲まれた中は見ない。** 資料ではブロック名やボタン名を必ず ”...” で書くので、
//     ”このスプライトのみ” や ”このクローンを削除する” のような「操作の名前」を拾わなくなる。
//     地の文で「スプライトごとに変数を持てる」と説明している所だけが残る。
//   - **見出しに入っている用語を最優先する。** 「◯◯の変数を作る」という見出しなら、
//     その手順は変数の話だと分かる。
//   - 同じ用語が何か所かに出てきたら、**一番点数の高い1か所だけ**に付ける。
//   - 1つのまとまりに付けるのは最大2件まで(カードだらけにならないように)
//   - 手書きの [用語](wiki:用語) が既にある用語は足さない
//   - Scratch wiki自身のページでは何もしない(用語ページが自分を指してしまうため)
const AUTO_TERMS_PER_BLOCK = 2;
const SCORE_IN_HEADING = 2;
const SCORE_IN_BODY = 1;

function toPlainText(node) {
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'html') return '';
  if (!node.children) return '';
  return node.children.map(toPlainText).join('');
}

// ”...” の中身を消す。資料ではブロック名・ボタン名・選択肢の名前をこう書くので、
// 「操作の名前として出てきただけ」の用語を拾わないようにするため。
// (”このスプライトのみ” から『スプライト』を拾ってしまう、というのを防ぐ)
//
// ただし ”コスチューム” のように、引用の中身がちょうど用語名そのものの時は残す。
// これは操作の名前ではなく、用語そのものを指して説明している文なので拾ってよい。
//
// なお資料によって開き引用符が “ だったり ” だったりする(Notionから移行した回に多い)。
// 片方だけを見ていると範囲を取り違えて、囲まれていない所まで消してしまうので、
// どの向きの引用符も同じ区切りとして扱う。
function stripQuoted(text, termKeys) {
  return text.replace(/[“”"]([^“”"]*)[“”"]/g, (whole, inner) =>
    termKeys.has(inner.trim()) ? inner : ' '
  );
}

function remarkAutoWikiTerms() {
  return (tree, file) => {
    const filePath = (file.path ?? '').split(path.sep).join('/');
    if (filePath.includes('/lessons/scratch-wiki/')) return;

    // 長い用語名から先に照合して、短い名前に食われないようにする
    const terms = [...getWikiTermMap().entries()].sort((a, b) => b[0].length - a[0].length);

    // すでにページ内にあるリンク(手書き分)と同じ用語は足さない
    const used = new Set();
    visit(tree, 'link', (node) => {
      if (/^\/courses\/scratch-wiki\/\d{2}\/$/.test(node.url ?? '')) used.add(node.url);
    });

    const children = tree.children;

    // 見出しごとに本文をひとまとまりにする
    const blocks = [];
    let current = null;
    children.forEach((node, i) => {
      if (node.type === 'heading') {
        current = { heading: toPlainText(node), body: '', end: i };
        blocks.push(current);
        return;
      }
      if (!current) return;
      current.end = i;
      // 見るのは地の文(asideの説明を含む)だけ。番号リストは「ボタンを押す」といった
      // 操作の手順なので見ない。そこに出てくる用語は説明ではなく作業の対象でしかなく、
      // 拾うと「Enemyのスプライトを選ぶ」から『スプライト』を拾うようなことが起きる。
      if (node.type === 'paragraph') {
        current.body += toPlainText(node) + '\n';
      }
    });

    // 用語ごとに「一番ふさわしいまとまり」を選ぶ
    const termKeys = new Set(terms.map(([term]) => term));
    const best = new Map();
    blocks.forEach((block, bi) => {
      const heading = stripQuoted(block.heading, termKeys);
      const body = stripQuoted(block.body, termKeys);
      for (const [term, url] of terms) {
        if (used.has(url)) continue;
        let score = 0;
        let at = heading.indexOf(term);
        if (at >= 0) score = SCORE_IN_HEADING;
        else {
          at = body.indexOf(term);
          if (at >= 0) score = SCORE_IN_BODY;
        }
        if (!score) continue;
        const previous = best.get(url);
        // 同点なら先に出てきたまとまりを優先する
        if (!previous || score > previous.score) best.set(url, { score, at, bi, term });
      }
    });

    // まとまりごとにまとめて、点数の高いものから最大2件
    const perBlock = new Map();
    for (const [url, info] of best) {
      const list = perBlock.get(info.bi) ?? [];
      list.push({ url, ...info });
      perBlock.set(info.bi, list);
    }

    const inserts = [];
    for (const [bi, list] of perBlock) {
      list.sort((a, b) => b.score - a.score || a.at - b.at);
      inserts.push({
        index: blocks[bi].end + 1,
        nodes: list.slice(0, AUTO_TERMS_PER_BLOCK).map((hit) => ({
          type: 'paragraph',
          children: [
            {
              type: 'link',
              url: hit.url,
              // 照合した語ではなく用語ページの正式タイトルを出す
              // (「初期化」で当たっても「初期化（しょきか）」と表示する)
              children: [{ type: 'text', value: wikiTitleByUrl.get(hit.url) ?? hit.term }],
            },
          ],
        })),
      });
    }

    // 後ろから入れて、前の位置がずれないようにする
    inserts.sort((a, b) => b.index - a.index);
    for (const ins of inserts) children.splice(ins.index, 0, ...ins.nodes);
  };
}

// 外部サイトへのリンクは新しいタブで開く。
// 資料を読んでいる途中でページを離れてしまわないようにするため。
// (サイト内のリンクは同じタブのまま)
function remarkExternalLinksNewTab() {
  return (tree) => {
    visit(tree, 'link', (node) => {
      if (!/^https?:\/\//i.test(node.url ?? '')) return;
      node.data = node.data ?? {};
      node.data.hProperties = {
        ...(node.data.hProperties ?? {}),
        target: '_blank',
        rel: 'noopener noreferrer',
      };
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
    // 順番が大事:
    // wiki:用語 を実パスに直す → asideから用語カードを自動追加 → リンク文字をタイトルと同期 →
    // 画像の実体チェック → 裸URLのラベル付け → baseの付与 → 外部リンクを別タブに → asideアイコンの整形
    // (用語カードの文字も揃えたいので、自動追加はタイトル同期より前に置くこと)
    remarkPlugins: [
      remarkResolveWikiTerms,
      remarkAutoWikiTerms,
      remarkSyncInternalLinkTitles,
      remarkMissingImagePlaceholder,
      remarkFriendlyLinkText,
      remarkPrefixInternalUrls,
      remarkExternalLinksNewTab,
      remarkWrapAsideIcon,
    ],
  },
});
