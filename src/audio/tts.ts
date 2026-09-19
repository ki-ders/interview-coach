import type { Interviewer } from '../types';
import { lipSync } from '../face/lipsync';

let voicesCache: SpeechSynthesisVoice[] = [];

/** 사용자가 면접관마다 고른 음성 (voiceURI). 기기마다 다르므로 이 브라우저에만 저장한다 */
const VOICE_STORE = 'interview-coach:voices';

export function getVoiceOverrides(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(VOICE_STORE) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function setVoiceOverride(interviewerId: string, voiceURI: string | null) {
  const all = getVoiceOverrides();
  if (voiceURI) all[interviewerId] = voiceURI;
  else delete all[interviewerId];
  try {
    localStorage.setItem(VOICE_STORE, JSON.stringify(all));
  } catch {
    /* noop */
  }
}

/** 기기에 있는 한국어 음성 목록 (아직 로드 전이면 빈 배열일 수 있다) */
export function koreanVoices(): SpeechSynthesisVoice[] {
  if (typeof speechSynthesis === 'undefined') return [];
  const all = voicesCache.length ? voicesCache : speechSynthesis.getVoices();
  return all.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('ko'));
}

export function loadVoices(): Promise<SpeechSynthesisVoice[]> {
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

/** 플랫폼별 한국어 음성 이름 (Windows/Edge: Heami·SunHi·InJoon·Hyunsu·BongJin·GookMin·YuJin·JiMin·SeoHyeon, iOS: Yuna·Suhyun·Jian·Minsu, Google: 남/여 구분 없음) */
const FEMALE_HINTS = ['heami', 'sunhi', 'yuna', 'yujin', 'jimin', 'seohyeon', 'suhyun', 'jian', 'female', '여성', '여자'];
const MALE_HINTS = ['injoon', 'hyunsu', 'bongjin', 'gookmin', 'minsu', 'male', '남성', '남자', 'gyeong'];

export interface VoicePick {
  voice: SpeechSynthesisVoice | null;
  /** 성별에 맞는 음성을 찾았는지. 못 찾으면 음높이로 구분감을 준다 */
  genderMatched: boolean;
}

export function pickVoice(voices: SpeechSynthesisVoice[], preferFemale: boolean): VoicePick {
  const korean = voices.filter((v) => v.lang?.toLowerCase().replace('_', '-').startsWith('ko'));
  if (!korean.length) return { voice: null, genderMatched: false };
  const has = (v: SpeechSynthesisVoice, hints: string[]) => hints.some((h) => v.name.toLowerCase().includes(h));
  const wanted = preferFemale ? FEMALE_HINTS : MALE_HINTS;
  const other = preferFemale ? MALE_HINTS : FEMALE_HINTS;
  // 1) 이름으로 성별이 맞는 음성. 로컬(기기 내장) 음성을 우선한다 — 지연이 적다
  const matches = korean.filter((v) => has(v, wanted) && !has(v, other));
  if (matches.length) return { voice: matches.find((v) => v.localService) ?? matches[0], genderMatched: true };
  // 2) 반대 성별로 확인된 것을 뺀 나머지 중에서, 여러 개면 서로 다른 것을 배정한다
  const neutral = korean.filter((v) => !has(v, other));
  const pool = neutral.length ? neutral : korean;
  return { voice: pool[preferFemale ? 0 : Math.min(1, pool.length - 1)], genderMatched: false };
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
      const chosen = getVoiceOverrides()[who.id];
      const forced = chosen ? voicesCache.find((v) => v.voiceURI === chosen) : undefined;
      const pick = forced ? { voice: forced, genderMatched: true } : pickVoice(voicesCache, who.voice.preferFemale);
      if (pick.voice) utter.voice = pick.voice;
      // 기기에 한 성별 음성밖에 없으면(아이패드는 대개 여성 음성 하나) 음높이 차이를 더 벌려 구분되게 한다
      if (!pick.genderMatched) utter.pitch = who.voice.preferFemale ? who.voice.pitch + 0.05 : Math.max(0.55, who.voice.pitch - 0.18);
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
