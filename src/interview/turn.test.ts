import { describe, expect, it } from 'vitest';
import { decideTurnPolicy, judgeCompleteness } from './turn';

describe('judgeCompleteness', () => {
  it('종결어미로 끝나면 complete', () => {
    for (const t of [
      '저는 데이터 분석을 전공했습니다',
      '그 경험이 가장 큰 성과였습니다.',
      '그렇게 생각해요',
      '팀을 이끌었는데요',
      '지원하게 되었습니다',
      '열심히 하겠습니다!',
      '결과적으로 2주 앞당겼고요',
    ])
      expect(judgeCompleteness(t), t).toBe('complete');
  });

  it('연결어미·접속사·간투사·조사로 끝나면 incomplete', () => {
    for (const t of [
      '학부 때 통계 프로젝트를 진행했고',
      '오차를 줄이기 위해서',
      '그래서',
      '제 강점은',
      '팀에서 갈등이 생겼을 때 저는 먼저',
      '어',
      '그러니까 음',
      '데이터 분석을 하면서',
      '일정이 밀린 적이 있지만',
    ])
      expect(judgeCompleteness(t), t).toBe('incomplete');
  });

  it('판단이 안 서면 unknown', () => {
    expect(judgeCompleteness('')).toBe('unknown');
    expect(judgeCompleteness('수요 예측 모델')).toBe('unknown');
  });
});

describe('decideTurnPolicy', () => {
  const base = { baseSilenceSec: 2.5, sttAvailable: true, sinceSttUpdateMs: 2000 };

  it('끝맺은 문장은 기본보다 조금 빨리, 이어지는 말은 훨씬 오래 기다린다', () => {
    const done = decideTurnPolicy({ ...base, text: '이상입니다.' });
    const going = decideTurnPolicy({ ...base, text: '그리고 두 번째로는' });
    const unknown = decideTurnPolicy({ ...base, text: '수요 예측 모델' });
    expect(done.silenceSec).toBeLessThan(unknown.silenceSec);
    expect(going.silenceSec).toBeGreaterThanOrEqual(5);
    expect(unknown.silenceSec).toBe(2.5);
    expect(done.silenceSec).toBeGreaterThanOrEqual(1.6);
  });

  it('인식 결과가 방금 바뀌었으면 기다린다', () => {
    const p = decideTurnPolicy({ ...base, sinceSttUpdateMs: 200, text: '이상입니다.' });
    expect(p.silenceSec).toBeGreaterThanOrEqual(3);
  });

  it('받아쓰기가 없으면 기본값만 쓴다', () => {
    const p = decideTurnPolicy({ ...base, sttAvailable: false, text: '그리고' });
    expect(p.silenceSec).toBe(2.5);
  });

  it('너무 오래 기다리지는 않는다 (상한 7.5초)', () => {
    const p = decideTurnPolicy({ ...base, baseSilenceSec: 6, text: '그래서' });
    expect(p.silenceSec).toBeLessThanOrEqual(7.5);
  });
});
