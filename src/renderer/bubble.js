'use strict';

const wrap = document.getElementById('wrap');
const log = document.getElementById('log');
const input = document.getElementById('input');
const btnSend = document.getElementById('btn-send');
const btnStop = document.getElementById('btn-stop');
const btnCwd = document.getElementById('btn-cwd');

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
    document.createTextNode(' 닫기')
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
      const name = document.createElement('b');
      name.textContent = event.name;
      const arg = document.createElement('span');
      arg.textContent = toolSummary(event.input);
      row.append(name, arg);
      add(row);
      break;
    }

    case 'busy':
      setBusy(event.busy);
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

window.chat.onSession(({ cwd, model }) => {
  if (cwd) {
    btnCwd.textContent = cwd;
    btnCwd.title = `작업 폴더: ${cwd}${model ? `\n모델: ${model}` : ''}\n클릭하면 변경`;
  }
});

window.chat.onReset(({ reason }) => {
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

/* ---------------------------------------------------------------- 권한 요청 */

window.chat.onPermission((req) => {
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

  const detail = detailOf(req.input);
  if (detail) {
    const pre = document.createElement('pre');
    pre.textContent = detail;
    card.append(pre);
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

function submit() {
  const text = input.value.trim();
  if (!text) return;

  const bubble = document.createElement('div');
  bubble.className = 'msg user';
  bubble.textContent = text;
  add(bubble);

  window.chat.send(text);
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
  if (busy) window.chat.stop();
  else window.chat.close();
});

btnSend.addEventListener('click', submit);
btnStop.addEventListener('click', () => window.chat.stop());
btnCwd.addEventListener('click', () => window.chat.pickCwd());
document.getElementById('btn-new').addEventListener('click', () => window.chat.newSession());
document.getElementById('btn-close').addEventListener('click', () => window.chat.close());

showEmptyState();
autoGrow();
