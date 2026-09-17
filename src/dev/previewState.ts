import type { SessionState } from '../interview/useSession';

/**
 * 카메라 없이 면접 화면 레이아웃을 확인하기 위한 가짜 상태 (?preview=interview).
 * 실제 세션에는 쓰이지 않는다.
 */
export function makePreviewState(): SessionState {
  return {
    phase: 'running',
    loadingMessage: '',
    error: null,
    calibStep: 'done',
    calibCountdown: 0,
    live: { gaze: 82, gesture: 74, speech: 61, voice: 38, calm: 47 },
    micLevel: 0.62,
    alerts: [
      { id: 1, key: 'voice', text: '목소리가 작습니다. 조금 더 크게 말해 주세요.', t: 41000 },
      { id: 2, key: 'calm', text: '다리 떨림이 감지됐습니다. 두 발을 바닥에 붙여 보세요.', t: 58000 },
    ],
    subtitle: {
      speakerId: 'kang',
      text: '가장 성과가 좋았던 프로젝트를 설명해 주세요. 본인의 역할도 함께요.',
      isQuestion: true,
    },
    avatars: { kang: 'speaking', seo: 'writing' },
    transcript: '네, 작년에 진행한 수요 예측 프로젝트를 말씀드리겠습니다. 저는 데이터 전처리와 모델링을 맡았고',
    interim: '결과적으로 오차를 18퍼센트',
    questionIndex: 2,
    totalQuestions: 8,
    elapsedSec: 214,
    report: null,
    debug: {
      gazeX: 0.12,
      gazeDown: 0.31,
      shoulderTilt: 4.2,
      neckRatio: 0.96,
      legFreq: 5.4,
      legStrength: 0.52,
      legSource: 'knee',
      fps: 27.4,
    },
    sttSupported: true,
    notice: null,
    faceVisible: true,
    turnHint: null,
    llmSummaryPending: false,
  };
}
