'use strict';

const wrap = document.getElementById('wrap');
const log = document.getElementById('log');
const input = document.getElementById('input');
const btnSend = document.getElementById('btn-send');
const btnStop = document.getElementById('btn-stop');
const btnCwd = document.getElementById('btn-cwd');
const btnMode = document.getElementById('btn-mode');
const btnHistory = document.getElementById('btn-history');
const sessionsPanel = document.getElementById('sessions');
const sessionList = document.getElementById('session-list');
const attachments = document.getElementById('attachments');

/** 보낼 때 같이 실어 보낼 이미지들 */
const pending = [];

/** 도구 실행 결과를 붙일 자리 — tool_use_id 로 찾는다 */
const toolRows = new Map();

const MODES = [
  { id: 'default', label: '묻기', hint: '위험한 작업은 물어봅니다' },
  { id: 'acceptEdits', label: '자동 승인', hint: '파일 수정을 묻지 않습니다' },
  { id: 'plan', label: '계획만', hint: '파일을 고치지 않고 계획만 세웁니다' },
];
let modeIndex = 0;

let currentSessionId = null; // 목록에서 "지금 이 대화"를 표시하려고 들고 있는다
let stream = null; // 지금 스트리밍 중인 assistant 말풍선
let thinkingEl = null;
let busy = false;
let pinned = true; // 사용자가 위로 스크롤하지 않았으면 계속 아래에 붙인다
let renderQueued = false;

/* ------------------------------------------------------------ 작은 마크다운 */

function inlineNodes(text) {
  const out = [];
  const re = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m;

  while ((m = re.exec(text))) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));

    if (m[1] !== undefined) {
      const code = document.createElement('code');
      code.textContent = m[1];
      out.push(code);
    } else if (m[2] !== undefined) {
      const strong = document.createElement('strong');
      strong.textContent = m[2];
      out.push(strong);
    } else {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = m[3];
      a.dataset.url = m[3];
      out.push(a);
    }
    last = re.lastIndex;
  }

  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

/** 텍스트를 DOM으로 만든다. innerHTML을 쓰지 않으므로 주입 걱정이 없다. */
function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const fence = /```[^\n]*\n?([\s\S]*?)(?:```|$)/g;
  let last = 0;
  let m;

  while ((m = fence.exec(text))) {
    if (m.index > last) frag.append(...inlineNodes(text.slice(last, m.index)));
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = m[1];
    pre.append(code);
    frag.append(pre);
    last = fence.lastIndex;
  }

  if (last < text.length) frag.append(...inlineNodes(text.slice(last)));
  return frag;
}

/* ------------------------------------------------------------------ 로그 조작 */

function clearEmptyState() {
  log.querySelector('.empty')?.remove();
}

function showEmptyState() {
  log.replaceChildren();
  const div = document.createElement('div');
  div.className = 'empty';
  div.append(
    document.createTextNode('안녕! 무엇을 해볼까요?'),
    document.createElement('br')
  );
  const hint = document.createElement('span');
  hint.append(
    document.createTextNode('저를 클릭하거나 '),
    Object.assign(document.createElement('kbd'), { textContent: 'Ctrl+Shift+Space' }),
    document.createTextNode(' 로 부를 수 있어요.'),
    document.createElement('br'),
    Object.assign(document.createElement('kbd'), { textContent: 'Enter' }),
    document.createTextNode(' 전송 · '),
    Object.assign(document.createElement('kbd'), { textContent: 'Shift+Enter' }),
    document.createTextNode(' 줄바꿈 · '),
    Object.assign(document.createElement('kbd'), { textContent: 'Esc' }),
    document.createTextNode(' 닫기'),
    document.createElement('br'),
    Object.assign(document.createElement('kbd'), { textContent: 'Ctrl+V' }),
    document.createTextNode(' 이미지 붙여넣기 · '),
    Object.assign(document.createElement('kbd'), { textContent: '/help' }),
    document.createTextNode(' 명령 목록')
  );
  div.append(hint);
  log.append(div);
}

function add(el) {
  clearEmptyState();
  log.append(el);
  scroll();
  return el;
}

