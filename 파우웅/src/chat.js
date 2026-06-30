/**
 * chat.js
 * ──────────────────────────────────────────────
 * Limbus Company 테마 전용 채팅 UI 관리 모듈
 * - 메시지 렌더링 (파우스트/수감자 스타일)
 * - 스트리밍 출력 처리
 * - 타이핑 인디케이터
 * - 마크다운 기본 파싱
 * ──────────────────────────────────────────────
 */

// ─────────────────────────────────────────────
// DOM 요소 참조
// ─────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

export const DOM = {
  app:              () => $('app'),
  loadingScreen:    () => $('loading-screen'),
  messagesList:     () => $('messages-list'),
  messagesArea:     () => $('messages-area'),
  userInput:        () => $('user-input'),
  sendBtn:          () => $('send-btn'),
  typingIndicator:  () => $('typing-indicator'),
  sidebarModelName: () => $('sidebar-model-name'),
  gpuNameSidebar:   () => $('gpu-name-sidebar'),
  systemPrompt:     () => $('system-prompt'),
  sidebar:          () => $('sidebar'),
  sidebarOverlay:   () => $('sidebar-overlay'),
  limbusTooltip:    () => $('limbus-tooltip'),
  characterBox:     () => $('character-box'),
  
  // 로딩 화면 요소
  iconWebgpu:       () => $('icon-webgpu'),
  iconGpu:          () => $('icon-gpu'),
  iconModel:        () => $('icon-model'),
  valWebgpu:        () => $('val-webgpu'),
  valGpu:           () => $('val-gpu'),
  valModel:         () => $('val-model'),
  progressContainer:() => $('progress-container'),
  progressFill:     () => $('progress-fill'),
  progressText:     () => $('progress-text'),
  progressDetail:   () => $('progress-detail'),
  errorBox:         () => $('error-box'),
  errorTitle:       () => $('error-title'),
  errorDesc:        () => $('error-desc'),
};

// ─────────────────────────────────────────────
// 상태
// ─────────────────────────────────────────────

let isGenerating = false;
let currentStreamElement = null;

// ─────────────────────────────────────────────
// 로딩 스크린 제어
// ─────────────────────────────────────────────

/**
 * 상태 아이콘 업데이트
 * @param {'webgpu'|'gpu'|'model'} target
 * @param {'done'|'error'|'loading'} status
 * @param {string} value
 */
export function updateLoadingStatus(target, status, value) {
  const icon  = DOM[`icon${target.charAt(0).toUpperCase() + target.slice(1)}`]?.();
  const val   = DOM[`val${target.charAt(0).toUpperCase() + target.slice(1)}`]?.();
  const row   = icon?.closest('.status-row');

  if (!icon || !val) return;

  val.textContent = value;
  icon.className = `status-icon status-${status === 'done' ? 'done' : status === 'error' ? 'error' : 'checking'}`;

  if (status === 'done') {
    icon.textContent = '✓';
    row?.classList.add('done');
  } else if (status === 'error') {
    icon.textContent = '✗';
    row?.classList.add('error');
  } else {
    icon.innerHTML = `<div class="spinner-small" style="width: 12px; height: 12px; border: 1.5px solid rgba(212,143,34,0.2); border-top-color: var(--limbus-gold); border-radius: 50%; animation: spin 0.7s linear infinite;"></div>`;
  }
}

/**
 * 모델 다운로드 진행률 업데이트
 * @param {number} pct  0~100
 * @param {string} text 상태 텍스트
 */
export function updateProgress(pct, text) {
  const container = DOM.progressContainer();
  const fill      = DOM.progressFill();
  const pctText   = DOM.progressText();
  const detail    = DOM.progressDetail();

  container?.classList.add('visible');
  if (fill)    fill.style.width = `${Math.min(pct, 100)}%`;
  if (pctText) pctText.textContent = `${pct}%`;
  if (detail)  detail.textContent = text || '';
}

/**
 * 오류 표시
 * @param {string} title
 * @param {string} desc
 */
export function showLoadingError(title, desc) {
  const box  = DOM.errorBox();
  const t    = DOM.errorTitle();
  const d    = DOM.errorDesc();

  if (box) box.style.display = 'block';
  if (t)   t.textContent = title;
  if (d)   d.textContent = desc;
}

/**
 * 로딩 스크린 → 앱 전환
 */
export function transitionToApp() {
  const loading = DOM.loadingScreen();
  const app     = DOM.app();

  loading?.classList.add('fade-out');
  setTimeout(() => {
    loading?.style.setProperty('display', 'none');
    if (app) app.style.display = 'block';
  }, 600);
}

// ─────────────────────────────────────────────
// 입력창 제어
// ─────────────────────────────────────────────

/**
 * 입력창 초기화
 * @param {Function} onSubmit 전송 핸들러
 */
