'use strict';

const { randomUUID } = require('node:crypto');

/**
 * 말풍선에서 온 메시지를 Agent SDK의 스트리밍 입력으로 밀어 넣는 큐.
 * 이 큐를 닫지 않는 한 query()는 하나의 세션으로 계속 살아 있어서
 * 매 턴마다 프로세스를 새로 띄우지 않아도 대화가 이어진다.
 */
class AsyncQueue {
  constructor() {
    this.items = [];
    this.waiters = [];
    this.closed = false;
  }

  push(value) {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.items.push(value);
  }

  close() {
    this.closed = true;
    let waiter;
    while ((waiter = this.waiters.shift())) waiter({ value: undefined, done: true });
  }

  [Symbol.asyncIterator]() {
    const self = this;
    return {
      next() {
        if (self.items.length) return Promise.resolve({ value: self.items.shift(), done: false });
        if (self.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => self.waiters.push(resolve));
      },
      return() {
        self.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

const PERSONA = `
You are living on the user's desktop as a small companion character. Your replies
appear inside a little speech bubble, so:
- Keep answers short and conversational by default — a few sentences, not essays.
- Write long output only when the user explicitly asks for detail, a plan, or code.
- Reply in whatever language the user writes in.
In every other respect behave exactly as you normally do: use your tools to read,
search, and edit files in the working directory.
`.trim();

/** tool_result 의 content 는 문자열일 수도, 블록 배열일 수도 있다. */
function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => {
      if (block?.type === 'text') return block.text;
      if (block?.type === 'image') return '[이미지]';
      return '';
    })
    .join('');
}

/** SessionMessage의 content에서 사람이 읽을 텍스트만 뽑는다. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('');
}

/**
 * 저장된 세션 기록을 말풍선이 그릴 수 있는 모양으로 바꾼다.
 * 도구 결과만 든 user 메시지는 사용자가 쓴 게 아니므로 버린다.
 */
function normalizeHistory(messages) {
  const out = [];

  for (const message of messages) {
    const content = message.message?.content;
    const text = textOf(content);

    if (message.type === 'user') {
      if (text.trim()) out.push({ role: 'user', text });
      continue;
    }

    if (message.type === 'assistant') {
      const tools = (Array.isArray(content) ? content : [])
        .filter((block) => block?.type === 'tool_use')
        .map((block) => block.name);
      if (text.trim() || tools.length) out.push({ role: 'assistant', text, tools });
    }
  }

  return out;
}

/** SDK가 프롬프트 문장을 주지 않을 때 쓸 안내 문구. */
function fallbackTitle(toolName) {
  switch (toolName) {
    case 'Bash':
      return '명령을 실행하려고 해요';
    case 'Write':
      return '파일을 새로 쓰려고 해요';
    case 'Edit':
    case 'NotebookEdit':
      return '파일을 수정하려고 해요';
    case 'Read':
      return '파일을 읽으려고 해요';
    case 'WebFetch':
    case 'WebSearch':
      return '웹에서 정보를 가져오려고 해요';
    default:
      return `${toolName} 도구를 사용하려고 해요`;
  }
}

class Agent {
  /**
   * @param {object} opts
   * @param {string} opts.cwd 작업 디렉터리
   * @param {(event: object) => void} opts.onEvent
   * @param {(request: object) => void} opts.onPermission
   */
  constructor({ cwd, onEvent, onPermission, cliPath = null }) {
    this.cwd = cwd;
    this.onEvent = onEvent;
    this.onPermission = onPermission;
    this.cliPath = cliPath;

    this.sessionId = null;
    this.busy = false;
    this.running = false;
    this.queue = null;
    this.query = null;
    this.pending = new Map();

    this.resumedWith = null; // 이어받기를 시도한 세션 id
    this.gotInit = false; // init 메시지를 받았는가 = 세션이 실제로 열렸는가
    this.lastText = null; // 이어받기 실패 시 다시 보낼 메시지
    this.permissionMode = 'default';
  }

  async start({ resume } = {}) {
    if (this.running) return;
    this.running = true;
    this.resumedWith = resume || null;
    this.gotInit = false;

    // SDK는 ESM 전용이라 CJS인 Electron main에서는 동적 import로 가져온다.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');

    this.queue = new AsyncQueue();
    this.query = query({
      prompt: this.queue,
      options: {
        cwd: this.cwd,
        resume: resume || undefined,
        includePartialMessages: true,
        permissionMode: 'default',
        canUseTool: (name, input, opts) => this.#requestPermission(name, input, opts),
        systemPrompt: { type: 'preset', preset: 'claude_code', append: PERSONA },
        // 배포본에는 SDK의 네이티브 CLI를 빼고 넣으므로 경로를 직접 지정한다.
        // (null이면 SDK가 알아서 딸려온 바이너리를 찾는다 — 개발 중 기본 경로)
        ...(this.cliPath ? { pathToClaudeCodeExecutable: this.cliPath } : {}),
        stderr: (data) => {
          if (process.env.PET_DEBUG) process.stderr.write(data);
        },
      },
    });

    this.#pump();
  }

  async #pump() {
    try {
      for await (const message of this.query) this.#handle(message);
    } catch (err) {
      this.onEvent({ type: 'error', message: String(err?.message || err) });
    } finally {
      this.running = false;
      this.#setBusy(false);
      for (const [, p] of this.pending) p.resolve({ behavior: 'deny', message: '세션이 종료되었습니다.' });
      this.pending.clear();

      // init도 못 받고 끝났다면 resume 대상이 사라진 것 — 새 대화로 되살린다.
      if (!this.gotInit && this.resumedWith) {
        this.sessionId = null;
        this.onEvent({ type: 'resume-failed', text: this.lastText });
      } else {
        this.onEvent({ type: 'closed' });
      }
    }
  }

  #handle(message) {
    switch (message.type) {
      case 'system':
        if (message.subtype === 'init') {
          this.gotInit = true;
          this.sessionId = message.session_id;
          this.model = message.model;
          this.permissionMode = message.permissionMode || this.permissionMode;
          this.onEvent({
            type: 'init',
            sessionId: message.session_id,
            model: message.model,
            cwd: message.cwd,
            version: message.claude_code_version,
          });
        }
        return;

      case 'stream_event': {
        const event = message.event;
        if (event.type === 'content_block_start') {
          const kind = event.content_block?.type;
          if (kind === 'text') this.onEvent({ type: 'text-start' });
          else if (kind === 'thinking') this.onEvent({ type: 'thinking-start' });
        } else if (event.type === 'content_block_delta') {
          const delta = event.delta;
          if (delta?.type === 'text_delta') this.onEvent({ type: 'delta', text: delta.text });
          else if (delta?.type === 'thinking_delta') this.onEvent({ type: 'thinking', text: delta.thinking });
        }
        return;
      }

      case 'user':
        // 도구 실행 결과가 여기로 돌아온다. 말풍선에서 접었다 펼 수 있게 넘긴다.
        for (const block of message.message?.content || []) {
          if (block?.type !== 'tool_result') continue;
          this.onEvent({
            type: 'tool-result',
            toolUseId: block.tool_use_id,
            isError: Boolean(block.is_error),
            text: toolResultText(block.content),
          });
        }
        return;

      case 'assistant':
        for (const block of message.message?.content || []) {
          if (block.type === 'tool_use') {
            this.onEvent({ type: 'tool', id: block.id, name: block.name, input: block.input });
          }
        }
        if (message.error) {
          this.onEvent({ type: 'error', message: `API 오류: ${message.error}` });
        }
        return;

      case 'result':
        this.#setBusy(false);
        this.onEvent({
          type: 'result',
          isError: message.subtype !== 'success',
          subtype: message.subtype,
          sessionId: message.session_id,
        });
        return;

      default:
        return;
    }
  }

