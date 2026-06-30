# LocalMind AI 🧠
> **WebGPU 기반 완전 로컬 실행 AI 채팅 애플리케이션**  
> 모든 AI 추론이 사용자의 GPU에서 직접 실행됩니다. 서버로 데이터가 전송되지 않습니다.

---

## 🚀 시작 전 준비사항

### 1. Node.js 설치 (필수)
현재 시스템에 Node.js가 설치되어 있지 않습니다.

Node.js 공식 사이트(https://nodejs.org) 에서 LTS 버전을 설치하세요.

설치 후 PowerShell에서 확인:
```
node --version   # v20.x.x 이상
npm --version    # 10.x.x 이상
```

### 2. 브라우저 요구사항
- Google Chrome 113+ 또는 Microsoft Edge 113+ (WebGPU 지원)
- Firefox는 현재 WebGPU 미지원

---

## 패키지 설치 및 실행

```powershell
cd "C:\Users\Admin\Desktop\파우웅"
npm install
npm run dev
```

브라우저에서 http://localhost:5173 접속

---

## 프로젝트 구조

```
파우웅/
├── index.html          # 메인 HTML (로딩 화면 + 채팅 UI)
├── vite.config.js      # Vite 설정 (COOP/COEP 헤더 포함)
├── package.json        # 의존성 정의
├── src/
│   ├── main.js         # 진입점 - 앱 오케스트레이션
│   ├── llm.js          # WebLLM 엔진 관리
│   ├── chat.js         # 채팅 UI 렌더링
│   ├── memory.js       # LocalStorage 메모리 시스템
│   └── style.css       # 프리미엄 다크 모드 스타일
└── public/             # 정적 파일
```

---

## 사용 모델

모델: Llama-3.1-8B-Instruct-q4f32_1-MLC
양자화: Q4F32 (4-bit 가중치, float32 연산)
필요 VRAM: ~5.5GB
최초 다운로드: ~4GB (이후 브라우저 캐시에 저장)
엔진: WebLLM + WebGPU
