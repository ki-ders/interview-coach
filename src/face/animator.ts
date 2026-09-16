import type { AvatarState } from '../interview/useSession';
import type { PersonaMood } from '../types';
import { NEUTRAL, type DeformParams } from './rig';

export interface Pose extends DeformParams {
  /** 타일 전체를 살짝 움직이는 값 (CSS transform 용) */
  cardDy: number;
  cardRot: number;
  /** 타일을 앞으로 기울이는 각도(도) — 고개 숙임 강조 */
  cardTilt: number;
}

/** 상태·성향·립싱크 값을 받아 매 프레임 자연스러운 표정/고개 파라미터를 만든다 */
export class FaceAnimator {
  private cur: Pose = { ...NEUTRAL, cardDy: 0, cardRot: 0, cardTilt: 0 };
  private nextBlinkAt: number;
  private blinkStart = -1;
  private lastNodAt = 0;
  private phase: number;

  constructor(seed = Math.random()) {
    this.phase = seed * 100;
    this.nextBlinkAt = performance.now() + 1500 + seed * 3000;
  }

  update(now: number, state: AvatarState, mood: PersonaMood, lip: number): Pose {
    const t = now / 1000 + this.phase;
    const target: Pose = { ...NEUTRAL, cardDy: 0, cardRot: 0, cardTilt: 0 };

    // 기본 호흡/미세 움직임
    target.yaw = Math.sin(t * 0.37) * 0.035 + Math.sin(t * 0.91 + 1.3) * 0.015;
    target.pitch = Math.sin(t * 0.52) * 0.02;
    target.roll = Math.sin(t * 0.29 + 0.7) * 0.012;

    switch (state) {
      case 'speaking':
        target.yaw *= 1.7;
        target.pitch = Math.sin(t * 1.3) * 0.03 + lip * 0.02;
        target.brow = 0.18;
        target.jaw = lip;
        target.cardDy = -1;
        break;
      case 'listening':
        target.roll += 0.06;
        target.pitch += 0.015;
        // 4~6초마다 작게 끄덕
        if (now - this.lastNodAt > 4200 + (Math.sin(t) + 1) * 1000) this.lastNodAt = now;
        {
          const u = (now - this.lastNodAt) / 700;
          if (u < 1) target.pitch += Math.sin(u * Math.PI) * 0.07;
        }
        break;
      case 'nodding': {
        const u = Math.max(0, Math.sin(t * Math.PI * 2 * 1.05));
        target.pitch = 0.04 + u * 0.1;
        target.cardDy = u * 4;
        target.brow = 0.1;
        break;
      }
      case 'writing':
        target.pitch = 0.3 + Math.sin(t * 6) * 0.008;
        target.yaw = 0.09 + Math.sin(t * 3.1) * 0.01;
        target.roll = 0.03;
        target.blinkL = 0.4;
        target.blinkR = 0.4;
        target.cardDy = 7;
        target.cardRot = 1.2;
        target.cardTilt = 9;
        break;
      default:
        break;
    }

    // 성향에 따른 기본 표정
    if (mood === 'stern') {
      target.frown += 0.55;
      target.smile = 0;
      target.brow -= 0.1;
    } else if (mood === 'warm') {
      target.smile += state === 'speaking' ? 0.3 : 0.45;
      target.brow += 0.08;
    } else {
      target.frown += 0.12;
      target.smile += 0.08;
    }

    // 깜빡임 (감기 60ms, 뜨기 90ms)
    if (this.blinkStart < 0 && now >= this.nextBlinkAt) this.blinkStart = now;
    if (this.blinkStart >= 0) {
      const u = now - this.blinkStart;
      const b = u < 60 ? u / 60 : u < 150 ? 1 - (u - 60) / 90 : -1;
      if (b < 0) {
        this.blinkStart = -1;
        const interval = mood === 'stern' ? 3200 : 2600;
        this.nextBlinkAt = now + interval + Math.random() * 2600;
      } else {
        target.blinkL = Math.max(target.blinkL, b);
        target.blinkR = Math.max(target.blinkR, b);
      }
    }

    // 부드럽게 따라가기 (턱과 깜빡임은 즉시)
    const cur = this.cur;
    const k = 0.12;
    const lerp = (a: number, b: number) => a + (b - a) * k;
    cur.yaw = lerp(cur.yaw, target.yaw);
    cur.pitch = lerp(cur.pitch, target.pitch);
    cur.roll = lerp(cur.roll, target.roll);
    cur.brow = lerp(cur.brow, target.brow);
    cur.frown = lerp(cur.frown, target.frown);
    cur.smile = lerp(cur.smile, target.smile);
    cur.cardDy = lerp(cur.cardDy, target.cardDy);
    cur.cardRot = lerp(cur.cardRot, target.cardRot);
    cur.cardTilt = lerp(cur.cardTilt, target.cardTilt);
    cur.jaw = target.jaw;
    cur.blinkL = target.blinkL;
    cur.blinkR = target.blinkR;
    return cur;
  }
}
