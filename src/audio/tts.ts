import type { Interviewer } from '../types';
import { lipSync } from '../face/lipsync';

let voicesCache: SpeechSynthesisVoice[] = [];

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve([]);
    const now = speechSynthesis.getVoices();
    if (now.length) {
      voicesCache = now;
      return resolve(now);
    }
    const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1500);
    speechSynthesis.addEventListener(
      'voiceschanged',
      () => {
        clearTimeout(timer);
        voicesCache = speechSynthesis.getVoices();
        resolve(voicesCache);
      },
      { once: true },
    );
  });
}

const FEMALE_HINTS = ['heami', 'sunhi', 'yuna', 'female', '여성'];
const MALE_HINTS = ['injoon', 'male', '남성', 'gyeong'];

function pickVoice(
  voices: SpeechSynthesisVoice[],
  preferFemale: boolean,
): SpeechSynthesisVoice | null {
  const korean = voices.filter((v) => v.lang?.toLowerCase().startsWith('ko'));
  if (!korean.length) return null;
  const hints = preferFemale ? FEMALE_HINTS : MALE_HINTS;
  const match = korean.find((v) => hints.some((h) => v.name.toLowerCase().includes(h)));
  if (match) return match;
  // 한국어 음성이 여러 개면 서로 다른 것을 배정해 구분감을 준다
  return korean[preferFemale ? 0 : Math.min(1, korean.length - 1)];
}

function clampMs(v: number) {
  return Math.min(Math.max(v, 900), 20000);
}

export interface SpeakHandle {
  /** 낭독이 끝나거나 취소되면 resolve. 절대 reject 하지 않는다. */
  done: Promise<void>;
  cancel(): void;
}

export class Tts {
  private ready = false;
  /** 지금 소리를 내고 있는가 (마이크 오인식 방지용) */
  speaking = false;
  enabled = true;

  async init() {
    voicesCache = await loadVoices();
    this.ready = true;
  }

  get available() {
    return typeof speechSynthesis !== 'undefined';
  }

  get hasKoreanVoice() {
    return voicesCache.some((v) => v.lang?.toLowerCase().startsWith('ko'));
  }

  speak(text: string, who: Interviewer): SpeakHandle {
    let settle: () => void = () => {};
    const done = new Promise<void>((resolve) => {
      settle = resolve;
    });

    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      this.speaking = false;
      lipSync.end();
      settle();
    };

    // TTS 를 못 쓰면 글자 수에 비례한 시간만 흘려보낸다 (자막으로 진행)
    if (!this.available || !this.enabled || !text.trim()) {
      this.speaking = true;
      lipSync.begin(text);
      timer = window.setTimeout(finish, clampMs(text.length * 95));
      return {
        done,
        cancel: () => {
          finish();
        },
      };
    }

    speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'ko-KR';
    utter.pitch = who.voice.pitch;
    utter.rate = who.voice.rate;
    utter.volume = 1;
    if (this.ready) {
      const v = pickVoice(voicesCache, who.voice.preferFemale);
      if (v) utter.voice = v;
    }

    utter.onstart = () => {
      this.speaking = true;
      lipSync.begin(text);
    };
    utter.onboundary = (e) => {
      lipSync.boundary(e.charIndex);
    };
    utter.onend = finish;
    utter.onerror = finish;

    this.speaking = true;
    speechSynthesis.speak(utter);
    // 일부 브라우저에서 onend 가 오지 않는 문제에 대한 안전망
    timer = window.setTimeout(finish, clampMs(text.length * 170) + 4000);

    return {
      done,
      cancel: () => {
        speechSynthesis.cancel();
        finish();
      },
    };
  }

  stop() {
    if (this.available) speechSynthesis.cancel();
    this.speaking = false;
  }
}
