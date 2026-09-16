/**
 * Web Speech API 음성 인식 래퍼.
 * Chrome / Edge 계열에서만 동작하며, 브라우저가 인식 서버를 사용한다는 점을 UI에서 안내한다.
 */

interface SttAlternative {
  transcript: string;
  confidence: number;
}
interface SttResult {
  isFinal: boolean;
  length: number;
  [index: number]: SttAlternative;
}
interface SttResultList {
  length: number;
  [index: number]: SttResult;
}
interface SttEvent extends Event {
  resultIndex: number;
  results: SttResultList;
}
interface SttErrorEvent extends Event {
  error: string;
}
interface SttInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SttEvent) => void) | null;
  onerror: ((e: SttErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SttCtor = new () => SttInstance;

function getCtor(): SttCtor | null {
  const w = window as unknown as { SpeechRecognition?: SttCtor; webkitSpeechRecognition?: SttCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** 한글/영숫자만 남긴 문자 바이그램 집합 */
function bigrams(text: string): Set<string> {
  const s = text.replace(/[^가-힣A-Za-z0-9]/g, '');
  const out = new Set<string>();
  for (let i = 0; i + 1 < s.length; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * 인식된 문장이 면접관이 방금 말한 문장과 얼마나 겹치는지.
 * 스피커로 나간 TTS 를 마이크가 되받아 적는 경우를 걸러내기 위한 것으로,
 * 짧은 문장은 우연히 겹칠 수 있어 6글자 이상일 때만 판단한다.
 */
export function looksLikeEcho(recognized: string, spoken: string): boolean {
  if (!spoken || recognized.replace(/\s/g, '').length < 6) return false;
  const a = bigrams(recognized);
  const b = bigrams(spoken);
  if (!a.size || !b.size) return false;
  let hit = 0;
  for (const g of a) if (b.has(g)) hit++;
  return hit / a.size >= 0.6;
}

export interface SttSnapshot {
  final: string;
  interim: string;
  /** final + interim */
  full: string;
}

export class Stt {
  private rec: SttInstance | null = null;
  private wantRunning = false;
  private running = false;
  private restartTimer = 0;

  private finalText = '';
  private interimText = '';
  /** true 인 동안 들어온 결과는 버린다 (면접관 TTS 음성 차단) */
  gated = false;
  /** 직전에 면접관이 말한 문장. 이와 비슷한 인식 결과는 스피커 에코로 보고 버린다 */
  ignoreText = '';

  onUpdate: ((snap: SttSnapshot) => void) | null = null;
  onFatal: ((reason: string) => void) | null = null;

  readonly supported = getCtor() !== null;

  private emit() {
    this.onUpdate?.({
      final: this.finalText.trim(),
      interim: this.interimText.trim(),
      full: `${this.finalText} ${this.interimText}`.trim(),
    });
  }

  private create(): SttInstance | null {
    const Ctor = getCtor();
    if (!Ctor) return null;
    const rec = new Ctor();
    rec.lang = 'ko-KR';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.running = true;
    };

    rec.onresult = (e) => {
      if (this.gated) return;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (!res) continue;
        const text = (res[0]?.transcript ?? '').trim();
        if (!text) continue;
        if (res.isFinal) {
          if (looksLikeEcho(text, this.ignoreText)) continue;
          this.finalText += (this.finalText ? ' ' : '') + text;
        } else {
          interim += text;
        }
      }
      this.interimText = interim;
      this.emit();
    };

    rec.onerror = (e) => {
      // no-speech / aborted 는 정상 흐름에서도 자주 발생한다
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.wantRunning = false;
        this.onFatal?.('마이크 권한이 거부되어 음성 인식을 쓸 수 없습니다.');
      } else if (e.error === 'network') {
        this.onFatal?.('음성 인식 서버에 연결하지 못했습니다. 네트워크를 확인해 주세요.');
      }
    };

    rec.onend = () => {
      this.running = false;
      if (this.wantRunning) {
        // 브라우저가 침묵 후 자동 종료하므로 다시 띄운다
        window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => {
          if (!this.wantRunning || this.running) return;
          try {
            this.rec?.start();
          } catch {
            /* 이미 시작된 경우 무시 */
          }
        }, 220);
      }
    };

    return rec;
  }

  /** 인식을 켠다. 기존 누적 텍스트는 유지된다. */
  start() {
    if (!this.supported) return;
    if (!this.rec) this.rec = this.create();
    this.wantRunning = true;
    if (this.running) return;
    try {
      this.rec?.start();
    } catch {
      /* 이미 실행 중 */
    }
  }

  stop() {
    this.wantRunning = false;
    window.clearTimeout(this.restartTimer);
    try {
      this.rec?.stop();
    } catch {
      /* noop */
    }
  }

  dispose() {
    this.wantRunning = false;
    window.clearTimeout(this.restartTimer);
    try {
      this.rec?.abort();
    } catch {
      /* noop */
    }
    this.rec = null;
  }

  /** 새 답변 턴 시작: 누적 텍스트 초기화 */
  beginTurn() {
    this.finalText = '';
    this.interimText = '';
    this.emit();
  }

  /** 현재 턴의 텍스트를 확정해 반환 */
  endTurn(): string {
    const text = `${this.finalText} ${this.interimText}`.trim();
    this.finalText = '';
    this.interimText = '';
    return text;
  }

  snapshot(): SttSnapshot {
    return {
      final: this.finalText.trim(),
      interim: this.interimText.trim(),
      full: `${this.finalText} ${this.interimText}`.trim(),
    };
  }
}

/** 웹(Chrome)에서는 Web Speech API, 안드로이드 앱에서는 네이티브 플러그인을 쓴다 */
export type SttEngine = Pick<
  Stt,
  | 'gated'
  | 'ignoreText'
  | 'onUpdate'
  | 'onFatal'
  | 'supported'
  | 'start'
  | 'stop'
  | 'dispose'
  | 'beginTurn'
  | 'endTurn'
  | 'snapshot'
>;
