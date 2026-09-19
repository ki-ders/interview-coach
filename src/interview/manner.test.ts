import { describe, expect, it } from 'vitest';
import { detectManner } from './manner';

const kinds = (t: string) => detectManner(t).map((h) => h.kind);
const words = (t: string) => detectManner(t).map((h) => h.word);

describe('반말 감지', () => {
  it('반말 종결형을 잡는다', () => {
    expect(kinds('그래서 내가 그걸 다 했어 그리고 잘 됐지')).toEqual(['banmal', 'banmal']);
    expect(words('나는 데이터 분석을 좋아해 그게 다야')).toContain('좋아해');
    expect(kinds('몰라 그냥 좋은 회사라서')).toContain('banmal');
    expect(kinds('열심히 할게')).toContain('banmal');
    expect(words('나는 데이터 분석을 전공했어. 팀을 이끌면서 모델을 만들었지. 제일 큰 성과야.')).toEqual(['전공했어', '만들었지', '성과야']);
  });

  it('존댓말은 잡지 않는다', () => {
    expect(kinds('네, 저는 데이터 분석을 전공한 지원자입니다. 열심히 했어요.')).toEqual([]);
    expect(kinds('프로젝트를 했는데 어려웠습니다. 그래서 다시 했습니다.')).toEqual([]);
    expect(kinds('중요하다고 생각합니다. 그렇게 알아 가면서 배웠습니다.')).toEqual([]);
    expect(kinds('가능성이 있어 보입니다. 이야기를 많이 나눴습니다.')).toEqual([]);
    expect(kinds('같아서 조금 아쉬웠습니다. 좋아하는 일이라서요.')).toEqual([]);
    expect(kinds('데이터 분야 에서 일했습니다. 이 분야 전문가가 되고 싶습니다.')).toEqual([]);
    expect(kinds('문제가 있는데 그래서 고쳤습니다')).toEqual([]);
  });
});

describe('비속어 감지', () => {
  it('욕설을 잡는다', () => {
    expect(kinds('아 씨발 그게 잘 안 됐습니다')).toContain('profanity');
    expect(words('존나 열심히 했습니다')).toContain('존나');
    expect(kinds('팀장이 개새끼라서 힘들었습니다')).toContain('profanity');
    expect(kinds('진짜 지랄 같았습니다')).toContain('profanity');
  });

  it('욕이 아닌 낱말 속 글자는 넘긴다', () => {
    expect(kinds('새끼손가락을 다쳤습니다')).toEqual([]);
    expect(kinds('시바견을 키웁니다')).toEqual([]);
    expect(kinds('미친 듯이 노력했습니다')).toEqual([]);
    expect(kinds('개발자로 일했습니다 개선점을 찾았습니다')).toEqual([]);
  });

  it('발췌와 문항 번호를 남긴다', () => {
    const [h] = detectManner('그래서 씨발 다시 했습니다', 3);
    expect(h.kind).toBe('profanity');
    expect(h.questionIndex).toBe(3);
    expect(h.excerpt).toContain('씨발');
  });
});

describe('시나리오 대본(존댓말)에서는 오탐이 없다', () => {
  it('manner 시나리오를 뺀 모든 답변', async () => {
    const { SCENARIOS } = await import('../sim/scenarios');
    for (const sc of SCENARIOS) {
      if (sc.id === 'manner') continue;
      for (const a of sc.answers) {
        const hits = detectManner(a.text);
        expect(hits, `${sc.id}: ${a.text.slice(0, 40)} → ${hits.map((h) => h.word).join(',')}`).toEqual([]);
      }
    }
  });
});
