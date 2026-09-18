/** 실시간 신호 처리 헬퍼 */

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 지수 이동 평균 */
export class Ema {
  value: number | null = null;
  private alpha: number;
  constructor(alpha: number) {
    this.alpha = alpha;
  }
  push(v: number): number {
    if (!Number.isFinite(v)) return this.value ?? 0;
    this.value = this.value === null ? v : this.value + this.alpha * (v - this.value);
    return this.value;
  }
  get(): number {
    return this.value ?? 0;
  }
  reset() {
    this.value = null;
  }
}

/** 고정 길이 링 버퍼 */
export class Ring {
  private buf: Float64Array;
  private idx = 0;
  private filled = 0;
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.buf = new Float64Array(size);
  }
  push(v: number) {
    if (!Number.isFinite(v)) return;
    this.buf[this.idx] = v;
    this.idx = (this.idx + 1) % this.size;
    if (this.filled < this.size) this.filled++;
  }
  get length() {
    return this.filled;
  }
  /** 시간순(오래된 것부터) 배열 */
  toArray(): number[] {
    const out: number[] = Array.from({ length: this.filled });
    const start = this.filled === this.size ? this.idx : 0;
    for (let i = 0; i < this.filled; i++) out[i] = this.buf[(start + i) % this.size];
    return out;
  }
  mean(): number {
    if (!this.filled) return 0;
    let s = 0;
    for (let i = 0; i < this.filled; i++) s += this.buf[i];
    return s / this.filled;
  }
  std(): number {
    if (this.filled < 2) return 0;
    const m = this.mean();
    let s = 0;
    for (let i = 0; i < this.filled; i++) {
      const d = this.buf[i] - m;
      s += d * d;
    }
    return Math.sqrt(s / (this.filled - 1));
  }
  clear() {
    this.idx = 0;
    this.filled = 0;
  }
}

