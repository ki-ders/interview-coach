/**
 * 시뮬레이션 세계: "가상의 지원자"가 지금 무엇을 하고 있는지 한 곳에서 관리한다.
 * 가짜 카메라(랜드마크), 가짜 마이크(오디오), 가짜 음성 인식기가 모두 여기서 상태를 읽는다.
 */
import { FRONTAL, SEATED, makeRng, type FaceParams, type PoseParams } from './synth';

export type GazeStyle = 'camera' | 'away' | 'down' | 'mixed' | 'wander';
export type VoiceStyle = 'normal' | 'quiet' | 'loud';

export interface Behavior {
  gaze: GazeStyle;
  legShake: boolean;
  /** 카메라가 멀어 다리까지 보이는 구도인지 */
  legsVisible: boolean;
  fidget: boolean;
  selfTouch: boolean;
  voice: VoiceStyle;
  tiltDeg: number;
  neckRatio: number;
  /** 느린 몸 흔들림 진폭 (정규화 좌표) */
  swayAmp: number;
  /** 얼굴이 화면에서 빠진 상태 */
  faceHidden?: boolean;
}

export const CALM: Behavior = {
  gaze: 'camera',
  legShake: false,
  legsVisible: true,
  fidget: false,
  selfTouch: false,
  voice: 'normal',
  tiltDeg: 1,
  neckRatio: 1.0,
  swayAmp: 0.004,
};

export type ForcedPose = 'free' | 'center' | 'side' | 'down';

/** 사인파 진폭 → dBFS. 가짜 마이크가 이 크기로 소리를 낸다 */
export const VOICE_DBFS: Record<VoiceStyle, number> = { normal: -25, quiet: -46, loud: -15 };
export const NOISE_DBFS = -55;
/** 면접관 TTS 가 스피커로 나와 마이크에 들어오는 것을 흉내낸 크기 */
export const ECHO_DBFS = -36;

const TWO_PI = Math.PI * 2;

export class SimWorld {
  behavior: Behavior = CALM;
  /** 보정 단계에서는 시나리오와 무관하게 시키는 곳을 본다 */
  forcedPose: ForcedPose = 'free';
  /** 지원자가 소리를 내고 있는가 (가짜 인식기가 켜고 끈다) */
  speaking = false;
  /** 면접관 TTS 가 재생 중인가 (스피커 에코 흉내) */
  interviewerSpeaking = false;
  /** 면접관이 마지막으로 말한 문장 (에코 인식 결과 흉내에 사용) */
  lastLine = '';
  faceVisible = true;
  /** 사람이 읽을 수 있는 현재 상황 */
  note = '';

  private rng = makeRng(2024);
  private blinkAt = 0;
  private blinkUntil = 0;
  private boutUntil = 0;
  private nextBout = 0;
  private t0 = -1;

  /** 세션 시작 시각 기준 초 */
  private sec(nowMs: number) {
    if (this.t0 < 0) this.t0 = nowMs;
    return (nowMs - this.t0) / 1000;
  }

  private blinking(t: number): number {
    if (t >= this.blinkAt && t < this.blinkUntil) return 1;
    if (t >= this.blinkUntil) {
      this.blinkAt = t + 2.5 + this.rng() * 3.5;
      this.blinkUntil = this.blinkAt + 0.15;
    }
    return 0;
  }

  /** 'mixed' 시선: 4~8초마다 2~3초씩 아래를 본다 (약 35~40%) */
  private inDownBout(t: number): boolean {
    if (t < this.boutUntil) return true;
    if (t >= this.nextBout) {
      this.boutUntil = t + 2 + this.rng() * 1;
      this.nextBout = this.boutUntil + 3 + this.rng() * 3;
      return true;
    }
    return false;
  }

  faceAt(nowMs: number): FaceParams {
    const t = this.sec(nowMs);
    const b = this.behavior;
    const far = b.legsVisible;
    // 숨쉬기와 아주 작은 머리 흔들림
    let yaw = 0.03 * Math.sin(TWO_PI * 0.13 * t + 1);
    let pitch = 0.02 * Math.sin(TWO_PI * 0.09 * t);
    let eyeX = 0;
    let eyeY = 0;

    if (this.forcedPose === 'side') yaw += 0.35;
    else if (this.forcedPose === 'down') pitch += 0.4;
    else if (this.forcedPose === 'free') {
      switch (b.gaze) {
        case 'away':
          yaw += 0.42;
          eyeX = 0.5;
          break;
        case 'down':
          pitch += 0.42;
          eyeY = -0.5;
          break;
        case 'mixed':
          if (this.inDownBout(t)) {
            pitch += 0.42;
            eyeY = -0.5;
          }
          break;
        case 'wander':
          yaw += 0.3 * Math.sin(TWO_PI * 0.2 * t);
          eyeX = 0.4 * Math.sin(TWO_PI * 0.2 * t + 0.4);
          break;
        default:
          break;
      }
    }

    return {
      ...FRONTAL,
      yaw,
      pitch,
      roll: (b.tiltDeg * Math.PI) / 180 * 0.5,
      eyeX,
      eyeY,
      blink: this.blinking(t),
      cx: 0.5 + b.swayAmp * Math.sin(TWO_PI * 0.3 * t),
      cy: (far ? 0.27 : 0.42) + 0.003 * Math.sin(TWO_PI * 0.25 * t),
      scale: far ? 0.36 : 0.5,
      noise: 0.0015,
    };
  }

