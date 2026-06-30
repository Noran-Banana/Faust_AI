/**
 * llm.js
 * ──────────────────────────────────────────────
 * WebLLM 기반 로컬 LLM 추론 엔진
 * - WebGPU 지원 확인
 * - MLC Engine 초기화 및 모델 로딩
 * - 스트리밍 응답 생성
 * - GPU 메모리 효율 관리
 * ──────────────────────────────────────────────
 *
 * 사용 모델:
 *   Llama-3.1-8B-Instruct-q4f32_1-MLC
 *   (WebLLM 공식 지원 / Q4 4-bit 양자화 / AMD RX 9060 XT 16GB 최적화)
 *
 * ※ Llama-3.1-Storm-8B는 공식 WebLLM 지원 모델이 아닙니다.
 *    MLC 형식으로 직접 변환 후 커스텀 AppConfig로 교체 가능합니다.
 *    아래 MODEL_ID를 변경하고 CUSTOM_MODEL_CONFIG를 설정하세요.
 * ──────────────────────────────────────────────
 */

import * as webllm from '@mlc-ai/web-llm';

// ─────────────────────────────────────────────
// 모델 설정
// ─────────────────────────────────────────────

/**
 * 기본 모델 ID
 * AMD RX 9060 XT 16GB VRAM에 최적화된 Q4F32 양자화 모델
 * 필요 VRAM: ~5.5GB (16GB에서 여유롭게 실행 가능)
 */
export const MODEL_ID = 'Llama-3.1-8B-Instruct-q4f32_1-MLC';

/**
 * 커스텀 모델 설정 (선택 사항)
 * Llama-3.1-Storm-8B 등 MLC 변환 완료된 모델을 사용할 경우
 * 아래 주석을 해제하고 URL을 변경하세요.
 */
/*
export const CUSTOM_MODEL_CONFIG = {
  model_list: [
    {
      model_id: 'Llama-3.1-Storm-8B-q4f32_1-MLC',
      model:    'https://your-cdn.com/Llama-3.1-Storm-8B-q4f32_1-MLC',
      model_lib: 'https://your-cdn.com/Llama-3.1-Storm-8B-q4f32_1-MLC/model.wasm',
      low_resource_required: false,
      vram_required_MB: 5500,
    },
  ],
};
*/

/**
 * 엔진 초기화 옵션
 * AMD RX 9060 XT 16GB 기준 최대 성능 설정
 */
const ENGINE_CONFIG = {
  // 최대 컨텍스트 길이 (16GB VRAM이면 충분)
  context_window_size: 4096,
  // GPU 메모리 한도 설정 (MB, 16GB = 16384)
  gpu_memory_utilization: 0.85,
};

// ─────────────────────────────────────────────
// 내부 상태
// ─────────────────────────────────────────────

/** @type {webllm.MLCEngine | null} */
let engine = null;

/** 현재 응답 생성 중단 플래그 */
let abortFlag = false;

/** 감지된 GPU 정보 */
let detectedGPU = { name: 'Unknown', backend: 'WebGPU' };

// ─────────────────────────────────────────────
// WebGPU 지원 확인
// ─────────────────────────────────────────────

/**
 * Windows Chromium 버그 우회용 안전한 GPU 어댑터 획득 함수
 *
 * Windows 환경의 Chromium(CEF 포함)에서는 requestAdapter()에
 * `powerPreference` 옵션이 포함되어 있으면 어댑터 반환에 실패하는
 * 알려진 버그가 있습니다. (https://crbug.com)
 *
 * 3단계 폴백 전략:
 *   1순위: { powerPreference: 'high-performance' }  — 고성능 GPU 우선
 *   2순위: {}                                        — 옵션 없이 기본값
 *   3순위: { featureLevel: 'compatibility' }         — 하위 호환 모드
 *
 * @returns {Promise<GPUAdapter | null>}
 */
async function requestAdapterSafe() {
  const strategies = [
    {
      label: 'high-performance',
      options: { powerPreference: 'high-performance' },
    },
    {
      label: 'default (no options)',
      options: {},
    },
    {
      label: 'compatibility featureLevel',
      options: { featureLevel: 'compatibility' },
    },
  ];

  for (const { label, options } of strategies) {
    try {
      console.log(`[WebGPU] requestAdapter 시도: ${label}`);
      const adapter = await navigator.gpu.requestAdapter(options);
      if (adapter) {
        console.log(`[WebGPU] 어댑터 획득 성공: ${label}`);
        return adapter;
      }
      console.warn(`[WebGPU] 어댑터 null 반환 (${label}), 다음 전략 시도...`);
    } catch (err) {
      // Windows Chromium powerPreference 버그 포함 모든 예외 포착
      console.warn(`[WebGPU] requestAdapter 실패 (${label}): ${err.message}`);
    }
  }

  // 모든 전략 실패
  console.error('[WebGPU] 모든 requestAdapter 전략이 실패했습니다. WebGPU를 사용할 수 없습니다.');
  return null;
}

