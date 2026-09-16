import type { AnswerRecord, Interviewer, Question, RelevanceAnalysis, SpeechAnalysis } from '../types';

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

export interface FollowUpDecision {
  /** 추가 질문 문장. null 이면 다음 질문으로 넘어간다 */
  text: string | null;
  /** 어떤 이유로 물었는지 (리포트에 표시) */
  reason: string;
}

/**
 * 답변을 듣고 꼬리 질문을 할지 정한다.
 * LLM 없이도 동작하도록 규칙 기반으로 짠다.
 */
export function decideFollowUp(
  who: Interviewer,
  question: Question,
  relevance: RelevanceAnalysis,
  speech: SpeechAnalysis,
  alreadyFollowedUp: boolean,
): FollowUpDecision {
  if (alreadyFollowedUp) return { text: null, reason: '' };

  const words = speech.wordCount;

  // 거의 답을 못 한 경우는 성향과 무관하게 되묻는다
  if (words < 8) {
    return { text: pick(who.lines.tooShort), reason: '답변이 지나치게 짧음' };
  }

  if (relevance.score < 35) {
    const line = pick(who.lines.offTopic);
    return { text: `${line} 다시 여쭙겠습니다. ${question.text}`, reason: '질문과 답변의 초점이 어긋남' };
  }

  // 성향에 따라 추가 질문 빈도를 조절한다
  const appetite = who.strictness >= 1.1 ? 0.85 : who.strictness >= 1.0 ? 0.6 : 0.4;
  if (Math.random() > appetite) return { text: null, reason: '' };

  if (!relevance.hasConcreteExample) {
    return { text: pick(who.lines.pressForExample), reason: '구체적 사례 부족' };
  }

  if (words < 45) {
    return { text: pick(who.lines.pressForDetail), reason: '설명의 깊이 부족' };
  }

  if (relevance.score < 60) {
    return { text: pick(who.lines.pressForDetail), reason: '핵심 근거가 약함' };
  }

  return { text: null, reason: '' };
}

export function greetingOf(who: Interviewer): string {
  return pick(who.lines.greeting);
}

export function ackOf(who: Interviewer): string {
  return pick(who.lines.ack);
}

export function silenceNudgeOf(who: Interviewer): string {
  return pick(who.lines.silence);
}

export function closingOf(who: Interviewer): string {
  return pick(who.lines.closing);
}

/** 두 면접관이 번갈아 질문하도록 배정 */
export function assignAsker(index: number, ids: [string, string]): string {
  return ids[index % 2];
}

/** 리포트용 내용 총평 */
export function summarizeContent(answers: AnswerRecord[]): { score: number; summary: string } {
  const scored = answers.filter((a) => a.speech.wordCount >= 4);
  if (!scored.length) {
    return { score: 0, summary: '답변이 인식되지 않아 내용 평가를 할 수 없었습니다.' };
  }
  // 인식되지 않은(침묵한) 답변은 0점으로 넣는다 — 빼 버리면 한 문제만 잘 답해도 평균이 높아진다
  const avg = answers.reduce((s, a) => s + (a.speech.wordCount >= 4 ? a.relevance.score : 0), 0) / answers.length;
  const noExample = scored.filter((a) => !a.relevance.hasConcreteExample).length;
  const offTopic = scored.filter((a) => a.relevance.score < 40).length;
  const unanswered = answers.length - scored.length;

  let summary: string;
  if (avg >= 80) summary = '질문 의도를 정확히 파악하고 근거도 충분했습니다.';
  else if (unanswered > 0 && unanswered * 2 >= answers.length)
    summary = `${answers.length}개 중 ${unanswered}개 문항에 답하지 못했습니다. 모르는 질문도 아는 범위에서 짧게라도 답하는 편이 낫습니다.`;
  else if (offTopic >= 2) summary = `${offTopic}개 답변이 질문의 초점에서 벗어났습니다. 답변 첫 문장에서 질문을 다시 짚고 시작해 보세요.`;
  else if (noExample >= Math.ceil(scored.length / 2))
    summary = '방향은 맞지만 구체적인 사례가 부족합니다. 상황·행동·결과 순서로 정리해 보세요.';
  else summary = '전반적으로 질문에 부합하는 답변이었습니다. 사례의 밀도를 조금 더 높이면 좋겠습니다.';

  return { score: Math.round(avg), summary };
}
