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
import { blobToBase64, toWav16k } from '../audio/answerRecorder';

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

const TRANSCRIPT_SCHEMA = {
  type: 'OBJECT',
  properties: { transcript: { type: 'STRING' } },
  required: ['transcript'],
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

  private async generate(
    system: string,
    user: string,
    schema: object,
    audio?: { mimeType: string; data: string },
    temperature = 0.6,
  ): Promise<string | null> {
    for (let attempt = 0; attempt < MODELS.length; attempt++) {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const parts: object[] = [{ text: user }];
        if (audio) parts.push({ inlineData: { mimeType: audio.mimeType, data: audio.data } });
        const res = await fetch(`${BASE}/models/${this.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
          signal: ctrl.signal,
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts }],
            generationConfig: {
              responseMimeType: 'application/json',
              responseSchema: schema,
              temperature,
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

  /** 답변 음성을 직접 듣고 받아 적는다 — 브라우저 인식(80% 안팎)보다 정확하다 */
  async transcribe(audio: Blob, mimeType: string, hint: string): Promise<string | null> {
    if (audio.size < 2000) return null;
    // 컨테이너(webm/mp4)마다 지원 여부가 달라 WAV 로 통일한다
    let data: string;
    let mime = mimeType;
    try {
      const wav = await toWav16k(audio);
      data = await blobToBase64(wav);
      mime = 'audio/wav';
    } catch {
      try {
        data = await blobToBase64(audio);
      } catch {
        return null;
      }
    }
    const system = [
      '당신은 한국어 면접 답변 음성을 받아 적는 속기사입니다.',
      '들리는 대로 정확히 적습니다. 추임새("어", "음", "그")와 반복·말 더듬도 그대로 적고, 문장부호를 넣습니다.',
      '요약하거나 다듬거나 존댓말로 고치지 않습니다. 없는 말을 지어내지 않습니다.',
      '면접관의 목소리(질문·안내)가 섞여 있으면 그 부분은 빼고 지원자의 말만 적습니다.',
      '아무 말도 없으면 transcript 를 빈 문자열로 둡니다.',
      '반드시 {"transcript": "..."} JSON 만 출력합니다.',
    ].join('\n');
    const user = hint.trim()
      ? `브라우저 음성 인식 결과(오류가 있을 수 있음, 참고만): "${hint.slice(0, 600)}"\n첨부한 음성을 받아 적어 주세요.`
      : '첨부한 음성을 받아 적어 주세요.';
    const text = await this.generate(system, user, TRANSCRIPT_SCHEMA, { mimeType: mime, data }, 0.1);
    if (!text) return null;
    const parsed = extractJson<{ transcript?: unknown }>(text);
    const out = typeof parsed?.transcript === 'string' ? parsed.transcript.trim() : '';
    return out || null;
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