/**
 * WebGPU 지원 여부 확인 및 GPU 정보 반환
 *
 * Windows Chromium(CEF/Wallpaper Engine 등) 환경에서의 powerPreference
 * 버그를 자동으로 우회하며, 최종 실패 시 렌더러가 뻗지 않고
 * 명확한 에러 메시지를 반환합니다.
 *
 * @returns {Promise<{supported: boolean, gpu: string, error?: string}>}
 */
export async function checkWebGPUSupport() {
  // ── navigator.gpu 존재 확인 ──────────────────────────────
  if (!navigator.gpu) {
    return {
      supported: false,
      gpu: '없음',
      error:
        'navigator.gpu가 존재하지 않습니다. ' +
        'Chrome 113+ / Edge 113+ 를 사용하거나, ' +
        'chrome://flags에서 WebGPU를 활성화해 주세요.',
    };
  }

  // ── 3단계 폴백으로 어댑터 획득 ──────────────────────────
  let adapter = null;
  try {
    adapter = await requestAdapterSafe();
  } catch (unexpectedErr) {
    // requestAdapterSafe 내부에서 잡지 못한 예외 최종 방어
    console.error('[WebGPU] requestAdapterSafe 예외 누출:', unexpectedErr);
    return {
      supported: false,
      gpu: '없음',
      error: `WebGPU 어댑터 요청 중 예외 발생: ${unexpectedErr.message}`,
    };
  }

  if (!adapter) {
    return {
      supported: false,
      gpu: '없음',
      error:
        'GPU 어댑터를 가져올 수 없습니다. ' +
        '드라이버를 최신 버전으로 업데이트하거나, ' +
        '하드웨어 가속이 활성화되어 있는지 확인해 주세요.',
    };
  }

  // ── GPU 이름 추출 (requestAdapterInfo deprecated 대응) ───
  let gpuName = 'Unknown GPU';
  try {
    // 신규 API: adapter.info (Chrome 121+)
    // 구형 API: adapter.requestAdapterInfo() (deprecated, 일부 환경에서 예외)
    const info = adapter.info ?? (await adapter.requestAdapterInfo().catch(() => null));
    gpuName =
      info?.description ||
      info?.device     ||
      info?.vendor     ||
      'Unknown GPU';
  } catch (infoErr) {
    console.warn('[WebGPU] GPU 정보 조회 실패 (무시됨):', infoErr.message);
  }

  detectedGPU.name = gpuName;

  // ── GPU 장치 생성 가능 여부 검증 ─────────────────────────
  try {
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
        maxBufferSize:               adapter.limits.maxBufferSize,
      },
    });
    device.destroy(); // 검증 후 즉시 해제
  } catch (deviceErr) {
    console.warn('[WebGPU] requestDevice 실패, 기본 제한으로 재시도:', deviceErr.message);
    // 기본 제한으로 재시도 (일부 환경에서 maxStorageBufferBindingSize 제한 오류 발생)
    try {
      const device = await adapter.requestDevice();
      device.destroy();
    } catch (fallbackErr) {
      return {
        supported: false,
        gpu: gpuName,
        error: `GPU 장치 생성 실패: ${fallbackErr.message}`,
      };
    }
  }

  console.log(`[WebGPU] 초기화 완료 — GPU: ${gpuName}`);
  return { supported: true, gpu: gpuName };
}

// ─────────────────────────────────────────────
// 엔진 초기화
// ─────────────────────────────────────────────

/**
 * WebLLM MLC 엔진 초기화 및 모델 로딩
 *
 * @param {Object} callbacks
 * @param {(report: {progress: number, text: string}) => void} callbacks.onProgress
 * @param {(phase: string) => void} callbacks.onPhase
 * @returns {Promise<void>}
 */
export async function initEngine({ onProgress, onPhase } = {}) {
  if (engine) return; // 이미 초기화된 경우 스킵

  onPhase?.('모델 초기화 시작...');

  const initProgressCallback = (report) => {
    // report.progress: 0.0 ~ 1.0
    // report.text: 현재 작업 설명
    onProgress?.({
      progress: Math.round(report.progress * 100),
      text: report.text,
    });
  };

  try {
    engine = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback,
      // 커스텀 모델 사용 시 아래 주석 해제
      // appConfig: CUSTOM_MODEL_CONFIG,
      engineConfig: ENGINE_CONFIG,
    });

    onPhase?.('완료');
    console.log('[LLM] 엔진 초기화 완료:', MODEL_ID);
  } catch (err) {
    engine = null;
    throw new LLMError('ENGINE_INIT_FAILED', `모델 초기화 실패: ${err.message}`, err);
  }
}

// ─────────────────────────────────────────────
// 응답 생성
// ─────────────────────────────────────────────

