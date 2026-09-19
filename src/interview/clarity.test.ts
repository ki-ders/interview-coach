import { describe, expect, it } from 'vitest';
import { judgeIntelligibility } from './clarity';

describe('받아쓰기 신뢰 판정', () => {
  it('정상 답변은 되묻지 않는다', () => {
    const v = judgeIntelligibility({
      text: '재고 관리 프로젝트에서 수요 예측 모델을 만들어 폐기율을 줄였습니다',
      confidence: 0.9,
      voicedSec: 7,
    });
    expect(v.unclear).toBe(false);
  });

  it('신뢰도가 낮으면 되묻는다', () => {
    expect(judgeIntelligibility({ text: '그래서 그게 어 저기 뭐', confidence: 0.2, voicedSec: 6 }).unclear).toBe(true);
    expect(judgeIntelligibility({ text: '그래서 그게 어 저기 뭐 프로젝트를 했습니다', confidence: 0.6, voicedSec: 6 }).unclear).toBe(false);
  });

  it('신뢰도를 모르면 글자 수로 판단한다', () => {
    expect(judgeIntelligibility({ text: '네 그게', confidence: null, voicedSec: 9 }).unclear).toBe(true);
    expect(judgeIntelligibility({ text: '네 그게 프로젝트가 잘 됐습니다', confidence: null, voicedSec: 9 }).unclear).toBe(false);
    expect(judgeIntelligibility({ text: '네 그게', confidence: null, voicedSec: 2 }).unclear).toBe(false);
  });

  it('한국어가 아닌 글자가 대부분이면 되묻는다', () => {
    expect(judgeIntelligibility({ text: 'asdf qwer zxcv 네', confidence: null, voicedSec: 3 }).unclear).toBe(true);
  });

  it('빈 답변은 되묻기 대상이 아니다 (침묵 처리 담당)', () => {
    expect(judgeIntelligibility({ text: '', confidence: null, voicedSec: 0 }).unclear).toBe(false);
  });
});
