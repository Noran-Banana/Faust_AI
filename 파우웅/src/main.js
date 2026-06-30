/**
 * main.js
 * ──────────────────────────────────────────────
 * LocalMind AI — 메인 진입점
 * - 앱 초기화 오케스트레이션
 * - WebGPU 확인 → 모델 로딩 → 채팅 UI 활성화
 * - 전역 이벤트 및 Limbus 다이얼 단축키 바인딩
 * ──────────────────────────────────────────────
 */

import './style.css';

import {
  checkWebGPUSupport,
  initEngine,
  generateResponse,
  abortGeneration,
  MODEL_ID,
  LLM_ERROR_MESSAGES,
} from './llm.js';

import {
  loadMessages,
  saveMessages,
  clearMessages,
  loadSystemPrompt,
  saveSystemPrompt,
  loadSettings,
  exportMessages,
  buildLLMContext,
  loadTotalTokens,
  saveTotalTokens,
} from './memory.js';

import {
  DOM,
  updateLoadingStatus,
  updateProgress,
  showLoadingError,
  transitionToApp,
  initInputArea,
  setInputEnabled,
  consumeInput,
  renderMessages,
  appendMessage,
  createStreamingMessage,
  appendStreamChunk,
  finalizeStreamingMessage,
  setGeneratingState,
  showTypingIndicator,
  updateTokenCount,
  updateGPUDisplay,
  updateModelDisplay,
  showToast,
  initLimbusInteractions,
} from './chat.js';

// ─────────────────────────────────────────────
// 전역 상태
// ─────────────────────────────────────────────

/** @type {Array<{role: string, content: string, timestamp: number, tokens?: number}>} */
let messages = [];
let systemPrompt = loadSystemPrompt();
let totalTokens = loadTotalTokens();
let settings = loadSettings();
let isGenerating = false;

// ─────────────────────────────────────────────
// 앱 시작 (부트스트랩)
// ─────────────────────────────────────────────

async function bootstrap() {
  console.log('[App] LocalMind AI (Faust Decider) 기동');

  // ── 로딩 중 캐시 파일 완전 삭제 바인딩 ──
  document.getElementById('loading-delete-cache-btn')?.addEventListener('click', async () => {
    if (!confirm('현재 적재 중이거나 캐시된 4GB 상당의 모델 파일을 완전히 지우시겠습니까?\n삭제 즉시 화면이 새로고침되며 다시 다운로드가 시작됩니다.')) {
      return;
    }
    
    try {
      const btn = document.getElementById('loading-delete-cache-btn');
      if (btn) btn.textContent = '소거 처리 중...';
      
      const { deleteModelCache } = await import('./llm.js');
      await deleteModelCache();
      
      alert('로컬 캐시 모델 파일이 성공적으로 삭제되었습니다.');
      window.location.reload();
    } catch (err) {
      console.error('[App] 로딩 중 캐시 삭제 에러:', err);
      alert('모델 삭제 중 오류가 발생했습니다: ' + err.message);
    }
  });

  // ─── Step 1: WebGPU 지원 점검 ───
  updateLoadingStatus('webgpu', 'loading', '장치 가용성 진단 중...');

  const gpuCheck = await checkWebGPUSupport();

  if (!gpuCheck.supported) {
    updateLoadingStatus('webgpu', 'error', '지원 종료');
    updateLoadingStatus('gpu', 'error', gpuCheck.gpu);

    showLoadingError(
      'WebGPU 연결 실패',
      `${gpuCheck.error || ''}\n\n` +
      '조치 사항:\n' +
      '1. Chromium 기반 최신 브라우저를 구동하십시오.\n' +
      '2. 브라우저 설정(하드웨어 가속)을 켜십시오.\n' +
      '3. 그래픽 드라이버의 상태를 점검하십시오.'
    );
    return;
  }

  updateLoadingStatus('webgpu', 'done', '연산 가능');

  // ─── Step 2: GPU 정보 확인 및 갱신 ───
  updateLoadingStatus('gpu', 'loading', '정밀 스캔 중...');
  await new Promise(r => setTimeout(r, 200));

  const gpuName = gpuCheck.gpu;
  updateLoadingStatus('gpu', 'done', gpuName);
  updateGPUDisplay(gpuName);
  updateModelDisplay(MODEL_ID.replace('-MLC', ''));

  // ─── Step 3: 지식 저장소 모델 마운트 ───
  updateLoadingStatus('model', 'loading', '대용량 모델 전개 중...');

  try {
    await initEngine({
      onProgress: ({ progress, text }) => {
        updateProgress(progress, text);
        updateLoadingStatus('model', 'loading', `${progress}%`);
      },
      onPhase: (phase) => {
        console.log('[App] 마운트 페이즈:', phase);
      },
    });
  } catch (err) {
    console.error('[App] 모델 적재 오류:', err);
    updateLoadingStatus('model', 'error', '적재 중단');

    const errMsg = LLM_ERROR_MESSAGES[err.code] || err.message;
    showLoadingError('라이브러리 마운트 에러', errMsg + '\n\n장치 용량 또는 연결 상태를 점검 후 재시도하십시오.');
    return;
  }

  updateLoadingStatus('model', 'done', '준비 완료');
  updateProgress(100, '지식 자원 전개 완료. 질의를 처리할 준비가 되었습니다.');

  await new Promise(r => setTimeout(r, 600));

  // ─── Step 4: 메인 뷰포트 전환 ───
  transitionToApp();
  initApp();
}