/**
 * LLM 스트리밍 응답 생성
 *
 * @param {Array<{role: string, content: string}>} messages OpenAI 형식 메시지 배열
 * @param {Object} callbacks
 * @param {(chunk: string) => void} callbacks.onChunk     각 토큰 청크 콜백
 * @param {(usage: object) => void} callbacks.onComplete  완료 시 usage 정보 콜백
 * @param {(err: Error) => void}    callbacks.onError     오류 콜백
 * @returns {Promise<string>} 생성된 전체 텍스트
 */
export async function generateResponse(messages, { onChunk, onComplete, onError } = {}) {
  if (!engine) {
    const err = new LLMError('ENGINE_NOT_INITIALIZED', '엔진이 초기화되지 않았습니다.');
    onError?.(err);
    throw err;
  }

  abortFlag = false;
  let fullText = '';

  try {
    const response = await engine.chat.completions.create({
      messages,
      stream: true,
      stream_options: { include_usage: true },
      // 생성 파라미터 (AMD 16GB VRAM 최적화)
      temperature: 0.7,
      top_p: 0.9,
      max_tokens: 2048,
      repetition_penalty: 1.1,
    });

    for await (const chunk of response) {
      // 중단 요청 처리
      if (abortFlag) {
        console.log('[LLM] 생성 중단됨');
        break;
      }

      const delta   = chunk.choices?.[0]?.delta?.content ?? '';
      const usage   = chunk.usage;
      const finish  = chunk.choices?.[0]?.finish_reason;

      if (delta) {
        fullText += delta;
        onChunk?.(delta);
      }

      // 완료 처리
      if (finish || usage) {
        onComplete?.(usage ?? { completion_tokens: 0, prompt_tokens: 0, total_tokens: 0 });
      }
    }

    return fullText;
  } catch (err) {
    const llmErr = new LLMError('GENERATION_FAILED', `응답 생성 실패: ${err.message}`, err);
    onError?.(llmErr);
    throw llmErr;
  }
}

// ─────────────────────────────────────────────
// 제어 함수
// ─────────────────────────────────────────────

/** 현재 응답 생성 중단 */
export function abortGeneration() {
  abortFlag = true;
  engine?.interruptGenerate?.();
}

/** 엔진 인스턴스 반환 */
export function getEngine() {
  return engine;
}

/** 엔진이 초기화되었는지 확인 */
export function isEngineReady() {
  return engine !== null;
}

/** GPU 정보 반환 */
export function getGPUInfo() {
  return { ...detectedGPU };
}

/**
 * 엔진 언로드 (메모리 해제)
 * 페이지 이탈 또는 모델 교체 시 호출
 */
export async function unloadEngine() {
  if (engine) {
    try {
      await engine.unload();
    } catch {
      // 무시
    }
    engine = null;
    console.log('[LLM] 엔진 언로드 완료');
  }
}

// ─────────────────────────────────────────────
// 커스텀 에러 클래스
// ─────────────────────────────────────────────

export class LLMError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Error} [cause]
   */
  constructor(code, message, cause) {
    super(message);
    this.name = 'LLMError';
    this.code = code;
    this.cause = cause;
  }
}

// ─────────────────────────────────────────────
// 오류 코드별 사용자 메시지 매핑
// ─────────────────────────────────────────────

export const LLM_ERROR_MESSAGES = {
  ENGINE_NOT_INITIALIZED: '모델이 아직 로딩되지 않았습니다. 잠시 기다려 주세요.',
  ENGINE_INIT_FAILED: '모델 초기화에 실패했습니다. 페이지를 새로고침하거나 네트워크 연결을 확인해 주세요.',
  GENERATION_FAILED: '응답 생성 중 오류가 발생했습니다. 다시 시도해 주세요.',
  WEBGPU_NOT_SUPPORTED: 'WebGPU를 지원하지 않는 브라우저입니다. Chrome 113+ 또는 Edge 113+를 사용해 주세요.',
  GPU_ADAPTER_NOT_FOUND: 'GPU를 찾을 수 없습니다. 그래픽 드라이버를 업데이트해 주세요.',
};

/**
 * 로컬에 캐싱된 WebLLM 모델 데이터 완전히 삭제
 * @returns {Promise<boolean>} 삭제 성공 여부
 */
export async function deleteModelCache() {
  if (!('caches' in window)) {
    return false;
  }
  
  try {
    const keys = await caches.keys();
    let hasDeleted = false;
    
    for (const key of keys) {
      // WebLLM 캐시 키는 일반적으로 'webllm' 접두사나 모델명을 포함함
      if (key.startsWith('webllm') || key.includes('MLC') || key.includes('Llama')) {
        console.log(`[LLM] 캐시 데이터 삭제 시도: ${key}`);
        const success = await caches.delete(key);
        if (success) {
          hasDeleted = true;
        }
      }
    }
    
    return hasDeleted;
  } catch (err) {
    console.error('[LLM] 캐시 데이터 소거 중 오류 발생:', err);
    throw err;
  }
}
