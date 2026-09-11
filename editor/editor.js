// エディタの画面側。ブロックを並べて書く方式(Notionのような操作感)で、
// 保存すると src/content/lessons/<courseSlug>/<NN>.md がそのまま書き換わる。
//
// Markdownとブロックの変換は md-blocks.js に分けてある。こちらは表示と操作だけを見る。
// 書き手にMarkdownの記法を覚えさせないのが目的なので、
// docs/content-notation.md のルール(aside・用語リンク・スクショのパス・frontmatter)は
// このUIの中に埋め込んで、選ぶだけで正しい形になるようにしている。

import {
  makeBlock,
  markdownToBlocks,
  parseFrontmatter,
  toFullMarkdown,
  inlineToHtml,
  htmlToInline,
} from './md-blocks.js';

const API = '/__editor/api/';
// 公開サイトはGitHub Pagesのプロジェクトページなので、画像もbase付きのURLで配信される
const BASE = '/Vantan-JuniorHighSchool-Programming';

const $ = (id) => document.getElementById(id);

const el = {
  tree: $('tree'),
  docPath: $('doc-path'),
  docTitle: $('doc-title'),
  doc: $('doc'),
  emptyState: $('empty-state'),
  blocks: $('blocks'),
  dirty: $('dirty'),
  save: $('save'),
  showMd: $('show-md'),
  previewLink: $('preview-link'),
  appendBlock: $('append-block'),
  shotSummary: $('shot-summary'),
  slashMenu: $('slash-menu'),
  toast: $('toast'),
  undo: $('undo'),
  redo: $('redo'),
  fm: {
    title: $('fm-title'),
    order: $('fm-order'),
    status: $('fm-status'),
    note: $('fm-note'),
  },
};

const state = {
  courses: [],
  wikiTerms: [],
  current: null, // { course, nn, relPath }
  frontmatter: {},
  blocks: [],
  dirty: false,
};

// ---------------------------------------------------------------- 元に戻す

// ブラウザの標準のundo(Ctrl+Z)は、ブロックを作り直した時点で効かなくなるうえ、
// 「ブロックを消した」「種類を変えた」のような操作は最初から対象外になる。
// そのため、本文とfrontmatterの状態そのものを履歴として持っておく。
//
// 文字入力は1文字ずつ積むと戻すのが大変なので、打ち終わって少し経ってから1件にまとめる。
// ブロックを足した・消した・種類を変えたといった操作は、その場で1件として積む。
const HISTORY_LIMIT = 200;
const TYPING_MERGE_MS = 600;

const history = { past: [], future: [], baseline: null, timer: null };
let savedSnapshot = null; // 最後に保存した内容(未保存マークの判定に使う)

// exists(スクショの実体があるか)は表示のためだけの印で、画像の読み込みが終わった時に
// あとから書き換わる。履歴に含めると「何も操作していないのに変更があった」ことになり、
// やり直し(redo)の履歴が消えてしまうので外す。
const snapshot = () =>
  JSON.stringify({
    fm: state.frontmatter,
    blocks: state.blocks.map(({ exists, ...rest }) => rest),
  });

function resetHistory() {
  history.past = [];
  history.future = [];
  clearTimeout(history.timer);
  history.timer = null;
  history.baseline = snapshot();
  updateHistoryButtons();
}

function commitHistory() {
  clearTimeout(history.timer);
  history.timer = null;
  const now = snapshot();
  if (now === history.baseline) return;
  history.past.push(history.baseline);
  if (history.past.length > HISTORY_LIMIT) history.past.shift();
  history.future = [];
  history.baseline = now;
  updateHistoryButtons();
}

function recordHistory(immediate = false) {
  if (!state.current) return;
  clearTimeout(history.timer);
  if (immediate) commitHistory();
  else history.timer = setTimeout(commitHistory, TYPING_MERGE_MS);
}

function undo() {
  commitHistory(); // 打ちかけの分もひとまとまりとして確定させてから戻す
  if (history.past.length === 0) {
    toast('これ以上は戻せません');
    return;
  }
  history.future.push(history.baseline);
  applySnapshot(history.past.pop());
  toast('元に戻しました');
}

function redo() {
  commitHistory();
  if (history.future.length === 0) {
    toast('やり直せる操作はありません');
    return;
  }
  history.past.push(history.baseline);
  applySnapshot(history.future.pop());
  toast('やり直しました');
}

function applySnapshot(json) {
  history.baseline = json;
  const data = JSON.parse(json);
  state.frontmatter = data.fm;
  state.blocks = data.blocks;
  fillFrontmatterForm();
  render();
  // 保存した時の内容まで戻ったら「未保存」の表示も消す
  setDirty(json !== savedSnapshot);
  updateHistoryButtons();
}

