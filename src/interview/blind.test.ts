import { describe, expect, it } from 'vitest';
import { blindWarningLine, detectBlindViolations } from './blind';

const cats = (t: string) => detectBlindViolations(t).map((v) => v.category);

describe('블라인드 면접 위반 감지', () => {
  it('이름을 밝히면 잡는다', () => {
    expect(cats('안녕하세요 저는 김민수입니다 지원 동기는')).toContain('name');
    expect(cats('제 이름은 박서연이고 컴퓨터를 좋아합니다')).toContain('name');
    expect(cats('이지훈이라고 합니다')).toContain('name');
    // 음성 인식이 띄어 적거나, 첫머리에 바로 이름을 말하는 경우
    expect(cats('저는 김 민수 입니다')).toContain('name');
    expect(cats('안녕하세요 박서연입니다 지원 동기는')).toContain('name');
    expect(cats('전 최유진이에요')).toContain('name');
    expect(cats('지원자 정우성입니다')).toContain('name');
    expect(cats('이름을 말씀드리면 김민수라고 합니다')).toContain('name');
  });

  it('성씨로 시작하는 보통 낱말은 이름으로 보지 않는다', () => {
    expect(cats('저는 지원자입니다')).not.toContain('name');
    expect(cats('저는 성실한 사람입니다')).not.toContain('name');
    expect(cats('저는 한국인이고 개발자입니다')).not.toContain('name');
    expect(cats('저는 공무원입니다')).not.toContain('name');
    expect(cats('저는 신입입니다')).not.toContain('name');
    expect(cats('안녕하세요 반갑습니다')).not.toContain('name');
  });

  it('학교 이름을 잡되 일반 명사는 넘긴다', () => {
    expect(cats('서울대학교 컴퓨터공학과를 졸업했습니다')).toContain('school');
    expect(cats('카이스트에서 인턴을 했습니다')).toContain('school');
    expect(cats('한성고등학교 시절부터')).toContain('school');
    expect(cats('대학교에서 배운 내용을 프로젝트에 적용했습니다')).not.toContain('school');
    expect(cats('저희 대학교 동아리에서')).not.toContain('school');
  });

  it('가족·친인척 언급을 잡되 다른 낱말 속의 글자는 넘긴다', () => {
    expect(cats('아버지께서 항상 말씀하셨습니다')).toContain('family');
    expect(cats('형이 공무원이라서')).toContain('family');
    expect(cats('사촌 형이 이 회사에 다닙니다')).toContain('family');
    expect(cats('이모티콘을 만드는 프로젝트를 했습니다')).not.toContain('family');
    expect(cats('유형별로 나누어 분석했습니다')).not.toContain('family');
    expect(cats('형태소 분석기를 썼습니다')).not.toContain('family');
  });

  it('수상 실적을 잡되 "대상으로" 같은 말은 넘긴다', () => {
    expect(cats('공모전에서 최우수상을 받았습니다')).toContain('award');
    expect(cats('해커톤 1등을 했습니다')).toContain('award');
    expect(cats('교내 대회에서 수상한 경험이')).toContain('award');
    expect(cats('사용자를 대상으로 설문을 진행했습니다')).not.toContain('award');
    expect(cats('상황을 정리했습니다')).not.toContain('award');
  });

  it('수험번호를 잡는다', () => {
    expect(cats('수험번호 1234번 지원자입니다')).toContain('examNo');
    expect(cats('저는 2031번입니다')).toContain('examNo');
    expect(cats('세 번째 프로젝트에서')).not.toContain('examNo');
  });

  it('깨끗한 답변은 아무것도 잡지 않는다', () => {
    expect(cats('재고 관리 프로젝트에서 수요 예측 모델을 만들어 폐기율을 18퍼센트 줄였습니다')).toEqual([]);
    expect(cats('')).toEqual([]);
  });

  it('발췌와 문항 번호를 남기고, 지적 문장의 조사가 맞는다', () => {
    const [v] = detectBlindViolations('저는 김민수입니다 반갑습니다', 2);
    expect(v.questionIndex).toBe(2);
    expect(v.excerpt).toContain('김민수');
    expect(blindWarningLine(v)).toContain('성명은');
    const [s] = detectBlindViolations('연세대를 나왔습니다');
    expect(blindWarningLine(s)).toContain('출신 학교는');
  });
});
