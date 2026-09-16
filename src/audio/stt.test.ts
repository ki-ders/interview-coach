import { describe, expect, it } from 'vitest';
import { looksLikeEcho } from './stt';

const QUESTION = '팀에서 갈등이 생겼을 때 어떻게 해결했는지 말씀해 주세요.';

describe('looksLikeEcho', () => {
  it('면접관 질문을 그대로 받아 적은 결과는 에코로 본다', () => {
    expect(looksLikeEcho('팀에서 갈등이 생겼을 때 어떻게 해결했는지 말씀해 주세요', QUESTION)).toBe(true);
  });

  it('인식 오차가 조금 섞여도 에코로 본다', () => {
    expect(looksLikeEcho('팀에서 갈등이 생겼을 때 어떻게 해결했는지 말씀해주세요', QUESTION)).toBe(true);
    expect(looksLikeEcho('팀에서 갈등이 생겼을 때 어떻게 해결했는지', QUESTION)).toBe(true);
  });

  it('지원자의 실제 답변은 통과시킨다', () => {
    expect(
      looksLikeEcho('네, 작년 프로젝트에서 일정 문제로 팀원과 갈등이 있었는데 먼저 이야기를 들었습니다', QUESTION),
    ).toBe(false);
  });

  it('질문 단어를 일부 되풀이하는 답변도 통과시킨다', () => {
    expect(looksLikeEcho('갈등이 생겼을 때 저는 먼저 상대 입장을 듣습니다', QUESTION)).toBe(false);
  });

  it('짧은 조각은 판단하지 않는다', () => {
    expect(looksLikeEcho('네', QUESTION)).toBe(false);
    expect(looksLikeEcho('팀에서', QUESTION)).toBe(false);
  });

  it('비교할 문장이 없으면 통과', () => {
    expect(looksLikeEcho('아무 문장이나 들어옵니다', '')).toBe(false);
  });
});