export function initInputArea(onSubmit) {
  const input = DOM.userInput();
  const btn   = DOM.sendBtn();

  if (!input || !btn) return;

  // Shift+Enter: 줄바꿈, Enter: 전송
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating) onSubmit?.();
    }
  });

  btn.addEventListener('click', () => {
    if (isGenerating) {
      import('./llm.js').then(({ abortGeneration }) => abortGeneration());
    } else {
      onSubmit?.();
    }
  });
}

/**
 * 입력창 활성화/비활성화
 * @param {boolean} enabled
 */
export function setInputEnabled(enabled) {
  const input = DOM.userInput();
  const btn   = DOM.sendBtn();
  if (input) input.disabled = !enabled;
  if (btn)   btn.disabled   = !enabled;
}

/**
 * 입력값 읽기 후 초기화
 * @returns {string}
 */
export function consumeInput() {
  const input = DOM.userInput();
  if (!input) return '';
  const value = input.value.trim();
  input.value = '';
  return value;
}

// ─────────────────────────────────────────────
// 메시지 렌더링
// ─────────────────────────────────────────────

/**
 * 마크다운 → HTML 변환 (보안성 확보)
 * @param {string} text
 * @returns {string} HTML
 */
function parseMarkdown(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // 코드 블록
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) =>
    `<pre><code class="language-${lang || 'text'}">${code.trim()}</code></pre>`
  );

  // 인라인 코드
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // 굵게
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // 기울임
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // 줄바꿈
  html = html.replace(/\n/g, '<br>');

  return html;
}

/**
 * 타임스탬프 포맷
 * @returns {string}
 */
