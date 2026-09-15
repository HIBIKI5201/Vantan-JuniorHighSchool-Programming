// 授業資料のMarkdownと、エディタが扱う「ブロックの配列」を相互変換する。
//
// このエディタで一番大事な性質は **往復して内容が変わらないこと**。
// すでに9コース分の資料が src/content/lessons/ にあり、そこにはNotionから移行した
// 表・生HTML・独特な書き方も混ざっている。エディタで開いて保存しただけでそれらが壊れると、
// 誰も使えなくなる。
//
// そのため、知らない書き方は解釈せず `raw` ブロックとして行をそのまま持ち、
// 書き出す時にもそのまま戻す。エディタ側では灰色の「そのまま保存される部分」として表示する
// (docs/content-notation.md に載っている記法だけをブロックとして扱う)。
//
// ブロックの種類:
//   heading  { level: 1|2|3, text }          見出し
//   paragraph{ text }                        本文(textの中の \n は行内改行)
//   bullet   { text }                        「- 」の箇条書き1件
//   number   { text }                        「1. 」の番号付きリスト1件
//   image    { url, alt }                    スクショ
//   aside    { icon, items: [{kind,text}] }  <aside>💡 ...</aside> のコールアウト
//   wiki     { term }                        [クローン](wiki:クローン) の用語カード
//   url      { url }                         見本プロジェクト/フォームの裸URL
//   raw      { text }                        上のどれでもない部分(そのまま保存)

// ------------------------------------------------------------------ 判定用

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const IMAGE_ONLY_RE = /^!\[([^\]]*)\]\(([^)\s]+)\)$/;
const BULLET_RE = /^[-*]\s+(.*)$/;
const NUMBER_RE = /^\d+\.\s+(.*)$/;
const WIKI_ONLY_RE = /^\[([^\]]*)\]\(wiki:([^)]+)\)$/;
const BARE_URL_RE = /^https?:\/\/\S+$/;
const FENCE_RE = /^(```|~~~)/;

let uid = 0;
const nextId = () => `b${++uid}`;

export function makeBlock(type, props = {}) {
  const base = { id: nextId(), type };
  if (type === 'heading') return { ...base, level: 2, text: '', ...props };
  if (type === 'aside') return { ...base, icon: '💡', items: [{ kind: 'p', text: '' }], ...props };
  if (type === 'image') return { ...base, url: '', alt: 'image.png', ...props };
  if (type === 'wiki') return { ...base, term: '', ...props };
  if (type === 'url') return { ...base, url: '', ...props };
  return { ...base, text: '', ...props };
}

// ------------------------------------------------------------- frontmatter

export function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: raw };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!hit) continue;
    let value = hit[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\"/g, '"');
    }
    data[hit[1]] = value;
  }
  return { data, body: raw.slice(m[0].length) };
}

// frontmatterは src/content/config.ts のschemaと同じ順番で書き出す
// (既存ファイルと並びを揃えて、余計な差分が出ないようにするため)。
const FM_ORDER = ['course', 'order', 'title', 'sessionDate', 'status', 'note'];
const FM_NUMERIC = new Set(['order']);
const FM_BARE = new Set(['status']);

export function serializeFrontmatter(data) {
  const known = FM_ORDER.filter((key) => key in data);
  const extra = Object.keys(data).filter((key) => !FM_ORDER.includes(key));
  const lines = [...known, ...extra]
    .filter((key) => data[key] !== '' && data[key] != null)
    .map((key) => {
      const value = data[key];
      if (FM_NUMERIC.has(key)) return `${key}: ${Number(value)}`;
      if (FM_BARE.has(key)) return `${key}: ${value}`;
      return `${key}: "${String(value).replace(/"/g, '\\"')}"`;
    });
  return `---\n${lines.join('\n')}\n---\n`;
}

// --------------------------------------------------------- Markdown → ブロック

