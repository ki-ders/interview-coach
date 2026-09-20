import { describe, expect, it } from 'vitest';
import { CANONICAL_LANDMARKS } from './__fixtures__/canonical';
import { LM } from './landmarks';
import { NEUTRAL, buildRig, deform } from './rig';
import { FACE_TRIANGLES, MOUTH_TRIANGLES } from './triangulation';

const W = 800;
const H = 1000;
const lm = CANONICAL_LANDMARKS.map(([x, y, z]) => ({ x, y, z }));
const rig = buildRig(lm, W, H);
const run = (over: Partial<typeof NEUTRAL>) => deform(rig, { ...NEUTRAL, ...over }, new Float32Array(468 * 2));

const y = (out: Float32Array, i: number) => out[i * 2 + 1];
const x = (out: Float32Array, i: number) => out[i * 2];

describe('buildRig', () => {
  it('얼굴 크기와 중심을 잡는다', () => {
    expect(rig.faceW).toBeGreaterThan(W * 0.3);
    expect(rig.faceH).toBeGreaterThan(H * 0.3);
    expect(rig.center.x).toBeCloseTo(W / 2, -1);
  });

  it('회전 가중치는 중심이 1, 타원 가장자리가 0', () => {
    expect(rig.ovalWeight[LM.noseTip]).toBeGreaterThan(0.95);
    for (const i of LM.faceOval) expect(rig.ovalWeight[i]).toBeLessThan(0.05);
  });

  it('턱 가중치: 아랫입술·턱은 1, 윗입술·눈썹은 0', () => {
    const corners = new Set<number>(LM.mouthCorners);
    for (const i of LM.lowerLipInner) if (!corners.has(i)) expect(rig.jawWeight[i]).toBe(1);
    for (const i of LM.mouthCorners) expect(rig.jawWeight[i]).toBeCloseTo(0.35, 5);
    // 턱 끝은 아랫입술보다 덜 내려간다 (턱이 늘어나 보이지 않게)
    expect(rig.jawWeight[LM.chin]).toBeGreaterThan(0.55);
    expect(rig.jawWeight[LM.chin]).toBeLessThan(0.85);
    for (const i of LM.upperLipOuter) if (!corners.has(i)) expect(rig.jawWeight[i]).toBe(0);
    for (const i of LM.rightBrow) expect(rig.jawWeight[i]).toBe(0);
    expect(rig.jawWeight[LM.noseTip]).toBe(0);
  });

  it('삼각형 인덱스는 모두 정점 범위 안', () => {
    for (const idx of FACE_TRIANGLES) expect(idx).toBeLessThan(468);
    for (const idx of MOUTH_TRIANGLES) expect(idx).toBeLessThan(468);
    expect(FACE_TRIANGLES.length % 3).toBe(0);
    expect(MOUTH_TRIANGLES.length).toBe(18 * 3);
  });
});

describe('deform', () => {
  it('중립이면 원본 좌표 그대로', () => {
    const out = run({});
    for (let i = 0; i < 468; i++) {
      expect(x(out, i)).toBeCloseTo(rig.pts[i * 3], 4);
      expect(y(out, i)).toBeCloseTo(rig.pts[i * 3 + 1], 4);
    }
  });

  it('턱을 벌리면 아랫입술과 턱이 내려가고 윗입술은 그대로', () => {
    const base = run({});
    const open = run({ jaw: 1 });
    const dropLower = y(open, LM.lowerLipCenter) - y(base, LM.lowerLipCenter);
    const dropChin = y(open, LM.chin) - y(base, LM.chin);
    expect(dropLower).toBeGreaterThan(rig.faceH * 0.035);
    expect(dropChin).toBeGreaterThan(rig.faceH * 0.02);
    expect(dropChin).toBeLessThan(dropLower);
    expect(y(open, LM.upperLipCenter)).toBeCloseTo(y(base, LM.upperLipCenter), 3);
    expect(y(open, LM.noseTip)).toBeCloseTo(y(base, LM.noseTip), 3);
  });

  it('입을 벌리면 입 안쪽 삼각형에 면적이 생긴다', () => {
    const area = (out: Float32Array) => {
      let a = 0;
      for (let t = 0; t < MOUTH_TRIANGLES.length; t += 3) {
        const [i, j, k] = [MOUTH_TRIANGLES[t], MOUTH_TRIANGLES[t + 1], MOUTH_TRIANGLES[t + 2]];
        a += Math.abs(
          (x(out, j) - x(out, i)) * (y(out, k) - y(out, i)) - (x(out, k) - x(out, i)) * (y(out, j) - y(out, i)),
        ) / 2;
      }
      return a;
    };
    const closed = area(run({}));
    const open = area(run({ jaw: 1 }));
    expect(open).toBeGreaterThan(closed * 2.2);
  });

  it('깜빡이면 윗눈꺼풀이 아랫눈꺼풀에 거의 닿는다', () => {
    const base = run({});
    const blink = run({ blinkL: 1, blinkR: 1 });
    const gapBefore = y(base, 145) - y(base, 159); // 오른눈 중앙 세로 틈
    const gapAfter = y(blink, 145) - y(blink, 159);
    expect(gapBefore).toBeGreaterThan(rig.faceH * 0.02);
    expect(gapAfter).toBeLessThan(gapBefore * 0.15);
    // 한쪽만 감으면 다른 쪽은 그대로
    const wink = run({ blinkR: 1 });
    expect(y(wink, 386) - y(wink, 374)).toBeCloseTo(y(base, 386) - y(base, 374), 3);
  });

  it('고개를 돌려도 얼굴 가장자리는 움직이지 않는다 (이음새 방지)', () => {
    const base = run({});
    const turned = run({ yaw: 0.25, pitch: 0.15 });
    for (const i of LM.faceOval) {
      expect(Math.abs(x(turned, i) - x(base, i))).toBeLessThan(1.5);
      expect(Math.abs(y(turned, i) - y(base, i))).toBeLessThan(1.5);
    }
    // 코끝은 회전 방향으로 움직인다
    expect(Math.abs(x(turned, LM.noseTip) - x(base, LM.noseTip))).toBeGreaterThan(rig.faceW * 0.02);
  });

  it('pitch 양수(끄덕임)면 코끝이 아래로', () => {
    const base = run({});
    const nod = run({ pitch: 0.2 });
    expect(y(nod, LM.noseTip)).toBeGreaterThan(y(base, LM.noseTip) + 2);
  });

  it('찌푸리면 미간 쪽 눈썹이 내려온다', () => {
    const base = run({});
    const frown = run({ frown: 1 });
    expect(y(frown, 107)).toBeGreaterThan(y(base, 107));
    expect(y(frown, 336)).toBeGreaterThan(y(base, 336));
    const raised = run({ brow: 1 });
    expect(y(raised, 107)).toBeLessThan(y(base, 107));
  });

  it('미소 지으면 입꼬리가 올라간다', () => {
    const base = run({});
    const smile = run({ smile: 1 });
    expect(y(smile, LM.mouthLeft)).toBeLessThan(y(base, LM.mouthLeft));
    expect(y(smile, LM.mouthRight)).toBeLessThan(y(base, LM.mouthRight));
  });
});