function scroll() {
  if (pinned) log.scrollTop = log.scrollHeight;
}

log.addEventListener('scroll', () => {
  pinned = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
});

log.addEventListener('click', (e) => {
  const url = e.target.closest('a[data-url]')?.dataset.url;
  if (url) {
    e.preventDefault();
    window.chat.openExternal(url);
  }
});

function notice(text, isError = false) {
  const div = document.createElement('div');
  div.className = isError ? 'notice error' : 'notice';
  div.textContent = text;
  add(div);
}

/* ------------------------------------------------------------------ 스트리밍 */

function queueRender() {
  if (renderQueued || !stream) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!stream) return;
    stream.replaceChildren(renderMarkdown(stream.dataset.raw || ''));
    scroll();
  });
}

function endStream() {
  if (stream) {
    stream.classList.remove('streaming');
    stream.replaceChildren(renderMarkdown(stream.dataset.raw || ''));
  }
  stream = null;
}

function endThinking() {
  thinkingEl = null;
}

/* --------------------------------------------------------------- 메인 이벤트 */

window.chat.onEvent((event) => {
  switch (event.type) {
    case 'text-start':
      endThinking();
      endStream();
      stream = add(Object.assign(document.createElement('div'), { className: 'msg assistant streaming' }));
      stream.dataset.raw = '';
      break;

    case 'delta':
      if (!stream) {
        stream = add(Object.assign(document.createElement('div'), { className: 'msg assistant streaming' }));
        stream.dataset.raw = '';
      }
      stream.dataset.raw += event.text;
      queueRender();
      break;

    case 'thinking-start':
      endStream();
      thinkingEl = add(Object.assign(document.createElement('div'), { className: 'thinking' }));
      thinkingEl.textContent = '생각하는 중…';
      thinkingEl.dataset.raw = '';
      break;

    case 'thinking':
      if (!thinkingEl) break;
      thinkingEl.dataset.raw += event.text;
      thinkingEl.textContent = thinkingEl.dataset.raw.slice(-400);
      scroll();
      break;

    case 'tool': {
      endStream();
      endThinking();
      const row = document.createElement('div');
      row.className = 'tool';
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '▶';
      const name = document.createElement('b');
      name.textContent = event.name;
      const arg = document.createElement('span');
      arg.textContent = toolSummary(event.input);
      row.append(caret, name, arg);
      add(row);
      if (event.id) toolRows.set(event.id, row);
      break;
    }

    case 'tool-result': {
      const row = toolRows.get(event.toolUseId);
      if (!row || !event.text?.trim()) break;

      const out = document.createElement('div');
      out.className = event.isError ? 'tool-out error' : 'tool-out';
      out.textContent = event.text.length > 4000 ? `${event.text.slice(0, 4000)}\n…(생략)` : event.text;
      out.hidden = true;
      row.after(out);

      row.classList.add('has-result');
      row.addEventListener('click', () => {
        out.hidden = !out.hidden;
        row.classList.toggle('open', !out.hidden);
        scroll();
      });
      break;
    }

    case 'busy':
      setBusy(event.busy);
      break;

    case 'permission-mode':
      syncMode(event.mode);
      break;

    case 'result':
      endStream();
      endThinking();
      setBusy(false);
      if (event.isError && event.subtype !== 'error_during_execution') {
        notice(`응답이 중단됐어요 (${event.subtype})`, true);
      }
      break;

    case 'error':
      endStream();
      endThinking();
      setBusy(false);
      notice(event.message, true);
      break;

    case 'closed':
      endStream();
      endThinking();
      setBusy(false);
      break;

    default:
      break;
  }
});

function toolSummary(input) {
  if (!input || typeof input !== 'object') return '';
  const candidate =
    input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.url ?? input.description ?? input.prompt;
  if (typeof candidate !== 'string') return '';
  return candidate.length > 100 ? `${candidate.slice(0, 100)}…` : candidate;
}