// ─────────────────────────────────────────────
// 앱 메인 루프 초기화
// ─────────────────────────────────────────────

function initApp() {
  messages = loadMessages();
  systemPrompt = loadSystemPrompt();
  totalTokens = loadTotalTokens();

  // 대화가 존재하지 않을 때, 파우스트의 시그니처 첫 마디 적재
  if (messages.length === 0) {
    messages = [{
      role: 'assistant',
      content: '파우스트는 당신의 접속을 확인했습니다. 필요한 지식이 있다면 질문하십시오.',
      timestamp: Date.now()
    }];
    saveMessages(messages);
  }

  // 뷰포트 요소 동기화
  renderMessages(messages);
  updateTokenCount(totalTokens);

  const sysPromptEl = DOM.systemPrompt();
  if (sysPromptEl) sysPromptEl.value = systemPrompt;

  // 인터페이스 활성화
  setInputEnabled(true);
  initInputArea(handleSubmit);

  // Limbus 스타일 툴팁 및 다이얼 상호작용 바인딩
  initLimbusInteractions();

  // 이벤트 전체 바인딩
  bindEvents();

  // 입력창 즉시 포커스
  setTimeout(() => DOM.userInput()?.focus(), 500);

  console.log('[App] 제어 시스템 활성화.');
}

// ─────────────────────────────────────────────
// 이벤트 리스너 바인딩
// ─────────────────────────────────────────────