function updateHistoryButtons() {
  el.undo.disabled = history.past.length === 0 && history.timer === null;
  el.redo.disabled = history.future.length === 0;
}

// ---------------------------------------------------------------- 通信

async function api(action, { method = 'GET', body, query } = {}) {
  const url = new URL(API + action, location.origin);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `通信に失敗しました (${res.status})`);
  return data;
}

let toastTimer = null;
function toast(message, isError = false) {
  el.toast.textContent = message;
  el.toast.classList.toggle('error', isError);
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), isError ? 6000 : 2600);
}

// ---------------------------------------------------------------- 一覧

async function loadTree() {
  const data = await api('tree');
  state.courses = data.courses;
  state.wikiTerms = data.wikiTerms;
  renderTree();
  renderNewDialogCourses();
}

function renderTree() {
  el.tree.innerHTML = '';
  for (const course of state.courses) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-course';

    const name = document.createElement('div');
    name.className = 'tree-course-name';
    name.innerHTML = `<span>${escapeText(course.title)}</span><span class="tree-course-period">${escapeText(course.period)}</span>`;
    wrap.appendChild(name);

    for (const lesson of course.lessons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tree-lesson';
      const isCurrent = state.current?.course === course.slug && state.current?.nn === lesson.nn;
      if (isCurrent) button.setAttribute('aria-current', 'true');

      const badges = [];
      if (lesson.status !== 'complete') {
        badges.push(`<span class="badge ${lesson.status}">${lesson.status === 'draft' ? '制作中' : '準備中'}</span>`);
      }
      if (lesson.shots.total > 0 && lesson.shots.ready < lesson.shots.total) {
        badges.push(`<span class="badge shots">📸${lesson.shots.ready}/${lesson.shots.total}</span>`);
      }
      button.innerHTML = `<span class="tree-lesson-title">${escapeText(lesson.title)}</span>${badges.join('')}`;
      button.addEventListener('click', () => openLesson(course.slug, lesson.nn));
      wrap.appendChild(button);
    }

    if (course.lessons.length === 0) {
      const none = document.createElement('div');
      none.className = 'tree-lesson-title';
      none.style.padding = '4px 8px';
      none.style.color = 'var(--muted)';
      none.textContent = 'まだ回がありません';
      wrap.appendChild(none);
    }

    el.tree.appendChild(wrap);
  }
}

