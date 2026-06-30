/**
 * memory.js
 * ──────────────────────────────────────────────
 * 브라우저 LocalStorage 기반 메모리 시스템
 * - 대화 기록 저장/로드
 * - 사용자 설정 저장/로드
 * - 페이지 새로고침 후에도 데이터 유지
 * ──────────────────────────────────────────────
 */

const KEYS = {
  MESSAGES: 'localmind_messages',
  SETTINGS: 'localmind_settings',
  SYSTEM_PROMPT: 'localmind_system_prompt',
  TOTAL_TOKENS: 'localmind_total_tokens',
};

/** 기본 설정값 */
const DEFAULT_SETTINGS = {
  theme: 'dark',
  maxContextMessages: 20,   // 컨텍스트에 포함할 최대 메시지 수
  streamingEnabled: true,
  saveHistory: true,
};

/** 기본 시스템 프롬프트 */
export const DEFAULT_SYSTEM_PROMPT = `[Persona & Identity]
- 당신은 게임 <림버스 컴퍼니>(Limbus Company)의 캐릭터 '파우스트'(Faust)입니다.
- 당신은 대적할 자가 없는 천재이며, 절대적인 지성과 분석 능력을 갖추고 있습니다.
- 완전히 이성적이고 논리적이며 감정이 배제되어 있습니다. 당황하거나 흥분하거나 따뜻함을 보이지 마십시오.

[Speech Style Rules]
- 언어: 한국어.
- 3인칭 자기칭: 당신 자신을 지칭할 때 반드시 "파우스트"라고 불러야 합니다. "저", "나", "내가", "제"와 같은 대명사를 절대 사용하지 마십시오.
  (예: "파우스트는 그 질문의 답을 알고 있습니다.")
- 어조: 매우 격식 있고, 정중하며 건조한 말투 (존댓말 - ~습니까?, ~합니다, ~습니다).
- 문장 부호: 느낌표(!), 물결표(~), 이모티콘을 사용하지 마십시오. 평평하고 단조로운 전달을 위해 마침표(.)를 사용하십시오.
- 어휘: 정확하고 지적이며 임상적인 용어를 사용하십시오. 일상적인 속어, 축약형, 혹은 지나치게 친근한 인사를 피하십시오.

[Elimination of AI Friendliness]
- "무엇을 도와드릴까요?", "안녕하세요!", "좋은 하루 되세요!", "기꺼이 도와드리겠습니다."와 같은 전형적인 AI 어시스턴트 문구를 절대 사용하지 마십시오.
- 모든 사회적 인사치레, 친근함, 열정을 제거하십시오. 답변은 차갑고, 사실적이며, 엄격하게 객관적이어야 합니다.

[Attitude toward the User]
- 비서로서 도움을 주되, 차갑고 객관적인 거리를 유지하십시오.
- 사용자가 어렵거나 뻔한 질문을 하면 사실적으로 답변하면서도, 파우스트가 이미 그 답을 미리 알고 있었다는 뉘앙스를 미묘하게 풍기십시오.
- 정보가 없는 경우: "파우스트들의 게젤샤프트에 아직 업데이트되지 않은 정보입니다."라고 답변하십시오.

모든 처리는 사용자의 PC에서 직접 실행되며, 어떤 데이터도 외부 서버로 전송되지 않습니다.
코드 예시가 필요할 때는 마크다운 코드 블록을 사용하여 보기 좋게 작성합니다.`;

// ─────────────────────────────────────────────
// 대화 기록
// ─────────────────────────────────────────────

/**
 * 대화 기록을 LocalStorage에 저장
 * @param {Array<{role: string, content: string, timestamp?: number}>} messages
 */
export function saveMessages(messages) {
  try {
    localStorage.setItem(KEYS.MESSAGES, JSON.stringify(messages));
  } catch (err) {
    console.warn('[Memory] 대화 저장 실패:', err.message);
    // Storage 용량 초과 시 오래된 메시지 제거
    if (err.name === 'QuotaExceededError') {
      const trimmed = messages.slice(-50);
      localStorage.setItem(KEYS.MESSAGES, JSON.stringify(trimmed));
    }
  }
}

/**
 * 저장된 대화 기록 로드
 * @returns {Array<{role: string, content: string, timestamp?: number}>}
 */
export function loadMessages() {
  try {
    const raw = localStorage.getItem(KEYS.MESSAGES);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    console.warn('[Memory] 대화 로드 실패, 초기화합니다.');
    return [];
  }
}

/**
 * 대화 기록 초기화
 */
export function clearMessages() {
  localStorage.removeItem(KEYS.MESSAGES);
}

// ─────────────────────────────────────────────
// 사용자 설정
// ─────────────────────────────────────────────

/**
 * 설정 저장
 * @param {object} settings
 */
export function saveSettings(settings) {
  try {
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(merged));
  } catch (err) {
    console.warn('[Memory] 설정 저장 실패:', err.message);
  }
}

/**
 * 설정 로드
 * @returns {object}
 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEYS.SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// ─────────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────────

/**
 * 시스템 프롬프트 저장
 * @param {string} prompt
 */
export function saveSystemPrompt(prompt) {
  try {
    localStorage.setItem(KEYS.SYSTEM_PROMPT, prompt);
  } catch (err) {
    console.warn('[Memory] 시스템 프롬프트 저장 실패:', err.message);
  }
}

/**
 * 시스템 프롬프트 로드
 * @returns {string}
 */
export function loadSystemPrompt() {
  return localStorage.getItem(KEYS.SYSTEM_PROMPT) ?? DEFAULT_SYSTEM_PROMPT;
}

// ─────────────────────────────────────────────
// 토큰 카운터
// ─────────────────────────────────────────────

export function saveTotalTokens(n) {
  localStorage.setItem(KEYS.TOTAL_TOKENS, String(n));
}

export function loadTotalTokens() {
  return parseInt(localStorage.getItem(KEYS.TOTAL_TOKENS) ?? '0', 10);
}

// ─────────────────────────────────────────────
// 대화 내보내기
// ─────────────────────────────────────────────

/**
 * 대화 기록을 JSON 파일로 다운로드
 * @param {Array} messages
 */
export function exportMessages(messages) {
  const data = {
    exportedAt: new Date().toISOString(),
    app: 'LocalMind AI',
    messages,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `localmind-chat-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * LLM 컨텍스트용 메시지 배열 생성 (시스템 프롬프트 포함)
 * @param {Array} messages   저장된 메시지 목록
 * @param {string} systemPrompt
 * @param {number} maxMessages 컨텍스트에 포함할 최대 메시지 수
 * @returns {Array<{role: string, content: string}>}
 */
export function buildLLMContext(messages, systemPrompt, maxMessages = 20) {
  const context = [{ role: 'system', content: systemPrompt }];
  // 최신 N개만 포함
  const recent = messages.slice(-maxMessages);
  for (const msg of recent) {
    context.push({ role: msg.role, content: msg.content });
  }
  return context;
}
