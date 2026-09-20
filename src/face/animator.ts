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

/**
 * 상태·성향·립싱크 값을 받아 매 프레임 자연스러운 표정/고개 파라미터를 만든다.
 *
 * 사진(2.5D)은 메시를 조금만 움직여도 "인상이 구겨진" 것처럼 보인다 — 특히 안경테·수염·미간처럼
 * 딱딱하거나 결이 있는 곳. 그래서 표정(찌푸림·미소·눈썹)은 사진에 이미 담긴 것으로 보고 거의 건드리지
 * 않고, 고개 움직임은 CSS 카드 기울임(cardTilt) 으로 대신하며, 입만 부드럽게 움직인다.
 */
export class FaceAnimator {
  private cur: Pose = { ...NEUTRAL, cardDy: 0, cardRot: 0, cardTilt: 0 };
  /** 립싱크 값을 부드럽게 (급격한 펄스가 볼·턱을 튀게 한다) */
  private lipSmooth = 0;
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
      case 'speaking': {
        target.yaw *= 1.4;
        // 음절마다 고개가 까딱이면 부자연스럽다 — 아주 약하게만
        target.pitch = Math.sin(t * 1.3) * 0.02 + lip * 0.006;
        target.brow = 0.05;
        // 입: 빠르게 열리고 천천히 닫힌다. 최대 0.8 까지만 (그 이상은 턱이 늘어나 보인다)
        const k = lip > this.lipSmooth ? 0.55 : 0.3;
        this.lipSmooth += (Math.min(lip, 0.8) - this.lipSmooth) * k;
        target.jaw = this.lipSmooth;
        target.cardDy = -1;
        break;
      }
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
        // 고개 숙임은 메시 회전(구겨짐)보다 카드 기울임으로 표현한다
        target.pitch = 0.14 + Math.sin(t * 6) * 0.006;
        target.yaw = 0.06 + Math.sin(t * 3.1) * 0.008;
        target.roll = 0.02;
        target.blinkL = 0.35;
        target.blinkR = 0.35;
        target.cardDy = 7;
        target.cardRot = 1.2;
        target.cardTilt = 12;
        break;
      default:
        break;
    }

    // 성향에 따른 기본 표정 — 사진에 이미 표정이 담겨 있으므로 아주 살짝만 얹는다
    if (mood === 'stern') {
      target.frown += 0.1;
      target.smile = 0;
      target.brow -= 0.03;
    } else if (mood === 'warm') {
      target.smile += state === 'speaking' ? 0.08 : 0.12;
      target.brow += 0.03;
    } else {
      target.frown += 0.03;
      target.smile += 0.03;
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
    cur.jaw = state === 'speaking' ? target.jaw : lerp(cur.jaw, 0);
    cur.blinkL = target.blinkL;
    cur.blinkR = target.blinkR;
    return cur;
  }
}