function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('ko-KR', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

/**
 * 메시지 엘리먼트 생성 (Limbus 테마 전용)
 * @param {{role: string, content: string, timestamp: number, tokens?: number}} msg
 * @returns {HTMLElement}
 */
function createMessageElement(msg) {
  const isUser = msg.role === 'user';

  const wrapper = document.createElement('div');
  wrapper.className = `message-item ${msg.role}`;
  wrapper.dataset.role = msg.role;

  const innerContent = isUser
    ? msg.content.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')
    : parseMarkdown(msg.content);

  const metaTokens = msg.tokens ? ` · ${msg.tokens}T` : '';

  wrapper.innerHTML = `
    <div class="msg-content">${innerContent}</div>
    <div class="msg-meta">
      <span>${formatTime(msg.timestamp || Date.now())}${metaTokens}</span>
      ${!isUser ? ` · <span class="copy-trigger" style="cursor:pointer;text-decoration:underline;">LOG_COPY</span>` : ''}
    </div>
  `;

  // 복사 기능 바인딩
  if (!isUser) {
    wrapper.querySelector('.copy-trigger')?.addEventListener('click', function() {
      navigator.clipboard.writeText(msg.content).then(() => {
        const originalText = this.textContent;
        this.textContent = 'COPIED';
        setTimeout(() => { this.textContent = originalText; }, 1500);
      });
    });
  }

  return wrapper;
}

/**
 * 저장된 메시지 목록 전체 중 가장 최신 메시지 단 하나만 렌더링
 * @param {Array} messages
 */
export function renderMessages(messages) {
  const list = DOM.messagesList();
  if (!list) return;

  list.innerHTML = '';

  // 시스템을 제외한 메시지들 필터링
  const filtered = messages.filter(m => m.role !== 'system');
  if (filtered.length > 0) {
    const lastMsg = filtered[filtered.length - 1];
    list.appendChild(createMessageElement(lastMsg));
  }

  scrollToBottom();
}

/**
 * 화면을 비우고 신규 메시지 단 하나만 렌더링
 * @param {{role: string, content: string, timestamp?: number, tokens?: number}} msg
 * @returns {HTMLElement}
 */
export function appendMessage(msg) {
  const list = DOM.messagesList();
  if (!list) return null;

  list.innerHTML = '';

  const el = createMessageElement({ ...msg, timestamp: msg.timestamp || Date.now() });
  list.appendChild(el);
  scrollToBottom();
  return el;
}

// ─────────────────────────────────────────────
// 스트리밍 응답 처리
// ─────────────────────────────────────────────

/**
 * 화면을 비우고 AI 스트리밍 응답 뼈대 엘리먼트 생성
 * @returns {HTMLElement}
 */
export function createStreamingMessage() {
  const list = DOM.messagesList();
  if (!list) return null;

  list.innerHTML = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'message-item assistant streaming';
  wrapper.innerHTML = `
    <div class="msg-content stream-cursor"></div>
    <div class="msg-meta">
      <span class="stream-time">${formatTime(Date.now())}</span>
    </div>
  `;

  list.appendChild(wrapper);
  currentStreamElement = wrapper.querySelector('.msg-content');
  scrollToBottom();
  return wrapper;
}

/**
 * 스트리밍 청크 추가
 * @param {string} chunk
 */
export function appendStreamChunk(chunk) {
  if (!currentStreamElement) return;
  const bubble = currentStreamElement;
  if (!bubble._rawText) bubble._rawText = '';
  bubble._rawText += chunk;
  bubble.innerHTML = parseMarkdown(bubble._rawText);
  scrollToBottom();
}

/**
 * 스트리밍 완료 처리
 * @param {string} fullText
 * @param {number} timestamp
 * @param {number} tokens
 * @returns {HTMLElement}
 */
export function finalizeStreamingMessage(fullText, timestamp, tokens) {
  if (!currentStreamElement) return null;
  const bubble  = currentStreamElement;
  const wrapper = bubble.closest('.message-item');

  bubble.classList.remove('stream-cursor');
  bubble._rawText = fullText;
  bubble.innerHTML = parseMarkdown(fullText);

  // 메타 정보 수정
  const meta = wrapper?.querySelector('.msg-meta');
  if (meta) {
    const metaTokens = tokens ? ` · ${tokens}T` : '';
    meta.innerHTML = `
      <span>${formatTime(timestamp)}${metaTokens}</span> · 
      <span class="copy-trigger" style="cursor:pointer;text-decoration:underline;">LOG_COPY</span>
    `;
    meta.querySelector('.copy-trigger')?.addEventListener('click', function() {
      navigator.clipboard.writeText(fullText).then(() => {
        this.textContent = 'COPIED';
        setTimeout(() => { this.textContent = 'LOG_COPY'; }, 1500);
      });
    });
  }

  wrapper?.classList.remove('streaming');
  currentStreamElement = null;
  return wrapper;
}

// ─────────────────────────────────────────────
// UI 상태 관리
// ─────────────────────────────────────────────

/**
 * AI 연산 생성 중 상태 UI 반영
 * @param {boolean} generating
 */
export function setGeneratingState(generating) {
  isGenerating = generating;
  const btn = DOM.sendBtn();

  if (generating) {
    btn?.style.setProperty('filter', 'hue-rotate(120deg) brightness(1.2)'); // 상태에 따른 필터 효과
    showTypingIndicator(false);
  } else {
    btn?.style.removeProperty('filter');
  }
}

/**
 * 타이핑/연산 대기 인디케이터 제어
 * @param {boolean} show
 */
export function showTypingIndicator(show) {
  const el = DOM.typingIndicator();
  if (el) el.style.display = show ? 'flex' : 'none';
  if (show) scrollToBottom();
}

/**
 * 토큰 개수 미표시(사이드바 등에서 조용히 관리)
 */
export function updateTokenCount(total) {
  // Limbus 테마에서는 전면에 토큰 카운트를 크게 노출하지 않고 로그에서 표시
  console.log('[System] 누적 연산량:', total, 'tokens');
}

/**
 * GPU 상태 표시
 * @param {string} name
 */
export function updateGPUDisplay(name) {
  const sidebar = DOM.gpuNameSidebar();
  if (sidebar) sidebar.textContent = name;
}

/**
 * 모델명 표시
 * @param {string} name
 */
export function updateModelDisplay(name) {
  const el = DOM.sidebarModelName();
  if (el) el.textContent = name;
}

// ─────────────────────────────────────────────
// 스크롤 및 기타 기능
// ─────────────────────────────────────────────

export function scrollToBottom() {
  const area = DOM.messagesArea();
  if (area) area.scrollTop = area.scrollHeight;
}

// ─────────────────────────────────────────────
// 토스트 알림
// ─────────────────────────────────────────────

let toastTimer = null;

export function showToast(message, type = 'default', duration = 3000) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }

  if (toastTimer) clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `toast ${type}`;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('visible'));
  });

  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, duration);
}

// ─────────────────────────────────────────────
// Limbus 인터랙션 이니셜라이저 (오버레이 & 툴팁)
// ─────────────────────────────────────────────

export function initLimbusInteractions() {
  const tooltip   = DOM.limbusTooltip();
  const container = document.getElementById('app'); // game-container

  // ────────────────────────────────────────────
  // 3. 다이얼 버튼 툴팁
  // ────────────────────────────────────────────
  const ctrlButtons = document.querySelectorAll('.ctrl-btn');
  ctrlButtons.forEach((btn) => {
    btn.addEventListener('mouseenter', () => {
      if (!tooltip) return;
      const title = btn.getAttribute('title');
      if (!title) return;
      tooltip.textContent = title;
      tooltip.style.opacity = '1';

      const btnRect = btn.getBoundingClientRect();
      const containerRect = container?.getBoundingClientRect();
      if (!containerRect) return;
      const topOffset = btnRect.top - containerRect.top + (btnRect.height / 2);
      tooltip.style.top = `${topOffset - 14}px`;
    });
    btn.addEventListener('mouseleave', () => {
      if (tooltip) tooltip.style.opacity = '0';
    });
  });
}

