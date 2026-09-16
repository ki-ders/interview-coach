import { Ema, Ring, clamp, dbFromRms } from '../lib/signal';

export interface MicFrame {
  /** 순간 레벨 (dBFS) */
  db: number;
  /** 부드럽게 처리한 레벨 */
  smoothDb: number;
  /** 배경 소음 대비 dB */
  snr: number;
  speaking: boolean;
  /** 0~1, UI 미터용 */
  level: number;
}

const SILENCE_FLOOR = -75;

/**
 * 마이크 레벨을 읽어 발화 여부와 크기를 판정한다.
 * 마이크 게인이 기기마다 다르므로 절대 dB 대신 배경 소음 대비 SNR 을 주로 쓴다.
 */
export class MicAnalyzer {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private buf: Float32Array<ArrayBuffer> | null = null;

  private smooth = new Ema(0.25);
  private noiseSamples = new Ring(240);
  /** 보정된 배경 소음 레벨 */
  noiseFloor = -55;
  private calibrating = false;

  /** 발화 판정 히스테리시스 */
  private speakingState = false;
  private aboveSince = 0;
  private belowSince = 0;

  /** 마지막 발화 종료 시각 (ms, performance.now 기준) */
  lastVoiceAt = 0;

  /**
   * iOS Safari 는 사용자 탭 안에서 만든 AudioContext 만 소리를 받는다.
   * 카메라 권한을 기다리는 동안 그 조건이 풀리므로, 버튼을 누른 직후(await 전에) 먼저 만들어 둔다.
   */
  prime() {
    if (this.ctx) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  async attach(stream: MediaStream) {
    this.prime();
    if (!this.ctx) throw new Error('이 브라우저는 Web Audio 를 지원하지 않습니다.');
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => undefined);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.1;
    this.source = this.ctx.createMediaStreamSource(stream);
    this.source.connect(this.analyser);
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4));
  }

  detach() {
    this.source?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
    this.analyser = null;
    this.source = null;
  }

  get ready() {
    return this.analyser !== null;
  }

  startNoiseCalibration() {
    this.noiseSamples.clear();
    this.calibrating = true;
  }

  finishNoiseCalibration() {
    this.calibrating = false;
    if (this.noiseSamples.length > 20) {
      const vals = this.noiseSamples.toArray().sort((a, b) => a - b);
      // 상위 25%는 기침·잡음일 수 있으므로 버린다
      const cut = vals.slice(0, Math.max(5, Math.floor(vals.length * 0.75)));
      const mean = cut.reduce((s, v) => s + v, 0) / cut.length;
      this.noiseFloor = clamp(mean, -70, -30);
    }
  }

  read(now: number): MicFrame {
    if (!this.analyser || !this.buf) {
      return { db: SILENCE_FLOOR, smoothDb: SILENCE_FLOOR, snr: 0, speaking: false, level: 0 };
    }
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (let i = 0; i < this.buf.length; i++) sum += this.buf[i] * this.buf[i];
    const rms = Math.sqrt(sum / this.buf.length);
    const db = Math.max(dbFromRms(rms), SILENCE_FLOOR);
    const smoothDb = this.smooth.push(db);

    if (this.calibrating) this.noiseSamples.push(db);

    const snr = smoothDb - this.noiseFloor;
    // 켜질 때는 문턱을 높게, 꺼질 때는 낮게 (채터링 방지)
    const onThreshold = 7;
    const offThreshold = 4;

    if (!this.speakingState) {
      if (snr > onThreshold) {
        if (!this.aboveSince) this.aboveSince = now;
        if (now - this.aboveSince > 90) {
          this.speakingState = true;
          this.belowSince = 0;
        }
      } else {
        this.aboveSince = 0;
      }
    } else {
      if (snr < offThreshold) {
        if (!this.belowSince) this.belowSince = now;
        if (now - this.belowSince > 260) {
          this.speakingState = false;
          this.aboveSince = 0;
        }
      } else {
        this.belowSince = 0;
      }
    }

    if (this.speakingState) this.lastVoiceAt = now;

    return {
      db,
      smoothDb,
      snr,
      speaking: this.speakingState,
      level: clamp((snr + 5) / 40, 0, 1),
    };
  }
}