function escapeText(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

// ---------------------------------------------------------------- 開く / 保存

async function openLesson(course, nn) {
  if (state.dirty && !confirm('保存していない変更があります。破棄して別の回を開きますか？')) return;

  const data = await api('lesson', { query: { course, nn } });
  const { data: frontmatter, body } = parseFrontmatter(data.markdown);

  state.current = { course, nn, relPath: data.relPath };
  state.frontmatter = frontmatter;
  state.blocks = markdownToBlocks(body);
  setDirty(false);

  el.emptyState.hidden = true;
  el.doc.hidden = false;
  el.save.disabled = false;
  el.showMd.disabled = false;
  el.docPath.textContent = data.relPath;
  el.docTitle.textContent = frontmatter.title ?? '';
  el.previewLink.hidden = false;
  el.previewLink.href = `${BASE}/courses/${course}/${nn}/`;

  fillFrontmatterForm();
  // 読み込んだ値をフォーム経由の形に揃えておく(order は文字列で読めるので数値にするなど)。
  // ここで揃えておかないと、あとで保存やプレビューのたびに中身が変わったと判定され、
  // やり直し(redo)の履歴が消えてしまう。
  syncFrontmatterFromForm();

  render();
  renderTree();
  resetHistory();
  savedSnapshot = snapshot();
  window.scrollTo({ top: 0 });
}

function fillFrontmatterForm() {
  const fm = state.frontmatter;
  el.fm.title.value = fm.title ?? '';
  el.fm.order.value = fm.order ?? Number(state.current?.nn ?? 0);
  el.fm.status.value = fm.status ?? 'complete';
  el.fm.note.value = fm.note ?? '';
  el.docTitle.textContent = fm.title ?? '';
}

function setDirty(value) {
  state.dirty = value;
  el.dirty.hidden = !value;
}

async function save() {
  if (!state.current) return;
  syncFrontmatterFromForm();
  const markdown = toFullMarkdown(state.frontmatter, state.blocks);
  try {
    await api('lesson', {
      method: 'POST',
      body: { course: state.current.course, nn: state.current.nn, markdown },
    });
    commitHistory();
    savedSnapshot = snapshot();
    setDirty(false);
    toast('保存しました');
    await loadTree();
    renderShotSummary();
  } catch (err) {
    toast(err.message, true);
  }
}

function syncFrontmatterFromForm() {
  const fm = state.frontmatter;
  fm.course = state.current.course;
  fm.order = Number(el.fm.order.value);
  fm.title = el.fm.title.value.trim();
  fm.status = el.fm.status.value;
  const note = el.fm.note.value.trim();
  if (note) fm.note = note;
  else delete fm.note;
}

for (const field of Object.values(el.fm)) {
  field.addEventListener('input', () => {
    setDirty(true);
    recordHistory(false);
    if (field === el.fm.title) el.docTitle.textContent = field.value;
  });
}

// ---------------------------------------------------------------- 描画

function render() {
  el.blocks.innerHTML = '';
  let numberCounter = 0;

  state.blocks.forEach((block, index) => {
    if (block.type === 'number') {
      numberCounter = state.blocks[index - 1]?.type === 'number' ? numberCounter + 1 : 1;
    }
    el.blocks.appendChild(renderBlock(block, numberCounter));
  });

  renderShotSummary();
}

function renderShotSummary() {
  const images = state.blocks.filter((b) => b.type === 'image');
  if (images.length === 0) {
    el.shotSummary.textContent = 'この回にはまだスクショがありません。';
    el.shotSummary.classList.remove('warn');
    return;
  }
  const missing = images.filter((b) => !b.exists).length;
  if (missing === 0) {
    el.shotSummary.textContent = `スクショ ${images.length}枚 すべて揃っています。statusを complete にできます。`;
    el.shotSummary.classList.remove('warn');
  } else {
    el.shotSummary.textContent = `スクショ ${images.length}枚のうち ${missing}枚がまだありません(授業のあとに貼れます)。`;
    el.shotSummary.classList.add('warn');
  }
}

function renderBlock(block, numberCounter) {
  const wrap = document.createElement('div');
  wrap.className = `block block-${blockClass(block)}`;
  wrap.dataset.id = block.id;
  wrap.appendChild(renderTools(block));

  switch (block.type) {
    case 'heading':
    case 'paragraph':
      wrap.appendChild(makeEditable(block, placeholderFor(block)));
      break;
    case 'bullet':
    case 'number': {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.textContent = block.type === 'bullet' ? '•' : `${numberCounter}.`;
      wrap.appendChild(marker);
      wrap.appendChild(makeEditable(block, block.type === 'bullet' ? '箇条書き' : '操作の手順'));
      break;
    }
    case 'aside':
      wrap.appendChild(renderAside(block));
      break;
    case 'image':
      wrap.appendChild(renderImage(block));
      break;
    case 'wiki':
      wrap.appendChild(renderWiki(block));
      break;
    case 'url':
      wrap.appendChild(renderUrl(block));
      break;
    default:
      wrap.appendChild(renderRaw(block));
  }

  return wrap;
}

function blockClass(block) {
  if (block.type === 'heading') return `h${block.level}`;
  return block.type;
}

function placeholderFor(block) {
  if (block.type === 'heading') {
    if (block.level === 1) return 'セクションの見出し(目標 / 見本 / やってみよう / 終わり)';
    if (block.level === 2) return '大きなまとまりの見出し';
    return '手順の見出し';
  }
  return '本文を書く("/" でブロックを選べます)';
}

// ブロックの左に出る小さなボタン(種類を変える・消す)
function renderTools(block) {
  const tools = document.createElement('div');
  tools.className = 'block-tools';

  // 「このブロックの下に足す」。スクショやコールアウトの下にはEnterで足せないので、
  // 途中に差し込む手段としてこのボタンが要る。
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tool';
  add.title = 'この下にブロックを足す';
  add.textContent = '＋';
  add.addEventListener('click', (event) => {
    event.preventDefault();
    // このクリックが下の「メニューの外側を押したら閉じる」処理まで届くと、
    // 開いたメニューがその場で閉じてしまう
    event.stopPropagation();
    const created = makeBlock('paragraph');
    insertBlockAfter(block, created, 'start');
    // そのまま種類を選べるように、足した直後にメニューを開く
    const node = el.blocks.querySelector(`[data-id="${created.id}"] .editable`);
    if (node) openSlashMenu(created, node, { clearText: true });
  });
  tools.appendChild(add);

  const menu = document.createElement('button');
  menu.type = 'button';
  menu.className = 'tool';
  menu.title = 'ブロックの種類を変える';
  menu.textContent = '⠿';
  menu.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSlashMenu(block, menu, { replace: true });
  });
  tools.appendChild(menu);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tool';
  remove.title = 'このブロックを消す';
  remove.textContent = '×';
  remove.addEventListener('click', () => {
    removeBlockAt(indexOf(block.id));
    if (state.blocks.length === 0) {
      state.blocks.push(makeBlock('paragraph'));
      render();
    }
  });
  tools.appendChild(remove);

  return tools;
}