export function markdownToBlocks(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  // 直前のブロックとの間に空行があったか。既存資料には「番号リストの直後に空行なしで
  // 補足の文が続く」といった詰め方が多く、これを覚えておかないと開いて保存しただけで
  // 空行が増えてしまう(= 全ファイルにムダな差分が出る)。
  let blankBefore = true;
  const pushBlock = (block) => {
    if (blocks.length > 0) block.glued = !blankBefore;
    blocks.push(block);
    blankBefore = false;
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === '') {
      blankBefore = true;
      i += 1;
      continue;
    }

    // 行頭に空白がある行(入れ子のリストや、リストの中に差し込まれた画像)は、階層が
    // 崩れないようにそのままrawとして持つ。ここは他の判定より先に見る必要がある
    // (「    ![image.png](...)」を画像ブロックとして扱うと、字下げが失われてしまう)。
    if (/^\s+\S/.test(line)) {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '') {
        buf.push(lines[i]);
        i += 1;
      }
      pushBlock(makeBlock('raw', { text: buf.join('\n') }));
      continue;
    }

    // コードフェンス: 閉じるまで丸ごとraw
    if (FENCE_RE.test(trimmed)) {
      const fence = trimmed.match(FENCE_RE)[1];
      const buf = [line];
      i += 1;
      while (i < lines.length) {
        buf.push(lines[i]);
        const closed = lines[i].trim().startsWith(fence);
        i += 1;
        if (closed) break;
      }
      pushBlock(makeBlock('raw', { text: buf.join('\n') }));
      continue;
    }

    // コールアウト: <aside> ... </aside>
    if (/^<aside\b/.test(trimmed)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^<\/aside>/.test(lines[i].trim())) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1; // </aside> を読み飛ばす
      pushBlock(parseAside(buf));
      continue;
    }

    // 表・生HTML・引用は解釈せず、空行までをそのまま持つ
    if (trimmed.startsWith('|') || trimmed.startsWith('<') || trimmed.startsWith('>')) {
      const buf = [];
      while (i < lines.length && lines[i].trim() !== '') {
        buf.push(lines[i]);
        i += 1;
      }
      pushBlock(makeBlock('raw', { text: buf.join('\n') }));
      continue;
    }

    const heading = trimmed.match(HEADING_RE);
    if (heading) {
      pushBlock(makeBlock('heading', { level: heading[1].length, text: heading[2].trim() }));
      i += 1;
      continue;
    }

    const image = trimmed.match(IMAGE_ONLY_RE);
    if (image) {
      pushBlock(makeBlock('image', { alt: image[1], url: image[2] }));
      i += 1;
      continue;
    }

    const wiki = trimmed.match(WIKI_ONLY_RE);
    if (wiki) {
      // リンクの文字が用語名と違う場合(例: [引数](wiki:引数（ひきすう）))は、
      // 元の書き方のまま残す。表示はどちらでもビルド時に正式タイトルへ揃えられる。
      pushBlock(
        makeBlock('wiki', {
          term: wiki[2].trim(),
          label: wiki[1].trim() === wiki[2].trim() ? '' : wiki[1].trim(),
        })
      );
      i += 1;
      continue;
    }

    if (BARE_URL_RE.test(trimmed)) {
      pushBlock(makeBlock('url', { url: trimmed }));
      i += 1;
      continue;
    }

    // リスト。空行までをひとまとまりとして読む。
    //   - 入れ子(行頭に空白)が混ざっていたら、階層を保つためまとめてraw
    //     (体験授業の「作りたいゲームのチェックリスト」は3段の入れ子になっている)
    //   - 項目の続きが次の行に折り返している場合は、その項目の中の改行として扱う。
    //     ここで区切ってしまうと、あとに続く項目の番号が1に戻ってしまう
    if (BULLET_RE.test(trimmed) || NUMBER_RE.test(trimmed)) {
      const run = [];
      let j = i;
      while (j < lines.length && lines[j].trim() !== '') {
        const t = lines[j].trim();
        const isItem = BULLET_RE.test(t) || NUMBER_RE.test(t);
        const isIndented = /^\s+\S/.test(lines[j]);
        // 見出しや画像などが空行なしで続いている時は、そこでリストを終わりにする
        if (!isItem && !isIndented && startsNewBlock(t)) break;
        run.push(lines[j]);
        j += 1;
      }

      if (run.some((entry) => /^\s+\S/.test(entry))) {
        pushBlock(makeBlock('raw', { text: run.join('\n') }));
      } else {
        let last = null;
        for (const entry of run) {
          const t = entry.trim();
          const bullet = t.match(BULLET_RE);
          const number = t.match(NUMBER_RE);
          if (bullet) {
            last = makeBlock('bullet', { text: bullet[1] });
          } else if (number) {
            last = makeBlock('number', { text: number[1] });
          } else if (last) {
            last.text += `\n${t}`;
            continue;
          } else {
            last = makeBlock('paragraph', { text: t });
          }
          pushBlock(last);
        }
      }
      i = j;
      continue;
    }

    // ここまで来たら本文。空行か他のブロックの始まりに当たるまでを1段落にまとめる
    // (「作成日時: ...」「授業日: ...」のように行内改行で続く段落があるため)
    const buf = [trimmed];
    i += 1;
    while (i < lines.length) {
      const nextTrimmed = lines[i].trim();
      if (nextTrimmed === '' || startsNewBlock(nextTrimmed)) break;
      buf.push(nextTrimmed);
      i += 1;
    }
    pushBlock(makeBlock('paragraph', { text: buf.join('\n') }));
  }

  if (blocks.length === 0) blocks.push(makeBlock('paragraph'));
  return blocks;
}

