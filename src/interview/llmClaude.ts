/**
 * Anthropic Claude 로 면접관 두뇌를 돌린다 (유료 API 키 필요).
 * 브라우저에서 직접 호출하므로 키가 그 기기의 네트워크 요청에 노출된다. 개인 연습용으로만 쓸 것.
 */
import type { AnswerRecord, Interviewer } from '../types';
import {
  buildEvalPrompt,
  buildSummaryPrompt,
  normalizeSummary,
  normalizeVerdict,
  type EvalOpts,
  type LlmSummary,
  type LlmVerdict,
} from './llmPrompts';
import type { InterviewerLlm, LlmTestResult } from './llm';

const TIMEOUT_MS = 20000;
const MODEL = 'claude-opus-5';

async function loadSdk() {
  const [{ default: Anthropic }, { z }, { zodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('zod'),
    import('@anthropic-ai/sdk/helpers/zod'),
  ]);
  return { Anthropic, z, zodOutputFormat };
}

export class ClaudeLlm implements InterviewerLlm {
  readonly provider = 'claude' as const;
  private readonly key: string;
  lastError: string | null = null;

  constructor(apiKey: string) {
    this.key = apiKey.trim();
  }

  private async client() {
    const { Anthropic, z, zodOutputFormat } = await loadSdk();
    const client = new Anthropic({
      apiKey: this.key,
      dangerouslyAllowBrowser: true,
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });
    return { client, z, zodOutputFormat };
  }

  async evaluate(opts: EvalOpts): Promise<LlmVerdict | null> {
    if (opts.answer.trim().length < 4) return null;
    try {
      const { client, z, zodOutputFormat } = await this.client();
      const Verdict = z.object({
        relevance: z.number().describe('질문과 답변이 맞물린 정도 0~100'),
        note: z.string().describe('지원자에게 도움이 될 한 줄 평가 (한국어, 40자 이내)'),
        followUp: z.string().describe('이어서 던질 꼬리 질문 한 문장 (한국어 존댓말). 불필요하면 빈 문자열'),
        handoff: z.boolean().describe('옆 면접관이 꼬리 질문을 이어받는 게 자연스러우면 true'),
        bridge: z.string().describe('다음 질문 앞에 붙일, 방금 답변을 짚는 한 마디 (20자 이내). 없으면 빈 문자열'),
        gist: z.string().describe('오인식을 감안해 면접관이 이해한 답변 요지 한 문장 (60자 이내)'),
        flags: z.array(z.enum(['name', 'school', 'family', 'award', 'examNo', 'banmal', 'profanity'])).describe('답변에서 발견한 문제: 성명/학교/가족/수상/수험번호 언급, 반말, 비속어'),
      });
      const { system, user } = buildEvalPrompt(opts);
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
        system,
        messages: [{ role: 'user', content: user }],
      });
      this.lastError = null;
      return normalizeVerdict(response.parsed_output);
    } catch (err) {
      this.lastError = `Claude 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[llm:claude]', err);
      return null;
    }
  }

  async summarize(answers: AnswerRecord[], interviewers: Interviewer[]): Promise<LlmSummary | null> {
    if (!answers.some((a) => a.transcript.trim().length > 4)) return null;
    try {
      const { client, z, zodOutputFormat } = await this.client();
      const Summary = z.object({
        summary: z.string(),
        strengths: z.array(z.string()),
        improvements: z.array(z.string()),
      });
      const { system, user } = buildSummaryPrompt(answers, interviewers);
      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 3000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: zodOutputFormat(Summary) },
        system,
        messages: [{ role: 'user', content: user }],
      });
      this.lastError = null;
      return normalizeSummary(response.parsed_output);
    } catch (err) {
      this.lastError = `Claude 호출 실패: ${err instanceof Error ? err.message : String(err)}`;
      console.warn('[llm:claude]', err);
      return null;
    }
  }

  async test(): Promise<LlmTestResult> {
    try {
      const { client } = await this.client();
      await client.models.list({ limit: 1 });
      return { ok: true, message: 'Claude 연결 확인됨' };
    } catch (err) {
      return { ok: false, message: `키가 거부되었습니다: ${err instanceof Error ? err.message : String(err)}` };
    }
  }
}
