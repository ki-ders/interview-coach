/**
 * Google Gemini (무료 티어) 로 면접관 두뇌를 돌린다.
 * 브라우저에서 REST 로 직접 호출하며 키는 이 기기의 localStorage 에만 있다.
 * 무료 키는 https://aistudio.google.com/apikey 에서 카드 없이 만들 수 있다.
 */
import type { AnswerRecord, Interviewer } from '../types';
import {
  buildEvalPrompt,
  buildSummaryPrompt,
  extractJson,
  normalizeSummary,
  normalizeVerdict,
  type EvalOpts,
  type LlmSummary,
  type LlmVerdict,
} from './llmPrompts';
import type { InterviewerLlm, LlmTestResult } from './llm';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** 앞의 것부터 시도하고, 없다고 하면(404) 다음 것으로 */
const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const TIMEOUT_MS = 20000;

const VERDICT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    relevance: { type: 'INTEGER' },
    note: { type: 'STRING' },
    followUp: { type: 'STRING' },
    handoff: { type: 'BOOLEAN' },
    bridge: { type: 'STRING' },
    gist: { type: 'STRING' },
    flags: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['relevance', 'note', 'followUp', 'handoff', 'bridge', 'gist', 'flags'],
};

const SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    strengths: { type: 'ARRAY', items: { type: 'STRING' } },
    improvements: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['summary', 'strengths', 'improvements'],
};

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string }[] } }[];
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiLlm implements InterviewerLlm {
  readonly provider = 'gemini' as const;
  private readonly key: string;
  private model = MODELS[0];
  lastError: string | null = null;

  constructor(apiKey: string) {
    this.key = apiKey.trim();
  }

  private async generate(system: string, user: string, schema: object): Promise<string | null> {
    for (let attempt = 0; attempt < MODELS.length; attempt++) {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${BASE}/models/${this.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: user }] }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature: 0.6,
              maxOutputTokens: 1024,
              // 면접 흐름을 끊지 않게 빠른 응답을 우선한다 (2.5 계열만 thinking 설정을 받는다)
              ...(this.model.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
            },
          }),
        });
        const data = (await res.json().catch(() => ({}))) as GeminiResponse;
        if (res.status === 404 && attempt < MODELS.length - 1) {
          this.model = MODELS[attempt + 1];
          continue;
        }
        if (!res.ok) {
          this.lastError =
            res.status === 429
              ? '무료 사용량 한도에 잠시 걸렸습니다 (분당 요청 제한). 잠깐 뒤 다시 시도됩니다.'
              : res.status === 400 || res.status === 403
                ? `Gemini 키가 거부되었습니다 (${data.error?.message ?? res.status}).`
                : `Gemini 오류 ${res.status}: ${data.error?.message ?? ''}`;
          return null;
        }
        const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
        this.lastError = null;
        return text || null;
      } catch (err) {
        this.lastError = err instanceof Error && err.name === 'AbortError' ? 'Gemini 응답이 너무 늦어 건너뜁니다.' : `Gemini 연결 실패: ${String(err)}`;
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    }
    return null;
  }

  async evaluate(opts: EvalOpts): Promise<LlmVerdict | null> {
    if (opts.answer.trim().length < 4) return null;
    const { system, user } = buildEvalPrompt(opts);
    const text = await this.generate(system, user, VERDICT_SCHEMA);
    if (!text) return null;
    return normalizeVerdict(extractJson(text));
  }

  async summarize(answers: AnswerRecord[], interviewers: Interviewer[]): Promise<LlmSummary | null> {
    if (!answers.some((a) => a.transcript.trim().length > 4)) return null;
    const { system, user } = buildSummaryPrompt(answers, interviewers);
    const text = await this.generate(system, user, SUMMARY_SCHEMA);
    if (!text) return null;
    return normalizeSummary(extractJson(text));
  }

  /** 키가 유효한지 — 모델 목록 조회는 사용량을 쓰지 않는다 */
  async test(): Promise<LlmTestResult> {
    try {
      const res = await fetch(`${BASE}/models?pageSize=5`, { headers: { 'x-goog-api-key': this.key } });
      if (res.ok) return { ok: true, message: 'Gemini 연결 확인됨 (무료 티어)' };
      const data = (await res.json().catch(() => ({}))) as GeminiResponse;
      return { ok: false, message: `키가 거부되었습니다: ${data.error?.message ?? res.status}` };
    } catch (err) {
      return { ok: false, message: `연결 실패: ${String(err)}` };
    }
  }
}