  /**
   * @param {string} text
   * @param {Array<{mediaType: string, data: string}>} images base64 (data: 접두사 없이)
   */
  async send(text, images = []) {
    this.lastText = text;
    if (!this.running) await this.start({ resume: this.sessionId });
    this.#setBusy(true);

    // 이미지가 없으면 그냥 문자열로 보낸다(기존 동작 유지)
    const content = images.length
      ? [
          ...images.map((img) => ({
            type: 'image',
            source: { type: 'base64', media_type: img.mediaType, data: img.data },
          })),
          ...(text ? [{ type: 'text', text }] : []),
        ]
      : text;

    this.queue.push({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content } });
  }

  /** 권한 모드 전환 (default / acceptEdits / plan). 세션이 살아 있어야 한다. */
  async setPermissionMode(mode) {
    if (!this.running) await this.start({ resume: this.sessionId });
    await this.query.setPermissionMode(mode);
    this.permissionMode = mode;
    this.onEvent({ type: 'permission-mode', mode });
  }

  /** 슬래시 명령이 쓸 조회용 메서드들. 세션이 없으면 먼저 띄운다. */
  async control(name, ...args) {
    if (!this.running) await this.start({ resume: this.sessionId });
    return this.query[name](...args);
  }

  /**
   * 이어받은 세션의 지난 대화를 읽어온다.
   * 앱을 다시 켰을 때 말풍선이 텅 비어 보이지 않게 하려는 용도.
   */
  async loadHistory(limit = 40) {
    if (!this.sessionId) return [];
    try {
      const { getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk');
      const messages = await getSessionMessages(this.sessionId, { dir: this.cwd });
      return normalizeHistory(messages).slice(-limit);
    } catch (err) {
      if (process.env.PET_DEBUG) console.error('[agent] loadHistory', err);
      return [];
    }
  }

  async interrupt() {
    if (!this.running) return;
    try {
      await this.query.interrupt();
    } catch (err) {
      if (process.env.PET_DEBUG) console.error('[agent] interrupt', err);
    }
    this.#setBusy(false);
  }

  /** 세션을 버리고 다음 send()에서 새 대화를 시작한다. */
  reset() {
    this.sessionId = null;
    this.stop();
  }

  /**
   * @param {{force?: boolean}} options
   *   force=false면 입력 스트림만 닫아 CLI가 스스로 정리하고 나가게 둔다.
   *   CLI는 종료하면서 대화 기록(transcript)을 디스크에 쓰므로, 바로 죽이면
   *   마지막 답변이 기록에 안 남아 다음 실행 때 복원되지 않는다.
   */
  stop({ force = true } = {}) {
    this.queue?.close();
    if (force) {
      try {
        this.query?.close?.();
      } catch {
        /* 이미 닫힌 경우 무시 */
      }
      this.running = false;
    }
  }

  #setBusy(busy) {
    if (this.busy === busy) return;
    this.busy = busy;
    this.onEvent({ type: 'busy', busy });
  }

  #requestPermission(toolName, input, opts) {
    return new Promise((resolve) => {
      const id = randomUUID();

      const onAbort = () => {
        if (this.pending.delete(id)) resolve({ behavior: 'deny', message: '요청이 취소되었습니다.' });
      };
      opts.signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(id, { resolve, suggestions: opts.suggestions });

      this.onPermission({
        id,
        toolName,
        input,
        title: opts.title || fallbackTitle(toolName),
        displayName: opts.displayName || toolName,
        description: opts.description,
        reason: opts.decisionReason,
        defaultToNo: Boolean(opts.defaultToNo),
        // "항상 허용"은 SDK가 규칙 제안을 주고 금지하지 않을 때만 노출한다.
        canAlwaysAllow: Boolean(opts.suggestions?.length) && !opts.suppressAlwaysAllowRule,
      });
    });
  }

  resolvePermission(id, decision) {
    const entry = this.pending.get(id);
    if (!entry) return;
    this.pending.delete(id);

    if (decision === 'always') {
      entry.resolve({ behavior: 'allow', updatedPermissions: entry.suggestions });
    } else if (decision === 'allow') {
      entry.resolve({ behavior: 'allow' });
    } else {
      entry.resolve({ behavior: 'deny', message: '사용자가 이 작업을 거부했습니다.' });
    }
  }
}

/**
 * 이 작업 폴더에서 나눴던 지난 대화 목록.
 * SDK가 transcript 파일을 훑어 제목과 시각을 뽑아준다.
 */
async function listProjectSessions(cwd, limit = 40) {
  const { listSessions } = await import('@anthropic-ai/claude-agent-sdk');
  const sessions = await listSessions({ dir: cwd, limit });

  return sessions
    .map((info) => ({
      sessionId: info.sessionId,
      title: String(info.customTitle || info.summary || info.firstPrompt || '').trim(),
      lastModified: info.lastModified || 0,
      cwd: info.cwd || cwd,
      gitBranch: info.gitBranch || null,
    }))
    .sort((a, b) => b.lastModified - a.lastModified);
}

module.exports = { Agent, listProjectSessions };