function startsNewBlock(trimmed) {
  return (
    HEADING_RE.test(trimmed) ||
    BULLET_RE.test(trimmed) ||
    NUMBER_RE.test(trimmed) ||
    IMAGE_ONLY_RE.test(trimmed) ||
    WIKI_ONLY_RE.test(trimmed) ||
    BARE_URL_RE.test(trimmed) ||
    FENCE_RE.test(trimmed) ||
    trimmed.startsWith('|') ||
    trimmed.startsWith('<') ||
    trimmed.startsWith('>')
  );
}

// <aside>の中身。1行目の絵文字と、それ以降の段落・リストに分ける。
function parseAside(lines) {
  let icon = '💡';
  const items = [];
  let started = false;

  // 空行で区切られたところが段落の切れ目。続けて書かれた行は1つの段落の中の改行として扱う
  // (資料では「〜します。」「なので〜」のように、改行しながら続けて書かれていることが多い)。
  let paragraph = null;
  const flush = () => {
    if (paragraph) items.push({ kind: 'p', text: paragraph.join('\n') });
    paragraph = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!started) {
      if (trimmed === '') continue;
      icon = trimmed;
      started = true;
      continue;
    }
    if (trimmed === '') {
      flush();
      continue;
    }

    const bullet = trimmed.match(BULLET_RE);
    if (bullet) {
      flush();
      items.push({ kind: 'bullet', text: bullet[1] });
      continue;
    }
    const number = trimmed.match(NUMBER_RE);
    if (number) {
      flush();
      items.push({ kind: 'number', text: number[1] });
      continue;
    }
    if (paragraph) paragraph.push(trimmed);
    else paragraph = [trimmed];
  }
  flush();

  if (items.length === 0) items.push({ kind: 'p', text: '' });
  return makeBlock('aside', { icon, items });
}

// --------------------------------------------------------- ブロック → Markdown

const LIST_TYPES = new Set(['bullet', 'number']);

