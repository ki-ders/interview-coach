/**
 * TTS 에 맞춰 입을 움직이기 위한 타이밍 생성기.
 * speechSynthesis 는 오디오 파형을 주지 않으므로 글자 수와 boundary 이벤트로 음절 리듬을 추정한다.
 */

interface Pulse {
  t0: number;
  dur: number;
  amp: number;
}

/**
 * 브라우저 TTS 의 실제 속도. Windows 한국어 음성(Heami)을 재보니 문장 사이 쉼까지 포함해
 * 약 4.1 음절/초였다. 단어 경계 이벤트가 오면 단어마다 다시 맞추므로 이 값은 단어 안의 리듬에만 쓰인다.
 */
const SYLLABLES_PER_SEC = 4.6;
const PULSE_MS = 175;
/** 다음 단어 경계가 늦게 올 수 있어, 미리 깔아 두는 뒷부분은 이만큼 늦춰 입이 소리보다 앞서지 않게 한다 */
const LOOKAHEAD_PAD_MS = 220;

const countSyllables = (s: string) => (s.match(/[가-힣0-9]/g) ?? []).length + (s.match(/[A-Za-z]+/g) ?? []).length * 2;

/** 결정적 의사난수 (같은 문장은 같은 리듬) */
function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10000) / 10000;
  };
}

export class LipSync {
  private pulses: Pulse[] = [];
  private active = false;
  private text = '';

  /** 문장 낭독 시작. 음절 수에 맞춰 리듬을 미리 깔아둔다. */
  begin(text: string, now = performance.now()) {
    this.text = text;
    this.active = true;
    this.pulses = [];
    this.scheduleSpan(text, 0, text.length, now + 60);
  }

  /** 브라우저가 단어 경계를 알려줄 때. 그 단어의 음절들을 지금부터 다시 깐다. */
  boundary(charIndex: number, now = performance.now()) {
    if (!this.active) return;
    // 아직 시작하지 않은 펄스만 버린다. 진행 중인 것까지 끊으면 단어마다 입이 탁 닫혔다 열린다
    this.pulses = this.pulses.filter((p) => p.t0 <= now);
    const rest = this.text.slice(charIndex);
    const wordEnd = rest.search(/\s/);
    const word = wordEnd < 0 ? rest : rest.slice(0, wordEnd);
    this.scheduleSpan(this.text, charIndex, charIndex + Math.max(word.length, 1), now);
    // boundary 가 더 안 오면 나머지도 자연스럽게 이어지도록 뒤에 이어 깐다
    const after = charIndex + word.length;
    if (after < this.text.length) {
      const wordMs = (countSyllables(word) / SYLLABLES_PER_SEC) * 1000 + LOOKAHEAD_PAD_MS;
      this.scheduleSpan(this.text, after, this.text.length, now + wordMs);
    }
  }

  end() {
    this.active = false;
    this.pulses = [];
  }

  /** 0~1 턱 벌림 */
  value(now = performance.now()): number {
    if (!this.active) return 0;
    let v = 0;
    for (const p of this.pulses) {
      const u = (now - p.t0) / p.dur;
      if (u < 0 || u > 1) continue;
      // 올라갔다 내려오는 코사인 창
      const env = 0.5 - 0.5 * Math.cos(u * Math.PI * 2);
      if (env * p.amp > v) v = env * p.amp;
    }
    return v;
  }

  get speaking() {
    return this.active;
  }

  private scheduleSpan(text: string, from: number, to: number, at: number) {
    const rnd = seeded(from * 7919 + text.length);
    let t = at;
    for (let i = from; i < to; i++) {
      const ch = text[i];
      if (/[가-힣0-9A-Za-z]/.test(ch)) {
        const jitter = (rnd() - 0.5) * 40;
        this.pulses.push({ t0: t + jitter, dur: PULSE_MS, amp: 0.45 + rnd() * 0.55 });
        t += 1000 / SYLLABLES_PER_SEC;
      } else if (/[.!?…]/.test(ch)) {
        t += 520; // 문장 끝에서는 TTS 가 꽤 길게 쉰다
      } else if (/[,]/.test(ch)) {
        t += 260;
      } else if (/\s/.test(ch)) {
        t += 70;
      }
    }
  }
}

/** 앱 전체에서 하나만 쓴다 — TTS 가 채우고 얼굴이 읽는다 */
export const lipSync = new LipSync();