window.chat.onSession(({ cwd, model, sessionId }) => {
  currentSessionId = sessionId || null;
  if (cwd) {
    btnCwd.textContent = cwd;
    btnCwd.title = `작업 폴더: ${cwd}${model ? `\n모델: ${model}` : ''}\n클릭하면 변경`;
  }
});

window.chat.onReset(({ reason }) => {
  closeSessions();
  showEmptyState();
  stream = null;
  thinkingEl = null;
  setBusy(false);
  if (reason) notice(reason);
});

window.chat.onNotice(({ text }) => notice(text));

/** 앱을 다시 켰을 때 지난 대화를 먼저 깔아둔다. */
window.chat.onHistory(({ items }) => {
  if (!items?.length) return;
  if (log.querySelector('.msg, .tool, .perm')) return; // 이미 이번 대화가 있으면 건드리지 않는다

  log.replaceChildren();

  const divider = document.createElement('div');
  divider.className = 'divider';
  divider.textContent = '지난 대화';
  log.append(divider);

  for (const item of items) {
    if (item.role === 'user') {
      const bubble = document.createElement('div');
      bubble.className = 'msg user';
      bubble.textContent = item.text;
      log.append(bubble);
      continue;
    }

    for (const name of item.tools || []) {
      const row = document.createElement('div');
      row.className = 'tool';
      const label = document.createElement('b');
      label.textContent = name;
      row.append(label);
      log.append(row);
    }

    if (item.text?.trim()) {
      const bubble = document.createElement('div');
      bubble.className = 'msg assistant';
      bubble.append(renderMarkdown(item.text));
      log.append(bubble);
    }
  }

  const here = document.createElement('div');
  here.className = 'divider';
  here.textContent = '여기부터 이어서';
  log.append(here);

  pinned = true;
  scroll();
});

window.chat.onAnchor(({ tail, tailX }) => {
  wrap.classList.toggle('tail-top', tail === 'top');
  wrap.classList.toggle('tail-bottom', tail !== 'top');
  wrap.style.setProperty('--tail-x', `${tailX}px`);
});

window.chat.onFocusInput(() => {
  input.focus();
  pinned = true;
  scroll();
});

/* ------------------------------------------------------------ 지난 대화 목록 */

