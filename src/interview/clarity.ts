/**
 * 받아쓰기가 믿을 만한지 — 면접관이 "다시 한번 말씀해 주시겠어요?" 라고 되물을지 판단한다.
 * 음성 인식기의 신뢰도, 말한 시간 대비 인식된 글자 수, 한글 비율을 본다.
 */
import type { Interviewer } from '../types';

export interface ClarityInput {
  text: string;
  /** 인식기가 준 평균 신뢰도(0~1). 모르면 null */
  confidence: number | null;
  /** 실제로 소리를 낸 시간(초) */
  voicedSec: number;
}

export interface ClarityVerdict {
  unclear: boolean;
  reason: string | null;
}

const hangulCount = (s: string) => (s.match(/[가-힣]/g) ?? []).length;

export function judgeIntelligibility(i: ClarityInput): ClarityVerdict {
  const text = i.text.trim();
  if (!text) return { unclear: false, reason: null };
  const letters = text.replace(/[\s.,?!]/g, '').length;
  const hangul = hangulCount(text);

  // 되묻기는 정말 못 알아들었을 때만 — 인식률 80% 안팎의 보통 답변은 문맥으로 이해하는 쪽이 낫다
  if (i.confidence !== null && i.confidence < 0.3) {
    return { unclear: true, reason: `인식 신뢰도가 낮음 (${Math.round(i.confidence * 100)}%)` };
  }
  // 6초 넘게 말했는데 인식된 글자가 초당 0.8자도 안 되면 대부분을 놓친 것이다
  if (i.voicedSec >= 6 && hangul / i.voicedSec < 0.8) {
    return { unclear: true, reason: `말한 시간(${i.voicedSec.toFixed(0)}초)에 비해 인식된 글자가 너무 적음` };
  }
  if (letters >= 6 && hangul / letters < 0.4) {
    return { unclear: true, reason: '한국어로 인식되지 않은 부분이 많음' };
  }
  return { unclear: false, reason: null };
}

/** 면접관 성향에 맞는 되묻기 문장 */
export function reaskLineOf(who: Interviewer): string {
  if (who.mood === 'stern') return '잘 안 들렸습니다. 다시 한번 말씀해 주세요.';
  if (who.mood === 'warm') return '죄송해요, 제가 잘 못 알아들었어요. 다시 한번 말씀해 주시겠어요?';
  return '죄송합니다, 잘 못 알아들었습니다. 다시 한번 말씀해 주시겠어요?';
}