  poseAt(nowMs: number): PoseParams {
    const t = this.sec(nowMs);
    const b = this.behavior;
    const far = b.legsVisible;
    const sway = b.swayAmp * Math.sin(TWO_PI * 0.3 * t);
    const shoulderW = far ? 0.2 : 0.28;
    const shoulderY = far ? 0.42 : 0.62;

    // 말할 때는 손이 자연스럽게 조금 움직인다
    const gesture = this.speaking && !b.fidget && !b.selfTouch ? 0.15 * Math.sin(TWO_PI * 0.5 * t) : 0;
    const fidget = b.fidget ? 0.08 * Math.sin(TWO_PI * 3 * t) : 0;
    const wristL = b.selfTouch ? { x: 0.12, y: -0.9 } : { x: 0.45 + gesture * 0.4, y: 1.1 + gesture + fidget };
    const wristR = { x: -0.45 - gesture * 0.3, y: 1.1 + gesture * 0.6 };

    const kneeBase = far ? 0.92 : 1.25;
    const shake = b.legShake ? 0.004 * Math.sin(TWO_PI * 5.2 * t) : 0;

    return {
      ...SEATED,
      cx: 0.5 + sway,
      shoulderY: shoulderY + 0.002 * Math.sin(TWO_PI * 0.25 * t),
      shoulderW,
      tiltDeg: b.tiltDeg,
      neckRatio: b.neckRatio,
      hipY: far ? 0.72 + shake * 0.15 : 0.98 + shake * 0.15,
      hipVisibility: far ? 0.9 : 0.7,
      kneeY: kneeBase + shake,
      kneeVisibility: far ? 0.9 : 0.1,
      wristL,
      wristR,
      wristVisibility: 0.85,
      noise: 0.0015,
    };
  }

  /**
   * 세션 상태에 맞춰 지원자의 행동을 바꾼다.
   * 보정 중에는 시키는 곳을 보고, 면접 중에는 질문 인덱스에 해당하는 대본 행동을 한다.
   */
  follow(phase: string, calibStep: string, questionIndex: number, behaviors: Behavior[]) {
    if (phase === 'calibrating') {
      this.behavior = CALM;
      this.speaking = false;
      this.forcedPose = calibStep === 'center' || calibStep === 'side' || calibStep === 'down' ? calibStep : 'free';
      this.faceVisible = true;
      return;
    }
    this.forcedPose = 'free';
    if (phase === 'running') {
      const b = behaviors[Math.min(questionIndex, behaviors.length - 1)] ?? CALM;
      this.behavior = b;
      this.faceVisible = !b.faceHidden;
    } else {
      this.behavior = CALM;
      this.faceVisible = true;
    }
  }

  /** 지금 마이크에 들어와야 하는 소리 크기 (dBFS). 조용하면 -Infinity */
  voiceDb(): number {
    if (this.speaking) return VOICE_DBFS[this.behavior.voice];
    if (this.interviewerSpeaking) return ECHO_DBFS;
    return -Infinity;
  }

  describe(): string {
    if (this.forcedPose !== 'free') {
      return { center: '정면 응시', side: '왼쪽 끝 응시', down: '아래 응시' }[this.forcedPose];
    }
    const b = this.behavior;
    const parts: string[] = [];
    parts.push(
      { camera: '카메라 응시', away: '옆을 봄', down: '아래를 봄', mixed: '가끔 아래를 봄', wander: '시선 방황' }[b.gaze],
    );
    if (b.legShake) parts.push('다리 떨기');
    if (b.fidget) parts.push('손 만지작');
    if (b.selfTouch) parts.push('얼굴 만지기');
    if (b.voice !== 'normal') parts.push(b.voice === 'quiet' ? '작은 목소리' : '큰 목소리');
    if (b.tiltDeg > 5) parts.push('어깨 기울임');
    if (b.neckRatio < 0.75) parts.push('움츠림');
    parts.push(b.legsVisible ? '(다리 보임)' : '(상체만)');
    return parts.join(' · ');
  }
}