function bindEvents() {
  const sidebar = DOM.sidebar();
  const overlay = DOM.sidebarOverlay();

  // ── 사이드바 제어 함수 ──
  const openSidebar = () => {
    sidebar?.classList.add('open');
    overlay?.classList.add('visible');
  };

  const closeSidebar = () => {
    sidebar?.classList.remove('open');
    overlay?.classList.remove('visible');
  };

  // ── 사이드바 오픈/클로즈 버튼 바인딩 ──
  document.getElementById('ctrl-open-sidebar')?.addEventListener('click', openSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', closeSidebar);
  overlay?.addEventListener('click', closeSidebar);

  // ── 시스템 프롬프트 저장 및 적용 ──
  document.getElementById('save-system-prompt')?.addEventListener('click', () => {
    const val = DOM.systemPrompt()?.value?.trim();
    if (val !== undefined) {
      systemPrompt = val;
      saveSystemPrompt(val);
      showToast('✅ 시스템 명령 변경됨', 'success');
      closeSidebar();
    }
  });

  // ── 대화 데이터 초기화 (다이얼 1번 & 사이드바 공용) ──
  const resetChatAction = () => {
    if (!confirm('현재 누적된 기록을 비우고 대화 제어권을 초기화하시겠습니까?')) return;
    const initialGreeting = {
      role: 'assistant',
      content: '파우스트는 당신의 접속을 확인했습니다. 필요한 지식이 있다면 질문하십시오.',
      timestamp: Date.now()
    };
    messages = [initialGreeting];
    saveMessages(messages);
    totalTokens = 0;
    saveTotalTokens(0);
    renderMessages(messages);
    updateTokenCount(0);
    showToast('🗑️ 연산 기록 리셋 완료');
    closeSidebar();
  };

  document.getElementById('ctrl-clear-chat')?.addEventListener('click', resetChatAction);
  document.getElementById('clear-chat-btn')?.addEventListener('click', resetChatAction);

  // ── 대화 데이터 내보내기 (다이얼 2번 & 사이드바 공용) ──
  const exportChatAction = () => {
    if (messages.length === 0) {
      showToast('저장된 대화 기록이 존재하지 않습니다.', 'error');
      return;
    }
    exportMessages(messages);
    showToast('✅ 기록 파일 내보내기 완료', 'success');
    closeSidebar();
  };

  document.getElementById('ctrl-export-chat')?.addEventListener('click', exportChatAction);
  document.getElementById('export-chat-btn')?.addEventListener('click', exportChatAction);

  // ── 다이얼 6번: 로컬 모델 캐시 완전 삭제 ──
  document.getElementById('ctrl-delete-cache')?.addEventListener('click', async () => {
    if (!confirm('브라우저에 다운로드된 약 4GB의 로컬 AI 모델 데이터를 완전히 삭제하시겠습니까?\n삭제 후 다음 실행 시 모델 데이터를 다시 다운로드해야 합니다.')) {
      return;
    }
    
    try {
      showToast('⏳ 모델 캐시 소거 중...', 'default', 5000);
      const { deleteModelCache } = await import('./llm.js');
      const success = await deleteModelCache();
      
      if (success) {
        showToast('🗑️ 로컬 모델 데이터 삭제 완료', 'success', 4000);
        setTimeout(() => {
          window.location.reload();
        }, 1500);
      } else {
        showToast('ℹ️ 이미 삭제되었거나 캐시 데이터를 찾을 수 없습니다.', 'default', 4000);
      }
    } catch (err) {
      console.error('[App] 캐시 삭제 실패:', err);
      showToast('❌ 모델 캐시 삭제 실패: ' + err.message, 'error', 5000);
    }
  });

  // ── 다이얼 4번: 캐릭터 렌더링 표시 토글 ──
  document.getElementById('ctrl-toggle-char')?.addEventListener('click', () => {
    const charBox = DOM.characterBox();
    if (charBox) {
      const isVisible = charBox.style.opacity !== '0';
      charBox.style.opacity = isVisible ? '0' : '1';
      showToast(isVisible ? '🎭 캐릭터 뷰포트 비활성화' : '🎭 캐릭터 뷰포트 활성화');
    }
  });

  // ── 다이얼 5번: GPU 및 모델 상세 사양 안내 토스트 ──
  document.getElementById('ctrl-model-info')?.addEventListener('click', () => {
    import('./llm.js').then(({ getGPUInfo }) => {
      const info = getGPUInfo();
      showToast(`🤖 모델: ${MODEL_ID.replace('-MLC', '')} | ⚡ GPU: ${info.name}`, 'default', 4000);
    });
  });

  // ── 시스템 프롬프트 실시간 동기화 ──
  DOM.systemPrompt()?.addEventListener('change', () => {
    const val = DOM.systemPrompt()?.value;
    if (val !== undefined) {
      systemPrompt = val;
      saveSystemPrompt(val);
    }
  });

  // ── 페이지 종료 시 리소스 자동 회수 ──
  window.addEventListener('beforeunload', () => {
    import('./llm.js').then(({ unloadEngine }) => unloadEngine());
  });
}

// ─────────────────────────────────────────────
// 메시지 송신 및 추론 루프
// ─────────────────────────────────────────────

async function handleSubmit() {
  if (isGenerating) return;

  const userText = consumeInput();
  if (!userText) return;

  isGenerating = true;
  setGeneratingState(true);
  setInputEnabled(false);

  // ─── 수감자 질의 추가 ───
  const userMsg = {
    role: 'user',
    content: userText,
    timestamp: Date.now(),
  };

  messages.push(userMsg);
  appendMessage(userMsg);
  saveMessages(messages);

  // ─── 분석 대기 표시 ───
  showTypingIndicator(true);
  await new Promise(r => setTimeout(r, 450));

  // ─── 파우스트 대답 및 연산 처리 ───
  showTypingIndicator(false);
  createStreamingMessage();

  let fullResponse = '';
  let responseTokens = 0;
  const responseTimestamp = Date.now();

  try {
    const contextMessages = buildLLMContext(messages, systemPrompt, settings.maxContextMessages);

    await generateResponse(contextMessages, {
      onChunk: (chunk) => {
        fullResponse += chunk;
        appendStreamChunk(chunk);
      },
      onComplete: (usage) => {
        responseTokens = usage?.completion_tokens ?? 0;
        const newTotal = totalTokens + (usage?.total_tokens ?? 0);
        totalTokens = newTotal;
        saveTotalTokens(newTotal);
        updateTokenCount(newTotal);
      },
      onError: (err) => {
        console.error('[App] 분석 에러:', err);
        showToast(LLM_ERROR_MESSAGES[err.code] || err.message, 'error', 5000);
      },
    });
  } catch (err) {
    console.error('[App] 예외 감지:', err);
    if (fullResponse === '') {
      fullResponse = '파우스트의 분석 연산에 예상치 못한 에러가 관측되었습니다. 상태를 다시 확인하십시오.';
    }
  }

  // ─── 스트리밍 마무리 및 저장 ───
  if (fullResponse) {
    finalizeStreamingMessage(fullResponse, responseTimestamp, responseTokens);

    const assistantMsg = {
      role: 'assistant',
      content: fullResponse,
      timestamp: responseTimestamp,
      tokens: responseTokens,
    };

    messages.push(assistantMsg);
    saveMessages(messages);
  }

  // ─── 상태 원복 ───
  isGenerating = false;
  setGeneratingState(false);
  setInputEnabled(true);

  // 텍스트 필드 포커스 회수
  setTimeout(() => DOM.userInput()?.focus(), 150);
}

// ─────────────────────────────────────────────
// 앱 스타트업
// ─────────────────────────────────────────────

bootstrap().catch((err) => {
  console.error('[App] 부트스트랩 치명 오류:', err);
  showLoadingError(
    'BOOTSTRAP FAIL',
    err.message + '\n\n초기 구동 네트워크망 혹은 드라이버 환경을 점검하십시오.'
  );
});