function relativeTime(ms) {
  if (!ms) return '';
  const minutes = Math.floor((Date.now() - ms) / 60000);
  if (minutes < 1) return '방금';
  if (minutes < 60) return `${minutes}분 전`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;

  const days = Math.floor(hours / 24);
  if (days === 1) return '어제';
  if (days < 7) return `${days}일 전`;

  const d = new Date(ms);
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

function sessionsMessage(text) {
  const div = document.createElement('div');
  div.className = 'sessions-empty';
  div.textContent = text;
  sessionList.replaceChildren(div);
}

function renderSessions({ items = [], currentId = null, error = '' }) {
  if (error) {
    sessionsMessage(`목록을 못 가져왔어요.\n${error}`);
    return;
  }
  if (!items.length) {
    sessionsMessage('이 폴더에서 나눈 대화가 아직 없어요.');
    return;
  }

  const frag = document.createDocumentFragment();

  for (const item of items) {
    const row = document.createElement('button');
    row.className = 'session';
    if (item.sessionId === (currentId || currentSessionId)) row.classList.add('current');

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = item.title || '(제목 없는 대화)';

    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [relativeTime(item.lastModified), item.gitBranch].filter(Boolean).join(' · ');

    row.append(title, meta);
    row.title = `${item.title || ''}\n${item.sessionId}`;
    row.addEventListener('click', () => {
      closeSessions();
      if (item.sessionId === (currentId || currentSessionId)) return;
      window.chat.resumeSession(item.sessionId, item.cwd);
    });

    frag.append(row);
  }

  sessionList.replaceChildren(frag);
}

async function openSessions() {
  sessionsPanel.hidden = false;
  btnHistory.classList.add('on');
  sessionsMessage('불러오는 중…');

  let result;
  try {
    result = await window.chat.listSessions();
  } catch (err) {
    result = { items: [], error: String(err?.message || err) };
  }

  if (sessionsPanel.hidden) return; // 기다리는 사이에 닫았으면 버린다
  renderSessions(result);
  sessionList.querySelector('.session')?.focus();
}

function closeSessions() {
  sessionsPanel.hidden = true;
  btnHistory.classList.remove('on');
}

function toggleSessions() {
  if (sessionsPanel.hidden) openSessions();
  else closeSessions();
}

btnHistory.addEventListener('click', toggleSessions);
document.getElementById('btn-sessions-close').addEventListener('click', closeSessions);
window.chat.onOpenSessions(() => openSessions());

/* ---------------------------------------------------------------- 권한 요청 */

window.chat.onPermission((req) => {
  closeSessions(); // 승인 카드가 목록에 가려지지 않게
  endStream();
  endThinking();

  const card = document.createElement('div');
  card.className = 'perm';

  const title = document.createElement('div');
  title.className = 'perm-title';
  title.textContent = req.title;
  card.append(title);

  if (req.description || req.reason) {
    const desc = document.createElement('div');
    desc.className = 'perm-desc';
    desc.textContent = req.description || req.reason;
    card.append(desc);
  }

  // 파일 수정이면 JSON 대신 바뀌는 줄만 보여준다
  const diff = diffView(req.input);
  if (diff) {
    card.append(diff);
  } else {
    const detail = detailOf(req.input);
    if (detail) {
      const pre = document.createElement('pre');
      pre.textContent = detail;
      card.append(pre);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'perm-actions';

  const buttons = [
    { decision: 'allow', label: '허용', primary: !req.defaultToNo },
    ...(req.canAlwaysAllow ? [{ decision: 'always', label: '항상 허용' }] : []),
    { decision: 'deny', label: '거부', primary: Boolean(req.defaultToNo) },
  ];

  for (const spec of buttons) {
    const btn = document.createElement('button');
    btn.textContent = spec.label;
    if (spec.primary) btn.classList.add('primary');
    btn.addEventListener('click', () => {
      window.chat.respondPermission(req.id, spec.decision);
      card.classList.add('done');
      const done = document.createElement('div');
      done.className = 'perm-desc';
      done.textContent = `→ ${spec.label}`;
      card.append(done);
      input.focus();
    });
    actions.append(btn);
  }

  card.append(actions);
  add(card);

  // 실수로 한 번에 승인되지 않도록, 위험한 요청은 거부 버튼에 포커스를 준다.
  const focusTarget = req.defaultToNo ? actions.lastElementChild : actions.firstElementChild;
  focusTarget?.focus();
});

/** Edit 도구의 old_string/new_string 을 줄 단위로 비교해 보여준다. */
function diffView(input) {
  const before = input?.old_string;
  const after = input?.new_string;
  if (typeof before !== 'string' || typeof after !== 'string') return null;

  const box = document.createElement('div');
  box.className = 'diff';

  const line = (text, cls) => {
    const el = document.createElement('div');
    el.className = cls;
    el.textContent = (cls === 'del' ? '- ' : '+ ') + text;
    box.append(el);
  };

  for (const text of before.split('\n')) line(text, 'del');
  for (const text of after.split('\n')) line(text, 'add');
  return box;
}

function detailOf(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value.command === 'string') return value.command;
  try {
    const text = JSON.stringify(value, null, 2);
    return text.length > 1200 ? `${text.slice(0, 1200)}\n…` : text;
  } catch {
    return String(value);
  }
}

/* -------------------------------------------------------------------- 입력 */

function setBusy(next) {
  busy = next;
  document.body.classList.toggle('busy', busy);
  btnStop.hidden = !busy;
  btnSend.hidden = busy;
}

function autoGrow() {
  input.style.height = 'auto';
  // border-box라서 scrollHeight(테두리 제외)에 테두리 두께를 더해야 스크롤바가 안 생긴다
  const border = input.offsetHeight - input.clientHeight;
  input.style.height = `${Math.min(input.scrollHeight + border, 110)}px`;
  btnSend.disabled = input.value.trim().length === 0;
}

/* ------------------------------------------------------------ 이미지 첨부 */

const MAX_IMAGES = 5;

function addImage(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (pending.length >= MAX_IMAGES) {
    notice(`이미지는 한 번에 ${MAX_IMAGES}장까지예요.`);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const dataUrl = String(reader.result);
    const comma = dataUrl.indexOf(',');
    const item = { mediaType: file.type, data: dataUrl.slice(comma + 1), dataUrl };
    pending.push(item);
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

function renderAttachments() {
  attachments.replaceChildren();
  attachments.hidden = pending.length === 0;

  pending.forEach((item, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = `첨부 이미지 ${i + 1}`;

    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.title = '빼기';
    remove.addEventListener('click', () => {
      pending.splice(i, 1);
      renderAttachments();
    });

    chip.append(img, remove);
    attachments.append(chip);
  });

  autoGrow();
}

input.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.items || [])]
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile());
  if (!files.length) return;
  e.preventDefault(); // 이미지가 있으면 텍스트 붙여넣기는 막는다
  files.forEach(addImage);
});