/** 1차 추세를 제거한다 (드리프트가 있는 신호에서 진동만 남김) */
export function detrend(xs: number[]): number[] {
  const n = xs.length;
  if (n < 3) return xs.map(() => 0);
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += xs[i];
    sxy += i * xs[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return xs.map((v, i) => v - (slope * i + intercept));
}

export interface Oscillation {
  /** 지배 주파수 (Hz) */
  freq: number;
  /** 0~1, 주기성의 강도 (자기상관 봉우리 높이). 봉우리가 없으면 0 */
  periodicity: number;
  /** 진폭 RMS (입력과 같은 단위). 느린 움직임을 제거한 뒤의 값 */
  amplitude: number;
}

/**
 * 관심 대역보다 느린 성분(자세 이동·호흡·몸 흔들림)을 제거한다.
 * 창 길이가 대역 하한 주기인 이동평균을 빼는 고역 통과.
 */
export function highpass(xs: number[], window: number): number[] {
  const n = xs.length;
  const w = Math.max(1, Math.min(window, n));
  const half = Math.floor(w / 2);
  const out: number[] = Array.from({ length: n });
  for (let i = 0; i < n; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    let s = 0;
    for (let j = lo; j <= hi; j++) s += xs[j];
    out[i] = xs[i] - s / (hi - lo + 1);
  }
  return out;
}

/**
 * 자기상관으로 주기적 떨림을 찾는다. 다리 떨기는 대략 3~9Hz 범위에서 나타난다.
 *
 * 매끄러운 신호는 어떤 것이든 짧은 lag 에서 자기상관이 1에 가깝기 때문에,
 * 단순히 최댓값을 고르면 천천히 몸을 움직이는 것도 "10Hz 떨림"으로 잡힌다.
 * 그래서 (1) 대역 아래의 느린 성분을 먼저 제거하고,
 * (2) 자기상관이 한 번 꺼진(골) 뒤에 다시 솟는 진짜 봉우리만 인정한다.
 */
export function findOscillation(
  samples: number[],
  sampleRate: number,
  minHz: number,
  maxHz: number,
): Oscillation {
  const n = samples.length;
  const empty: Oscillation = { freq: 0, periodicity: 0, amplitude: 0 };
  if (n < 16 || sampleRate <= 0) return empty;

  const x = highpass(detrend(samples), Math.round(sampleRate / minHz));
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  const amplitude = Math.sqrt(energy / n);
  if (energy < 1e-12) return empty;

  const minLag = Math.max(2, Math.floor(sampleRate / maxHz));
  const maxLag = Math.min(n - 4, Math.ceil(sampleRate / minHz));
  if (maxLag <= minLag) return empty;

  // lag 1 부터 정규화 자기상관을 구한다 (겹치는 구간 길이로 나눠 짧은 lag 편향을 줄임)
  const acf: number[] = [1];
  for (let lag = 1; lag <= maxLag + 1 && lag < n - 1; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    acf.push(s / ((n - lag) * (energy / n)));
  }

  // 먼저 골(자기상관이 충분히 떨어지는 지점)이 있어야 진동이다
  const DIP = 0.25;
  let dip = -1;
  for (let lag = 1; lag <= maxLag && lag < acf.length; lag++) {
    if (acf[lag] < DIP) {
      dip = lag;
      break;
    }
  }
  if (dip < 0) return { freq: 0, periodicity: 0, amplitude };

  // 골 뒤의 국소 최대 봉우리. 순수한 진동은 주기의 배수마다 비슷한 높이의 봉우리가
  // 생기므로, 첫 봉우리를 기본으로 하고 눈에 띄게 더 높은 뒤쪽 봉우리만 대신 택한다.
  let bestLag = 0;
  let bestVal = 0;
  for (let lag = Math.max(minLag, dip + 1); lag <= maxLag && lag < acf.length; lag++) {
    const v = acf[lag];
    const prev = acf[lag - 1];
    const next = lag + 1 < acf.length ? acf[lag + 1] : -Infinity;
    if (v >= prev && v >= next && v > bestVal + 0.12) {
      bestVal = v;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return { freq: 0, periodicity: 0, amplitude };
  return { freq: sampleRate / bestLag, periodicity: clamp(bestVal, 0, 1), amplitude };
}

export interface Band {
  /** 이 구간 안이면 만점 */
  ideal: [number, number];
  /** 이 구간 밖이면 0점 */
  zero: [number, number];
}

/**
 * "적당한 게 최고"인 지표용 점수. 너무 적어도, 너무 많아도 깎인다.
 * 예: 시선 고정 비율은 100%보다 75%가 자연스럽다.
 */
export function bandScore(value: number, band: Band): number {
  const [lo, hi] = band.ideal;
  const [zlo, zhi] = band.zero;
  if (!Number.isFinite(value)) return 60;
  if (value >= lo && value <= hi) return 100;
  if (value < lo) {
    if (value <= zlo) return 0;
    return clamp(((value - zlo) / (lo - zlo)) * 100, 0, 100);
  }
  if (value >= zhi) return 0;
  return clamp(((zhi - value) / (zhi - hi)) * 100, 0, 100);
}

/** 값이 작을수록 좋은 지표 (good 이하 100점, bad 이상 0점) */
export function lowerBetter(value: number, good: number, bad: number): number {
  if (!Number.isFinite(value)) return 60;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return ((bad - value) / (bad - good)) * 100;
}

/** 값이 클수록 좋은 지표 */
export function higherBetter(value: number, bad: number, good: number): number {
  if (!Number.isFinite(value)) return 60;
  if (value >= good) return 100;
  if (value <= bad) return 0;
  return ((value - bad) / (good - bad)) * 100;
}

/** 가중 평균 */
export function weighted(parts: [number, number][]): number {
  let sum = 0;
  let w = 0;
  for (const [score, weight] of parts) {
    if (!Number.isFinite(score)) continue;
    sum += score * weight;
    w += weight;
  }
  return w === 0 ? 0 : sum / w;
}

export function dbFromRms(rms: number): number {
  return 20 * Math.log10(Math.max(rms, 1e-7));
}

/**
 * 불규칙하게 들어오는 샘플을 고정 샘플레이트로 리샘플링해 보관한다.
 * 자기상관 주파수 추정은 등간격 샘플을 전제로 하므로 필요하다.
 */
export class ResampledRing {
  private ring: Ring;
  private lastSlot = -1;
  private lastValue = 0;
  readonly interval: number;
  readonly sampleRate: number;

  constructor(sampleRate: number, seconds: number) {
    this.sampleRate = sampleRate;
    this.interval = 1000 / sampleRate;
    this.ring = new Ring(Math.max(16, Math.round(sampleRate * seconds)));
  }

  /** t: ms 단위 타임스탬프 */
  push(t: number, value: number) {
    if (!Number.isFinite(value)) return;
    const slot = Math.floor(t / this.interval);
    if (this.lastSlot < 0) {
      this.lastSlot = slot;
      this.lastValue = value;
      this.ring.push(value);
      return;
    }
    if (slot <= this.lastSlot) {
      this.lastValue = value;
      return;
    }
    // 빈 슬롯은 직전 값으로 채운다 (최대 sampleRate개까지만)
    const gap = Math.min(slot - this.lastSlot, this.sampleRate);
    for (let i = 1; i < gap; i++) this.ring.push(this.lastValue);
    this.ring.push(value);
    this.lastSlot = slot;
    this.lastValue = value;
  }

  values(): number[] {
    return this.ring.toArray();
  }

  get length() {
    return this.ring.length;
  }

  get full() {
    return this.ring.length >= this.ring.size;
  }

  clear() {
    this.ring.clear();
    this.lastSlot = -1;
  }
}

/** 0~100 점수를 등급 문자열로 */
/** S / A / B / C / D / F 여섯 단계 */
export function gradeOf(score: number): string {
  if (score >= 90) return 'S';
  if (score >= 80) return 'A';
  if (score >= 70) return 'B';
  if (score >= 60) return 'C';
  if (score >= 50) return 'D';
  return 'F';
}
