import { describe, expect, it } from 'vitest';
import { LipSync } from './lipsync';

const TEXT = '안녕하세요. 오늘 면접을 맡은 서지우입니다.';

describe('LipSync', () => {
  it('시작하면 음절 리듬으로 입이 열리고, 끝나면 0', () => {
    const l = new LipSync();
    l.begin(TEXT, 0);
    let opened = 0;
    let max = 0;
    for (let t = 0; t < 6000; t += 20) {
      const v = l.value(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
      if (v > 0.15) opened++;
      max = Math.max(max, v);
    }
    expect(max).toBeGreaterThan(0.6);
    // 20 음절이면 4.6음절/초로 약 4.3초 + 문장부호 쉼 → 대략 절반쯤 열려 있다
    expect(opened * 20).toBeGreaterThan(1800);
    l.end();
    expect(l.value(1000)).toBe(0);
    expect(l.speaking).toBe(false);
  });

  it('단어 경계가 오면 진행 중인 펄스는 유지되어 입이 탁 닫히지 않는다', () => {
    const l = new LipSync();
    l.begin(TEXT, 0);
    // 어떤 펄스가 한창 열려 있는 순간을 찾는다
    let peakT = 0;
    let peak = 0;
    for (let t = 0; t < 1500; t += 5) {
      const v = l.value(t);
      if (v > peak) {
        peak = v;
        peakT = t;
      }
    }
    expect(peak).toBeGreaterThan(0.5);
    const before = l.value(peakT);
    l.boundary(7, peakT); // "오늘" 단어 경계가 지금 왔다
    const after = l.value(peakT + 5);
    // 5ms 뒤에 절반 아래로 뚝 떨어지면 안 된다
    expect(after).toBeGreaterThan(before * 0.5);
  });

  it('단어 경계는 그 단어의 음절을 지금부터 다시 깐다', () => {
    const l = new LipSync();
    l.begin(TEXT, 0);
    // 원래 일정보다 훨씬 늦게(느린 음성) "서지우입니다" 경계가 오면 그때부터 입이 움직인다
    const late = 9000;
    expect(l.value(late + 100)).toBe(0);
    l.boundary(TEXT.indexOf('서지우'), late);
    let opened = 0;
    for (let t = late; t < late + 1400; t += 20) if (l.value(t) > 0.15) opened++;
    expect(opened).toBeGreaterThan(20);
  });
});