// 창 어디에든 파일을 끌어다 놓을 수 있게
for (const type of ['dragenter', 'dragover']) {
  window.addEventListener(type, (e) => {
    e.preventDefault();
    document.body.classList.add('dropping');
  });
}
for (const type of ['dragleave', 'drop']) {
  window.addEventListener(type, () => document.body.classList.remove('dropping'));
}
window.addEventListener('drop', (e) => {
  e.preventDefault();
  [...(e.dataTransfer?.files || [])].forEach(addImage);
});

/* -------------------------------------------------------------------- 전송 */

function submit() {
  const text = input.value.trim();
  if (!text && !pending.length) return;

  const bubble = document.createElement('div');
  bubble.className = 'msg user';
  if (text) bubble.textContent = text;

  for (const item of pending) {
    const img = document.createElement('img');
    img.src = item.dataUrl;
    img.alt = '보낸 이미지';
    img.style.maxWidth = '160px';
    img.style.borderRadius = '8px';
    img.style.display = 'block';
    img.style.marginTop = text ? '6px' : '0';
    bubble.append(img);
  }
  add(bubble);

  window.chat.send(text, pending.map(({ mediaType, data }) => ({ mediaType, data })));
  pending.length = 0;
  renderAttachments();

  input.value = '';
  autoGrow();
  pinned = true;
  scroll();
}

input.addEventListener('input', autoGrow);

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!sessionsPanel.hidden) closeSessions();
  else if (busy) window.chat.stop();
  else window.chat.close();
});

/* --------------------------------------------------------------- 권한 모드 */

function applyMode(index, tell = true) {
  modeIndex = (index + MODES.length) % MODES.length;
  const mode = MODES[modeIndex];
  btnMode.textContent = mode.label;
  btnMode.dataset.mode = mode.id;
  btnMode.title = `${mode.hint}\n눌러서 전환`;
  if (tell) window.chat.setPermissionMode(mode.id);
}

btnMode.addEventListener('click', () => applyMode(modeIndex + 1));

/** 메인이 모드를 바꿨을 때(슬래시 명령 등) 버튼도 따라간다 */
function syncMode(id) {
  const i = MODES.findIndex((m) => m.id === id);
  if (i >= 0 && i !== modeIndex) applyMode(i, false);
}

/** 명령 결과처럼 Claude를 거치지 않고 앱이 직접 쓰는 말풍선 */
window.chat.onLocal(({ text }) => {
  endStream();
  const el = add(Object.assign(document.createElement('div'), { className: 'msg assistant' }));
  el.append(renderMarkdown(text));
});

btnSend.addEventListener('click', submit);
btnStop.addEventListener('click', () => window.chat.stop());
btnCwd.addEventListener('click', () => window.chat.pickCwd());
document.getElementById('btn-new').addEventListener('click', () => window.chat.newSession());
document.getElementById('btn-close').addEventListener('click', () => window.chat.close());

showEmptyState();
renderAttachments();
applyMode(0, false); // 버튼 표시만 맞춘다 (메인에 굳이 알리지 않음)
autoGrow();