// 文字を書ける場所を作る。中身は行内Markdown(**太字** など)をHTMLに直して入れる。
function makeEditable(block, placeholder, target = block) {
  const node = document.createElement('div');
  node.className = 'editable';
  node.contentEditable = 'true';
  node.dataset.placeholder = placeholder;
  node.innerHTML = inlineToHtml(target.text ?? '');
  updateEmptyFlag(node);

  node.addEventListener('input', () => {
    target.text = htmlToInline(node);
    updateEmptyFlag(node);
    setDirty(true);
    recordHistory(false);
    if (!maybeApplyShortcut(block, node, target)) maybeSlash(block, node, target);
  });

  node.addEventListener('keydown', (event) => onEditableKeydown(event, block, node, target));
  node.addEventListener('blur', () => (target.text = htmlToInline(node)));
  return node;
}

function updateEmptyFlag(node) {
  node.dataset.empty = node.textContent.trim() === '' ? 'true' : 'false';
}

// 「# 」「- 」「1. 」と打ったらその場でブロックの種類を変える(Markdownを覚えなくてよくするため)
function maybeApplyShortcut(block, node, target) {
  if (target !== block) return false; // asideの中では使わない
  const text = node.textContent;

  const heading = text.match(/^(#{1,3})\s(.*)$/);
  if (heading) {
    replaceBlock(block, makeBlock('heading', { level: heading[1].length, text: heading[2] }), 'end');
    return true;
  }
  const bullet = text.match(/^[-*]\s(.*)$/);
  if (bullet) {
    replaceBlock(block, makeBlock('bullet', { text: bullet[1] }), 'end');
    return true;
  }
  const number = text.match(/^\d+\.\s(.*)$/);
  if (number) {
    replaceBlock(block, makeBlock('number', { text: number[1] }), 'end');
    return true;
  }
  return false;
}

function maybeSlash(block, node, target) {
  const text = node.textContent;
  if (!text.startsWith('/')) {
    closeSlashMenu();
    return;
  }
  openSlashMenu(block, node, { query: text.slice(1), clearText: true, target });
}

function onEditableKeydown(event, block, node, target) {
  if (slash.open) {
    if (handleSlashKeydown(event)) return;
  }

  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    target.text = htmlToInline(node);

    // 空のリスト項目でEnter → 本文に戻す(リストを抜ける)
    if (target === block && ['bullet', 'number'].includes(block.type) && node.textContent.trim() === '') {
      replaceBlock(block, makeBlock('paragraph'), 'end');
      return;
    }

    const tail = cutAfterCaret(node);
    target.text = htmlToInline(node);

    if (target === block) {
      const nextType = ['bullet', 'number'].includes(block.type) ? block.type : 'paragraph';
      insertBlockAfter(block, makeBlock(nextType, { text: tail }), 'start');
    } else {
      // コールアウトの中。同じ種類の項目を1つ足す
      const items = block.items;
      const at = items.indexOf(target);
      items.splice(at + 1, 0, { kind: target.kind, text: tail });
      setDirty(true);
      recordHistory(true);
      render();
      focusAsideItem(block.id, at + 1, 'start');
    }
    return;
  }

  if (event.key === 'Backspace' && caretAtStart(node)) {
    // 見出し・リストは、まず「ただの本文」に戻す。1回の操作で消えてしまわないように
    if (target === block && block.type !== 'paragraph') {
      event.preventDefault();
      replaceBlock(block, makeBlock('paragraph', { text: htmlToInline(node) }), 'start');
      return;
    }

    if (target !== block) {
      const items = block.items;
      const at = items.indexOf(target);
      if (items.length > 1 && node.textContent.trim() === '') {
        event.preventDefault();
        items.splice(at, 1);
        setDirty(true);
        recordHistory(true);
        render();
        focusAsideItem(block.id, Math.max(0, at - 1), 'end');
      }
      return;
    }

    // 前のブロックが文字を書ける種類なら、そこにつなげる
    const index = indexOf(block.id);
    const previous = state.blocks[index - 1];
    if (!previous) return;
    if (!['paragraph', 'heading', 'bullet', 'number'].includes(previous.type)) return;

    event.preventDefault();
    const offset = (previous.text ?? '').length;
    previous.text = (previous.text ?? '') + htmlToInline(node);
    removeBlockAt(index);
    // 結合後の文字を反映するため、前のブロックだけ描き直す
    replaceBlock(previous, { ...previous }, offset);
  }
}

// 置き換え(見出し ⇄ 本文 など)と挿入は、そのブロックのDOMだけ差し替える。
// 1つの回に100個以上のブロックがあるので、Enterのたびに全体を描き直すと
// 打っている途中の文字を取りこぼすことがある。
function replaceBlock(block, created, caret) {
  const index = indexOf(block.id);
  state.blocks.splice(index, 1, created);
  const node = el.blocks.querySelector(`[data-id="${block.id}"]`);
  if (node) node.replaceWith(renderBlock(created, numberAt(index)));
  else render();
  afterStructureChange();
  focusBlock(created.id, caret);
}

function insertBlockAfter(block, created, caret) {
  const index = indexOf(block.id);
  state.blocks.splice(index + 1, 0, created);
  const node = el.blocks.querySelector(`[data-id="${block.id}"]`);
  if (node) node.after(renderBlock(created, numberAt(index + 1)));
  else render();
  afterStructureChange();
  focusBlock(created.id, caret);
}

function removeBlockAt(index) {
  const [removed] = state.blocks.splice(index, 1);
  el.blocks.querySelector(`[data-id="${removed.id}"]`)?.remove();
  afterStructureChange();
}

function afterStructureChange() {
  setDirty(true);
  recordHistory(true);
  renumberList();
  renderShotSummary();
}

// 番号付きリストの「1. 2. 3.」を振り直す(途中に足したり消したりした後)
function renumberList() {
  let counter = 0;
  state.blocks.forEach((block, index) => {
    if (block.type !== 'number') return;
    counter = state.blocks[index - 1]?.type === 'number' ? counter + 1 : 1;
    const marker = el.blocks.querySelector(`[data-id="${block.id}"] .list-marker`);
    if (marker) marker.textContent = `${counter}.`;
  });
}

function numberAt(index) {
  if (state.blocks[index]?.type !== 'number') return 0;
  let counter = 1;
  for (let i = index - 1; i >= 0 && state.blocks[i].type === 'number'; i -= 1) counter += 1;
  return counter;
}

const indexOf = (id) => state.blocks.findIndex((b) => b.id === id);

// caretより後ろを切り取って、行内Markdownとして返す(Enterで段落を分けるため)
function cutAfterCaret(node) {
  const selection = window.getSelection();
  if (!selection.rangeCount) return '';
  const range = selection.getRangeAt(0);
  const tailRange = document.createRange();
  tailRange.selectNodeContents(node);
  tailRange.setStart(range.endContainer, range.endOffset);
  const holder = document.createElement('div');
  holder.appendChild(tailRange.extractContents());
  return htmlToInline(holder);
}

function caretAtStart(node) {
  const selection = window.getSelection();
  if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  const before = document.createRange();
  before.selectNodeContents(node);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length === 0;
}

function focusBlock(id, caret = 'end') {
  const wrap = el.blocks.querySelector(`[data-id="${id}"]`);
  const node = wrap?.querySelector('.editable, textarea, input, select');
  if (!node) return;
  node.focus();
  if (node.classList?.contains('editable')) placeCaret(node, caret);
}

function focusAsideItem(id, itemIndex, caret = 'end') {
  const wrap = el.blocks.querySelector(`[data-id="${id}"]`);
  const nodes = wrap?.querySelectorAll('.aside-item .editable');
  const node = nodes?.[itemIndex];
  if (!node) return;
  node.focus();
  placeCaret(node, caret);
}

function placeCaret(node, caret) {
  const range = document.createRange();
  const selection = window.getSelection();
  if (caret === 'start') {
    range.setStart(node, 0);
  } else if (typeof caret === 'number') {
    // だいたいの位置でよい(文字数から探す)。装飾をまたぐ時は末尾に寄せる
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let remaining = caret;
    let placed = false;
    let textNode;
    while ((textNode = walker.nextNode())) {
      if (remaining <= textNode.nodeValue.length) {
        range.setStart(textNode, remaining);
        placed = true;
        break;
      }
      remaining -= textNode.nodeValue.length;
    }
    if (!placed) range.selectNodeContents(node);
    if (!placed) range.collapse(false);
  } else {
    range.selectNodeContents(node);
    range.collapse(false);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

// ---------------------------------------------------------------- コールアウト

function renderAside(block) {
  const box = document.createElement('div');
  box.className = 'aside-box';

  const icon = document.createElement('input');
  icon.className = 'aside-icon-input';
  icon.value = block.icon || '💡';
  icon.maxLength = 4;
  icon.title = '絵文字(基本は💡)';
  icon.addEventListener('input', () => {
    block.icon = icon.value.trim() || '💡';
    setDirty(true);
    recordHistory(false);
  });
  box.appendChild(icon);

  const items = document.createElement('div');
  items.className = 'aside-items';
  let counter = 0;
  block.items.forEach((item, index) => {
    if (item.kind === 'number') {
      counter = block.items[index - 1]?.kind === 'number' ? counter + 1 : 1;
    }
    const row = document.createElement('div');
    row.className = 'aside-item';
    if (item.kind !== 'p') {
      const marker = document.createElement('span');
      marker.className = 'list-marker';
      marker.textContent = item.kind === 'bullet' ? '•' : `${counter}.`;
      row.appendChild(marker);
    }
    row.appendChild(makeEditable(block, 'なぜこれをするのか → 何をするのか', item));
    items.appendChild(row);
  });
  box.appendChild(items);

  const hint = document.createElement('p');
  hint.className = 'aside-hint';
  hint.textContent = '「なぜ・何をするか」を書く場所です。具体的な操作手順は、この外の番号付きリストに書きます。';
  const wrap = document.createElement('div');
  wrap.appendChild(box);
  wrap.appendChild(hint);
  return wrap;
}

// ---------------------------------------------------------------- スクショ

function renderImage(block) {
  const box = document.createElement('div');
  box.className = 'shot';

  // 実体があるか調べて、無ければ公開サイトと同じ「準備中」表示にする
  const figure = document.createElement('figure');
  figure.className = 'shot-figure';
  const img = document.createElement('img');
  img.alt = block.alt || '';
  img.src = BASE + block.url;
  img.addEventListener('load', () => {
    block.exists = true;
    renderShotSummary();
  });
  img.addEventListener('error', () => {
    block.exists = false;
    figure.innerHTML =
      '<div class="shot-missing"><div>📸 スクリーンショット準備中</div>' +
      '<div>授業で撮ったら、この枠を選んで Ctrl+V で貼れます</div></div>';
    renderShotSummary();
  });
  figure.appendChild(img);
  box.appendChild(figure);

  const foot = document.createElement('div');
  foot.className = 'shot-foot';

  const path = document.createElement('span');
  path.className = 'shot-path';
  path.textContent = block.url;
  foot.appendChild(path);

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'mini-button';
  pick.textContent = '画像ファイルを選ぶ';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/*';
  file.hidden = true;
  pick.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    if (file.files?.[0]) await uploadInto(block, file.files[0]);
    file.value = '';
  });
  foot.appendChild(pick);
  foot.appendChild(file);
  box.appendChild(foot);

  // この枠を選んだ状態でCtrl+Vすると、クリップボードの画像がここに入る
  box.tabIndex = 0;
  box.addEventListener('paste', async (event) => {
    const imageFile = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!imageFile) return;
    event.preventDefault();
    await uploadInto(block, imageFile);
  });

  return box;
}

async function uploadInto(block, file) {
  try {
    const dataUrl = await readAsDataUrl(file);
    // すでにパスが決まっているブロックは、同じファイル名に上書きする
    // (本文のパスが変わらないので、書いた資料に手を入れなくて済む)
    const name = block.url.split('/').pop();
    const keepName = name && /^image-\d+\.(png|jpe?g|gif|webp)$/i.test(name) ? name : undefined;
    const saved = await api('image', {
      method: 'POST',
      body: {
        course: state.current.course,
        nn: state.current.nn,
        dataUrl,
        name: keepName,
      },
    });
    block.url = saved.url;
    block.exists = true;
    setDirty(true);
    recordHistory(true);
    render();
    toast(`画像を入れました: ${saved.name}`);
  } catch (err) {
    toast(err.message, true);
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
    reader.readAsDataURL(file);
  });
}

// どこで貼っても拾えるようにしておく(授業中にスクショを続けて貼るため)。
// スクショの枠を選んでいない時は、新しいスクショのブロックを足してそこに入れる。
document.addEventListener('paste', async (event) => {
  if (!state.current) return;
  if (event.target.closest?.('.shot')) return; // 枠側で処理済み
  const imageFile = [...(event.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (!imageFile) return;
  event.preventDefault();

  const focusedBlock = event.target.closest?.('.block');
  const index = focusedBlock ? indexOf(focusedBlock.dataset.id) + 1 : state.blocks.length;
  const created = makeBlock('image', { url: nextImageUrl() });
  state.blocks.splice(index, 0, created);
  setDirty(true);
  recordHistory(true);
  render();
  await uploadInto(created, imageFile);
});

// 本文で使われていない一番小さい image-N.png を返す(既存の命名規則に合わせる)
function nextImageUrl() {
  const used = new Set(
    state.blocks
      .filter((b) => b.type === 'image')
      .map((b) => Number(b.url.match(/image-(\d+)\./)?.[1]))
      .filter((n) => Number.isInteger(n))
  );
  let i = 0;
  while (used.has(i)) i += 1;
  return `/lessons/${state.current.course}/${state.current.nn}/image-${i}.png`;
}

// ---------------------------------------------------------------- 用語カード

function renderWiki(block) {
  const box = document.createElement('div');
  box.className = 'wiki-box';

  const badge = document.createElement('span');
  badge.textContent = '📖';
  box.appendChild(badge);

  const select = document.createElement('select');
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '用語を選ぶ…';
  select.appendChild(placeholder);

  const known = new Set();
  for (const term of state.wikiTerms) {
    const option = document.createElement('option');
    option.value = term.plain;
    option.textContent = term.title;
    select.appendChild(option);
    known.add(term.plain);
    known.add(term.title);
  }

  // Scratch wikiに無い用語が書かれていた場合(用語ページを作る前など)は、
  // 消さずに残したうえで警告を出す。npm run check でもエラーになる。
  if (block.term && !known.has(block.term)) {
    const option = document.createElement('option');
    option.value = block.term;
    option.textContent = `${block.term}(wikiに無い)`;
    select.appendChild(option);
  }

  select.value = block.term ?? '';
  select.addEventListener('change', () => {
    block.term = select.value;
    setDirty(true);
    recordHistory(true);
    render();
  });
  box.appendChild(select);

  if (block.term && !known.has(block.term)) {
    const warn = document.createElement('span');
    warn.className = 'wiki-warn';
    warn.textContent = 'この用語のページがScratch wikiにありません';
    box.appendChild(warn);
  }

  const note = document.createElement('span');
  note.className = 'url-kind';
  note.textContent = '用語をおさらい →';
  box.appendChild(note);

  return box;
}

// ---------------------------------------------------------------- 裸URL

function renderUrl(block) {
  const box = document.createElement('div');
  box.className = 'url-box';

  const input = document.createElement('input');
  input.type = 'url';
  input.value = block.url ?? '';
  input.placeholder = 'https://scratch.mit.edu/projects/…';
  const kind = document.createElement('span');
  kind.className = 'url-kind';

  const updateKind = () => {
    if (/scratch\.mit\.edu\/projects\//.test(input.value)) kind.textContent = '「先生の見本プロジェクト」と表示されます';
    else if (/(forms\.gle|docs\.google\.com\/forms)/.test(input.value)) kind.textContent = '「今日のひとことフォーム」と表示されます';
    else kind.textContent = 'そのままリンクになります';
  };
  updateKind();

  input.addEventListener('input', () => {
    block.url = input.value.trim();
    updateKind();
    setDirty(true);
    recordHistory(false);
  });

  box.appendChild(input);
  box.appendChild(kind);
  return box;
}

// ------------------------------------------------------- そのまま保存される部分

function renderRaw(block) {
  const box = document.createElement('div');
  box.className = 'raw-box';

  const label = document.createElement('div');
  label.className = 'raw-label';
  label.textContent = 'そのまま保存される部分(表や特別な書き方。触らなければ元のまま残ります)';
  box.appendChild(label);

  const area = document.createElement('textarea');
  area.value = block.text ?? '';
  area.rows = Math.min(14, (block.text ?? '').split('\n').length + 1);
  area.addEventListener('input', () => {
    block.text = area.value;
    setDirty(true);
    recordHistory(false);
  });
  box.appendChild(area);
  return box;
}

// ---------------------------------------------------------------- "/" メニュー

const SLASH_ITEMS = [
  { icon: '📄', label: '本文', desc: 'ふつうの文章', keys: 'ほんぶん text', make: () => makeBlock('paragraph') },
  { icon: 'H1', label: '見出し(大)', desc: '目標 / 見本 / やってみよう / 終わり', keys: 'h1 midashi', make: () => makeBlock('heading', { level: 1 }) },
  { icon: 'H2', label: '見出し(中)', desc: '大きなまとまり', keys: 'h2 midashi', make: () => makeBlock('heading', { level: 2 }) },
  { icon: 'H3', label: '見出し(小)', desc: '1つの手順', keys: 'h3 midashi', make: () => makeBlock('heading', { level: 3 }) },
  { icon: '•', label: '箇条書き', desc: '目標などの列挙', keys: 'list bullet kajougaki', make: () => makeBlock('bullet') },
  { icon: '1.', label: '番号付きリスト', desc: 'Scratchでの操作手順', keys: 'number bangou tejun', make: () => makeBlock('number') },
  { icon: '💡', label: 'コールアウト', desc: 'なぜ・何をするかの説明', keys: 'aside callout setsumei', make: () => makeBlock('aside') },
  { icon: '📸', label: 'スクショ', desc: '授業のあとに貼ってもOK', keys: 'image shot gazou', make: () => makeBlock('image', { url: nextImageUrl() }) },
  { icon: '📖', label: '用語カード', desc: 'Scratch wikiの用語リンク', keys: 'wiki yougo term', make: () => makeBlock('wiki') },
  { icon: '🔗', label: 'URLの行', desc: '見本プロジェクト / ひとことフォーム', keys: 'url link mihon form', make: () => makeBlock('url') },
];

const slash = { open: false, index: 0, items: [], target: null, block: null, clearText: false };

function openSlashMenu(block, anchor, { query = '', replace = false, clearText = false, target = null } = {}) {
  const q = query.trim().toLowerCase();
  const items = q
    ? SLASH_ITEMS.filter((item) => `${item.label}${item.keys}${item.desc}`.toLowerCase().includes(q))
    : SLASH_ITEMS;

  if (items.length === 0) {
    closeSlashMenu();
    return;
  }

  slash.open = true;
  slash.index = 0;
  slash.items = items;
  slash.block = block;
  slash.replace = replace || clearText;
  slash.clearText = clearText;
  slash.target = target;

  el.slashMenu.innerHTML = '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slash-item';
    button.dataset.active = String(index === 0);
    button.innerHTML =
      `<span class="slash-icon">${item.icon}</span>` +
      `<span><span class="slash-label">${item.label}</span><br><span class="slash-desc">${item.desc}</span></span>`;
    button.addEventListener('mousedown', (event) => {
      event.preventDefault();
      chooseSlash(index);
    });
    el.slashMenu.appendChild(button);
  });

  const rect = anchor.getBoundingClientRect();
  el.slashMenu.hidden = false;
  el.slashMenu.style.top = `${rect.bottom + window.scrollY + 4}px`;
  el.slashMenu.style.left = `${rect.left + window.scrollX}px`;
}

function closeSlashMenu() {
  slash.open = false;
  el.slashMenu.hidden = true;
}

function handleSlashKeydown(event) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    slash.index = (slash.index + delta + slash.items.length) % slash.items.length;
    [...el.slashMenu.children].forEach((child, i) => (child.dataset.active = String(i === slash.index)));
    return true;
  }
  if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault();
    chooseSlash(slash.index);
    return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    closeSlashMenu();
    return true;
  }
  return false;
}

function chooseSlash(index) {
  const item = slash.items[index];
  const block = slash.block;
  closeSlashMenu();
  if (!item || !block) return;

  const created = item.make();
  // 「/」で呼び出した時は打った文字を消す。左のボタンから呼んだ時は文字を引き継ぐ
  if (!slash.clearText && ['paragraph', 'heading', 'bullet', 'number'].includes(created.type)) {
    created.text = block.text ?? '';
  }
  replaceBlock(block, created, 'end');
}

document.addEventListener('click', (event) => {
  if (slash.open && !el.slashMenu.contains(event.target)) closeSlashMenu();
});

// ---------------------------------------------------------------- そのほかの操作

el.save.addEventListener('click', save);

el.appendBlock.addEventListener('click', () => {
  const created = makeBlock('paragraph');
  state.blocks.push(created);
  el.blocks.appendChild(renderBlock(created, 0));
  afterStructureChange();
  focusBlock(created.id, 'start');
});

el.showMd.addEventListener('click', () => {
  syncFrontmatterFromForm();
  $('md-output').textContent = toFullMarkdown(state.frontmatter, state.blocks);
  $('md-dialog').showModal();
});

$('run-check').addEventListener('click', async () => {
  toast('記法チェックを実行しています…');
  const result = await api('check', { method: 'POST' });
  $('check-output').textContent = result.output || '(出力なし)';
  $('check-dialog').showModal();
});

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => button.closest('dialog').close());
}

// 新しい回を作る
function renderNewDialogCourses() {
  const select = $('new-course');
  select.innerHTML = '';
  for (const course of state.courses) {
    const option = document.createElement('option');
    option.value = course.slug;
    option.textContent = `${course.title}(${course.period || course.slug})`;
    select.appendChild(option);
  }
  if (state.current) select.value = state.current.course;
}

$('new-lesson').addEventListener('click', () => {
  renderNewDialogCourses();
  const course = state.courses.find((c) => c.slug === $('new-course').value);
  const last = course?.lessons.at(-1)?.order ?? -1;
  $('new-order').value = last + 1;
  $('new-error').hidden = true;
  $('new-dialog').showModal();
});

$('new-create').addEventListener('click', async () => {
  const course = $('new-course').value;
  const order = Number($('new-order').value);
  const title = $('new-title').value.trim();
  if (!title) {
    $('new-error').textContent = 'タイトルを入れてください。';
    $('new-error').hidden = false;
    return;
  }
  try {
    await api('new-lesson', {
      method: 'POST',
      body: { course, order, title, steps: Number($('new-steps').value) },
    });
    $('new-dialog').close();
    $('new-title').value = '';
    await loadTree();
    await openLesson(course, String(order).padStart(2, '0'));
    toast('新しい回を作りました');
  } catch (err) {
    $('new-error').textContent = err.message;
    $('new-error').hidden = false;
  }
});

el.undo.addEventListener('click', undo);
el.redo.addEventListener('click', redo);

document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();

  if (key === 's') {
    event.preventDefault();
    save();
    return;
  }
  // ブラウザ標準のundoは、ブロックを作り直すと効かなくなるので必ず横取りする
  if (key === 'z' && !event.shiftKey) {
    event.preventDefault();
    undo();
    return;
  }
  if ((key === 'z' && event.shiftKey) || key === 'y') {
    event.preventDefault();
    redo();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

loadTree().catch((err) => toast(err.message, true));
