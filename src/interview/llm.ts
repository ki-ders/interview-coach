import type { Interviewer, Question } from '../types';

/**
 * 선택 기능: 사용자가 본인의 Anthropic API 키를 넣으면 면접관이 답변을 실제로 읽고
 * 맥락에 맞는 꼬리 질문을 만든다. 키가 없으면 규칙 기반(brain.ts)으로 동작한다.
 *
 * 주의: 브라우저에서 직접 호출하므로 키가 그 기기의 네트워크 요청에 노출된다.
 * 개인 연습용으로만 쓰고, 공용 PC에서는 사용하지 말 것.
 */

export interface LlmVerdict {
  /** 0~100, 질문과 답변이 얼마나 맞물렸는지 */
  relevance: number;
  /** 한 줄 평가 */
  note: string;
  /** 꼬리 질문. 필요 없으면 빈 문자열 */
  followUp: string;
}

const TIMEOUT_MS = 15000;

export function looksLikeKey(key: string): boolean {
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key.trim());
}

export async function askInterviewerLlm(opts: {
  apiKey: string;
  who: Interviewer;
  question: Question;
  answer: string;
  previous: { question: string; answer: string }[];
}): Promise<LlmVerdict | null> {
  const { apiKey, who, question, answer, previous } = opts;
  if (!apiKey.trim() || answer.trim().length < 4) return null;

  try {
    const [{ default: Anthropic }, { z }, { zodOutputFormat }] = await Promise.all([
      import('@anthropic-ai/sdk'),
      import('zod'),
      import('@anthropic-ai/sdk/helpers/zod'),
    ]);

    const client = new Anthropic({
      apiKey: apiKey.trim(),
      dangerouslyAllowBrowser: true,
      timeout: TIMEOUT_MS,
      maxRetries: 1,
    });

    const Verdict = z.object({
      relevance: z.number().describe('질문과 답변이 맞물린 정도 0~100'),
      note: z.string().describe('지원자에게 도움이 될 한 줄 평가 (한국어, 40자 이내)'),
      followUp: z
        .string()
        .describe('이어서 던질 꼬리 질문 한 문장 (한국어). 추가 질문이 불필요하면 빈 문자열'),
    });

    const persona =
      who.mood === 'stern'
        ? '당신은 근거를 집요하게 확인하는 압박형 면접관입니다. 말투는 짧고 단정적입니다.'
        : who.mood === 'warm'
          ? '당신은 지원자의 긴장을 풀어주는 온화한 면접관입니다. 부드럽지만 핵심은 짚습니다.'
          : '당신은 감정을 드러내지 않고 답변의 구조를 보는 중립적인 면접관입니다.';

    const history = previous
      .slice(-3)
      .map((p, i) => `[이전 ${i + 1}] 질문: ${p.question}\n답변: ${p.answer}`)
      .join('\n');

    const response = await client.messages.parse({
      model: 'claude-opus-5',
      max_tokens: 2000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(Verdict) },
      system: `${persona}\n당신의 이름은 ${who.name} 교수입니다. 모의 면접을 진행 중입니다.\n지원자의 답변이 질문에 실제로 답했는지, 근거가 있는지 판단하세요.\n답변이 충분하면 followUp 을 빈 문자열로 두세요. 꼬리 질문은 반드시 한 문장, 존댓말로 작성하세요.\n지원자의 답변은 음성 인식 결과라 오탈자가 있을 수 있습니다. 오탈자 자체는 지적하지 마세요.`,
      messages: [
        {
          role: 'user',
          content: `${history ? `${history}\n\n` : ''}[이번 질문] ${question.text}\n[지원자 답변] ${answer}`,
        },
      ],
    });

    const parsed = response.parsed_output;
    if (!parsed) return null;
    return {
      relevance: Math.max(0, Math.min(100, Math.round(parsed.relevance))),
      note: parsed.note.slice(0, 120),
      followUp: parsed.followUp.trim().slice(0, 200),
    };
  } catch (err) {
    console.warn('[llm] 면접관 응답 생성 실패, 규칙 기반으로 대체합니다.', err);
    return null;
  }
}