export function blocksToMarkdown(blocks) {
  const out = [];
  let numberCounter = 0;

  blocks.forEach((block, index) => {
    const previous = blocks[index - 1];

    // 番号は「連続している間だけ」1から数え直す
    if (block.type === 'number') {
      numberCounter = previous?.type === 'number' ? numberCounter + 1 : 1;
    }

    // 空行を挟むかどうか。
    //   - 読み込んだ時に詰まっていた/空いていたブロックは、その通りに戻す(block.glued)
    //   - エディタで新しく足したブロック(gluedが無い)は、同じ種類のリストが続く時だけ詰める
    const sameList = previous && LIST_TYPES.has(block.type) && previous.type === block.type;
    const glued = typeof block.glued === 'boolean' ? block.glued : sameList;
    if (index > 0 && !glued) out.push('');

    out.push(blockToMarkdown(block, numberCounter));
  });

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

function blockToMarkdown(block, numberCounter) {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text.trim()}`;
    case 'bullet':
      return `- ${block.text.trim()}`;
    case 'number':
      return `${numberCounter}. ${block.text.trim()}`;
    case 'image':
      return `![${block.alt || 'image.png'}](${block.url})`;
    case 'wiki': {
      // リンクの文字はビルド時に用語ページの正式タイトルへ揃えられるので、
      // 新しく足す時は用語名をそのまま書けばよい(docs/content-notation.md 参照)
      const term = block.term.trim();
      return `[${block.label?.trim() || term}](wiki:${term})`;
    }
    case 'url':
      return block.url.trim();
    case 'aside':
      return asideToMarkdown(block);
    case 'raw':
      return block.text;
    default:
      return block.text ?? '';
  }
}

// Notionの書き出しと同じ「<aside> / 絵文字 / 空行 / 本文 / 空行 / </aside>」の形に戻す。
// この形でないと astro.config.mjs の remarkWrapAsideIcon が絵文字を拾えない。
function asideToMarkdown(block) {
  const lines = ['<aside>', block.icon || '💡', ''];

  let counter = 0;
  block.items.forEach((item, index) => {
    const previous = block.items[index - 1];
    const gluedList =
      previous && item.kind !== 'p' && previous.kind === item.kind;
    if (index > 0 && !gluedList) lines.push('');

    if (item.kind === 'number') {
      counter = previous?.kind === 'number' ? counter + 1 : 1;
      lines.push(`${counter}. ${item.text.trim()}`);
      return;
    }
    if (item.kind === 'bullet') {
      lines.push(`- ${item.text.trim()}`);
      return;
    }
    lines.push(item.text.trim());
  });

  while (lines[lines.length - 1] === '') lines.pop();
  lines.push('', '</aside>');
  return lines.join('\n');
}

export function toFullMarkdown(frontmatter, blocks) {
  return `${serializeFrontmatter(frontmatter)}\n${blocksToMarkdown(blocks)}`;
}

// ----------------------------------------------------------- 行内の装飾

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
const escapeHtml = (text) => String(text ?? '').replace(/[&<>]/g, (c) => ESCAPE_MAP[c]);

/**
 * 行内Markdown → contenteditableに入れるHTML。
 * 対応するのは資料で実際に使われている **太字** / *斜体* / `コード` / [文字](URL) だけ。
 */
export function inlineToHtml(text) {
  let html = escapeHtml(text);

  // コードを先に退避して、中身が太字などとして解釈されないようにする
  const stash = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    stash.push(`<code>${code}</code>`);
    return `@@EDITOR_CODE_${stash.length - 1}@@`;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
    const safe = url.replace(/"/g, '&quot;');
    return `<a href="${safe}">${label}</a>`;
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/@@EDITOR_CODE_(\d+)@@/g, (_, i) => stash[Number(i)]);

  return html.replace(/\n/g, '<br>');
}

/** contenteditableのHTML → 行内Markdown。inlineToHtmlの逆。 */
export function htmlToInline(root) {
  let out = '';

  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        out += child.nodeValue;
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const tag = child.tagName.toLowerCase();
      if (tag === 'br') {
        out += '\n';
        continue;
      }
      if (tag === 'code') {
        out += `\`${child.textContent}\``;
        continue;
      }
      if (tag === 'a') {
        out += `[${child.textContent}](${child.getAttribute('href') ?? ''})`;
        continue;
      }
      if (tag === 'strong' || tag === 'b') {
        out += `**${child.textContent}**`;
        continue;
      }
      if (tag === 'em' || tag === 'i') {
        out += `*${child.textContent}*`;
        continue;
      }
      if (tag === 'div' || tag === 'p') {
        // 貼り付けで入り込んだ改行は行内改行として扱う
        if (out !== '' && !out.endsWith('\n')) out += '\n';
        walk(child);
        continue;
      }
      walk(child);
    }
  };

  walk(root);
  // 貼り付けで入る見えない空白と行末の空白は落とす
  return out.replace(/\u00a0/g, ' ').replace(/[ \t]+$/gm, '');
}
