import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hyun0.interviewcoach',
  appName: 'AI 면접 코치',
  webDir: 'dist',
  android: {
    // 카메라(getUserMedia)는 https 또는 localhost 에서만 허용된다. Capacitor 기본값이 https 다.
    allowMixedContent: false,
    // MediaPipe wasm 이 12MB 라 첫 로딩이 느릴 수 있어 스플래시를 짧게 유지
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
