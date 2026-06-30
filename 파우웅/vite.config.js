import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    headers: {
      // WebLLM / SharedArrayBuffer 사용에 필요한 헤더
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  optimizeDeps: {
    // WebLLM은 사전 번들링에서 제외 (WASM 포함 대형 패키지)
    exclude: ['@mlc-ai/web-llm'],
  },
  build: {
    target: 'esnext',
    rollupOptions: {
      output: {
        // 청크 크기 경고 제한 상향
        manualChunks: {
          webllm: ['@mlc-ai/web-llm'],
        },
      },
    },
    chunkSizeWarningLimit: 10000,
  },
});
