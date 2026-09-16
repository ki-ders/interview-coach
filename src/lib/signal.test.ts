import { describe, expect, it } from 'vitest';
import { ResampledRing, bandScore, detrend, findOscillation, higherBetter, lowerBetter } from './signal';

describe('findOscillation', () => {
  const make = (hz: number, amp: number, n: number, rate: number, noise = 0) =>
    Array.from({ length: n }, (_, i) => {
      const base = amp * Math.sin((2 * Math.PI * hz * i) / rate);
      return base + (noise ? (Math.sin(i * 12.9898) * 43758.5453) % noise : 0);
    });

  it('5Hz 진동의 주파수를 찾아낸다', () => {
    const osc = findOscillation(make(5, 0.01, 105, 30), 30, 2.5, 9);
    expect(osc.freq).toBeGreaterThan(4);
    expect(osc.freq).toBeLessThan(6.5);
    expect(osc.periodicity).toBeGreaterThan(0.7);
  });

  it('3Hz 다리 떨림도 잡는다', () => {
    const osc = findOscillation(make(3, 0.008, 105, 30), 30, 2.5, 9);
    expect(osc.freq).toBeGreaterThan(2.5);
    expect(osc.freq).toBeLessThan(3.8);
    expect(osc.periodicity).toBeGreaterThan(0.7);
  });

  it('가만히 있으면 진폭이 0에 가깝다', () => {
    const osc = findOscillation(Array.from({ length: 105 }, () => 0.5), 30, 2.5, 9);
    expect(osc.amplitude).toBeLessThan(1e-6);
  });

  it('천천히 자세를 바꾸는 것(선형 드리프트)은 떨림으로 보지 않는다', () => {
    const drift = Array.from({ length: 105 }, (_, i) => 0.5 + i * 0.002);
    const osc = findOscillation(drift, 30, 2.5, 9);
    expect(osc.amplitude).toBeLessThan(1e-6);
  });

  it('샘플이 너무 적으면 0을 반환한다', () => {
    expect(findOscillation([1, 2, 3], 30, 2.5, 9).periodicity).toBe(0);
  });
});

describe('detrend', () => {
  it('선형 추세를 제거한다', () => {
    const xs = Array.from({ length: 50 }, (_, i) => 3 + i * 0.7);
    for (const v of detrend(xs)) expect(Math.abs(v)).toBeLessThan(1e-9);
  });
});

describe('bandScore', () => {
  const band = { ideal: [0.6, 0.93] as [number, number], zero: [0.12, 1.5] as [number, number] };

  it('이상 구간이면 만점', () => {
    expect(bandScore(0.75, band)).toBe(100);
    expect(bandScore(0.6, band)).toBe(100);
    expect(bandScore(0.93, band)).toBe(100);
  });

  it('구간 아래로 갈수록 낮아진다', () => {
    expect(bandScore(0.4, band)).toBeLessThan(bandScore(0.55, band));
    expect(bandScore(0.12, band)).toBe(0);
    expect(bandScore(0, band)).toBe(0);
  });

  it('너무 높아도 깎이지만 심하지는 않다', () => {
    const s = bandScore(1, band);
    expect(s).toBeLessThan(100);
    expect(s).toBeGreaterThan(70);
  });
});

describe('lowerBetter / higherBetter', () => {
  it('경계에서 포화한다', () => {
    expect(lowerBetter(0, 3, 14)).toBe(100);
    expect(lowerBetter(20, 3, 14)).toBe(0);
    expect(higherBetter(30, 9, 24)).toBe(100);
    expect(higherBetter(2, 9, 24)).toBe(0);
  });

  it('중간값은 단조롭다', () => {
    expect(lowerBetter(5, 3, 14)).toBeGreaterThan(lowerBetter(9, 3, 14));
  });
});

describe('ResampledRing', () => {
  it('불규칙한 입력을 고정 레이트로 채운다', () => {
    const r = new ResampledRing(30, 1);
    // 100ms 간격으로만 들어와도 30Hz 슬롯이 메워진다
    for (let i = 0; i < 12; i++) r.push(i * 100, i);
    expect(r.length).toBeGreaterThan(25);
  });

  it('오래된 값은 밀려난다', () => {
    const r = new ResampledRing(30, 1);
    for (let i = 0; i < 200; i++) r.push(i * 33.3, i);
    expect(r.length).toBe(30);
    expect(r.full).toBe(true);
  });
});

describe('findOscillation — 느린 움직임을 떨림으로 오인하지 않는다', () => {
  const rate = 30;
  const n = 105;
  const sine = (hz: number, amp: number, phase = 0) =>
    Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / rate + phase));
  const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i]);
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };

  it('0.4Hz 몸 흔들림(자세 이동)은 주기성 0', () => {
    const osc = findOscillation(sine(0.4, 0.01), rate, 2.5, 9);
    expect(osc.periodicity).toBe(0);
    // 고역 통과 후 진폭도 거의 남지 않는다
    expect(osc.amplitude).toBeLessThan(0.001);
  });

  it('호흡(0.25Hz)과 0.8Hz 흔들림도 잡지 않는다', () => {
    expect(findOscillation(sine(0.25, 0.004, 2), rate, 2.5, 9).periodicity).toBe(0);
    expect(findOscillation(sine(0.8, 0.005, 1), rate, 2.5, 9).periodicity).toBe(0);
  });

  it('자세를 한 번 바꾸는 계단 신호는 떨림이 아니다', () => {
    const step = Array.from({ length: n }, (_, i) => (i < 50 ? 0 : 0.02));
    expect(findOscillation(step, rate, 2.5, 9).periodicity).toBe(0);
  });

  it('트래커 잡음(저역 통과된 노이즈)은 낮은 주기성', () => {
    let v = 0;
    const noise = Array.from({ length: n }, () => {
      v = v * 0.7 + rnd() * 0.006;
      return v;
    });
    expect(findOscillation(noise, rate, 2.5, 9).periodicity).toBeLessThan(0.35);
    const white = Array.from({ length: n }, () => rnd() * 0.006);
    expect(findOscillation(white, rate, 2.5, 9).periodicity).toBeLessThan(0.35);
  });

  it('느린 흔들림 위에 얹힌 5Hz 떨림은 여전히 5Hz 로 잡는다', () => {
    const osc = findOscillation(add(sine(5, 0.006), sine(0.4, 0.01)), rate, 2.5, 9);
    expect(osc.freq).toBeCloseTo(5, 0);
    expect(osc.periodicity).toBeGreaterThan(0.8);
    // 진폭은 떨림 성분만 남는다 (0.006 사인의 RMS ≈ 0.0042)
    expect(osc.amplitude).toBeGreaterThan(0.003);
    expect(osc.amplitude).toBeLessThan(0.0055);
  });

  it('잡음 섞인 4Hz 떨림도 잡는다', () => {
    const noisy = sine(4, 0.004).map((v) => v + rnd() * 0.004);
    const osc = findOscillation(noisy, rate, 2.5, 9);
    expect(osc.freq).toBeGreaterThan(3.3);
    expect(osc.freq).toBeLessThan(5);
    expect(osc.periodicity).toBeGreaterThan(0.5);
  });

  it('대역 상한 근처(8Hz)도 봉우리로 인정한다', () => {
    const osc = findOscillation(sine(8, 0.005), rate, 2.5, 9);
    expect(osc.periodicity).toBeGreaterThan(0.5);
    expect(osc.freq).toBeGreaterThan(6.5);
  });
});
