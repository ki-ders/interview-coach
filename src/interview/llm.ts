/**
 * 면접관 두뇌 — 갈아끼울 수 있는 LLM 제공자.
 *
 *  - none   : 규칙 기반(brain.ts)만. 키 없음, 비용 0.
 *  - gemini : Google Gemini 무료 티어. 카드 없이 만든 키로 하루 수백 회. 답변 텍스트가 Google 로 간다.
 *  - claude : Anthropic Claude (유료). 이해력이 가장 좋다.
 *
 * 어느 쪽이든 실패하면 조용히 규칙 기반으로 돌아가므로 면접은 끊기지 않는다.
 */
import type { AnswerRecord, Interviewer } from '../types';
import type { EvalOpts, LlmSummary, LlmVerdict } from './llmPrompts';

export type LlmProvider = 'none' | 'gemini' | 'claude';

export interface LlmTestResult {
  ok: boolean;
  message: string;
}

export interface InterviewerLlm {
  readonly provider: LlmProvider;
  /** 답변 하나를 읽고 평가·꼬리질문·연결문장을 만든다. 실패하면 null (규칙 기반으로 대체) */
  evaluate(opts: EvalOpts): Promise<LlmVerdict | null>;
  /** 면접 전체 총평 */
  summarize(answers: AnswerRecord[], interviewers: Interviewer[]): Promise<LlmSummary | null>;
  /** 키가 유효한지 확인 */
  test(): Promise<LlmTestResult>;
  /** 마지막 실패 이유 (UI 안내용) */
  lastError: string | null;
}

export const PROVIDER_LABEL: Record<LlmProvider, string> = {
  none: '없음 (규칙 기반)',
  gemini: 'Gemini — 무료',
  claude: 'Claude — 유료',
};

export function looksLikeKey(provider: LlmProvider, key: string): boolean {
  const k = key.trim();
  if (provider === 'claude') return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k);
  if (provider === 'gemini') return /^AIza[A-Za-z0-9_-]{20,}$/.test(k);
  return true;
}

export function keyHint(provider: LlmProvider): string {
  if (provider === 'claude') return 'sk-ant-... (console.anthropic.com 에서 발급, 유료)';
  if (provider === 'gemini') return 'AIza... (aistudio.google.com/apikey 에서 무료 발급)';
  return '';
}

/** 제공자 모듈은 필요할 때만 내려받는다 (Claude SDK 가 무겁다) */
export async function createInterviewerLlm(provider: LlmProvider, apiKey: string): Promise<InterviewerLlm | null> {
  if (provider === 'none' || !apiKey.trim()) return null;
  if (provider === 'gemini') {
    const { GeminiLlm } = await import('./llmGemini');
    return new GeminiLlm(apiKey);
  }
  const { ClaudeLlm } = await import('./llmClaude');
  return new ClaudeLlm(apiKey);
}

export type { EvalOpts, LlmSummary, LlmVerdict } from './llmPrompts';
