/**
 * 키 없이 "면접관 두뇌" 흐름(이어받기·연결 문장·총평)을 검증하기 위한 가짜 LLM.
 * 답변 내용을 읽는 척만 하고 정해진 판정을 돌려준다.
 */
import type { AnswerRecord, Interviewer } from '../types';
import type { EvalOpts, InterviewerLlm, LlmSummary, LlmTestResult, LlmVerdict } from '../interview/llm';

export class FakeLlm implements InterviewerLlm {
  readonly provider = 'gemini' as const;
  lastError: string | null = null;
  calls: string[] = [];
  /** 응답 지연 (ms) — 실제 API 처럼 1~2초 걸리게 */
  latencyMs = 1200;

  private readonly log: (msg: string) => void;
  constructor(log: (msg: string) => void) {
    this.log = log;
  }

  private async wait() {
    await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  async evaluate(o: EvalOpts): Promise<LlmVerdict | null> {
    await this.wait();
    const words = o.answer.trim().split(/\s+/).length;
    const turn = o.previous.length;
    this.calls.push(`evaluate#${turn}`);
    // 1번째 답변: 충분 → 꼬리질문 없음, 연결 문장만
    if (turn === 0) {
      const v: LlmVerdict = {
        relevance: 84,
        note: '수요 예측 사례가 구체적이어서 좋았습니다.',
        followUp: '',
        handoff: false,
        bridge: '수요 예측 얘기 흥미롭게 들었습니다.',
        gist: '',
        flags: [],
      };
      this.log(`가짜 LLM: 평가 ${v.relevance}, 연결문장 있음`);
      return v;
    }
    // 2번째 답변: 옆 면접관이 이어받아 근거를 캐묻는다
    if (turn === 1) {
      const v: LlmVerdict = {
        relevance: 62,
        note: '약점 보완 방식은 좋지만 강점의 근거가 약합니다.',
        followUp: '로그를 사흘 동안 추적했다고 하셨는데, 그 판단이 옳았다는 걸 어떻게 확인하셨나요?',
        handoff: true,
        bridge: '',
        gist: '',
        flags: [],
      };
      this.log(`가짜 LLM: ${o.other.name} 교수가 이어받아 되물음`);
      return v;
    }
    const v: LlmVerdict = {
      relevance: words < 8 ? 15 : 55,
      note: words < 8 ? '답변이 너무 짧습니다.' : '방향은 맞지만 사례가 없습니다.',
      followUp: words < 8 ? '조금 더 구체적으로, 어떤 점에 끌리셨는지 말씀해 주시겠어요?' : '',
      handoff: false,
      bridge: '',
      gist: '',
        flags: [],
    };
    this.log(`가짜 LLM: 평가 ${v.relevance}${v.followUp ? ', 되물음' : ''}`);
    return v;
  }

  async summarize(answers: AnswerRecord[], interviewers: Interviewer[]): Promise<LlmSummary | null> {
    await this.wait();
    this.calls.push('summarize');
    this.log(`가짜 LLM: 총평 (${answers.length}문항, ${interviewers.map((i) => i.name).join('·')})`);
    return {
      summary: '전반적으로 질문의 의도를 잘 잡았고, 첫 답변의 수요 예측 사례가 특히 설득력 있었습니다. 다만 강점을 말할 때는 결과뿐 아니라 그 판단이 옳았음을 어떻게 확인했는지까지 이어 말하면 더 단단해집니다.',
      strengths: ['구체적인 수치(18퍼센트)로 성과를 보여줌', '약점을 인정하고 보완 방법까지 제시함'],
      improvements: ['꼬리 질문에는 결론부터 한 문장으로 답한 뒤 근거를 덧붙이기', '지원 동기는 회사의 구체적인 특징 하나를 짚어 시작하기'],
    };
  }

  async test(): Promise<LlmTestResult> {
    return { ok: true, message: '가짜 LLM' };
  }
}
