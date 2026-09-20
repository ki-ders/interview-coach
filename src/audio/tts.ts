import type { Interviewer } from '../types';
import { lipSync } from '../face/lipsync';
import { GeminiTts } from './ttsGemini';

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
  /** 소리가 실제로 나기 시작하면 resolve (자막·입 움직임을 소리에 맞추는 데 쓴다). 취소돼도 resolve */
  started: Promise<void>;
  /** 낭독이 끝나거나 취소되면 resolve. 절대 reject 하지 않는다. */
  done: Promise<void>;
  cancel(): void;
}

/** started/done 한 쌍을 만든다 */
function gates() {
  let markStarted: () => void = () => {};
  let markDone: () => void = () => {};
  const started = new Promise<void>((r) => {
    markStarted = r;
  });
  const done = new Promise<void>((r) => {
    markDone = r;
  });
  return { started, done, markStarted, markDone };
}

export class Tts {
  private ready = false;
  /** 지금 소리를 내고 있는가 (마이크 오인식 방지용) */
  speaking = false;
  enabled = true;
  /** Gemini 자연 음성 (키가 있고 켜 두었을 때). 실패하면 기기 음성으로 */
  private gemini: GeminiTts | null = null;
  private ctx: AudioContext | null = null;
  private playing: AudioBufferSourceNode | null = null;
  /** Gemini 음성이 기기 음성으로 넘어갔을 때 한 번 알리기 위한 문구 */
  onNotice: ((msg: string) => void) | null = null;
  private noticed = false;

  async init() {
    voicesCache = await loadVoices();
    this.ready = true;
  }

  /** 사용자 제스처 안에서 오디오 컨텍스트를 만들어 둔다 (iOS Safari) */
  prime() {
    if (this.ctx) return;
    const Ctor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  /** Gemini 음성을 켠다 (키가 비면 끈다) */
  useGemini(apiKey: string | null) {
    this.gemini = apiKey?.trim() ? new GeminiTts(apiKey) : null;
    this.noticed = false;
  }

  get geminiVoiceOn() {
    return this.gemini !== null;
  }

  /** 질문처럼 미리 아는 문장은 미리 합성해 두면 말할 때 기다리지 않는다 */
  prefetch(text: string, who: Interviewer) {
    if (!this.gemini || !this.ctx || !text.trim()) return;
    this.gemini.prefetch(this.ctx, text, who);
  }

  /** Gemini 음성으로 말한다. 못 쓰면 null (호출부가 기기 음성으로) */
  private speakGemini(text: string, who: Interviewer): SpeakHandle | null {
    const gemini = this.gemini;
    const ctx = this.ctx;
    if (!gemini || !ctx || !gemini.available) return null;

    const g = gates();
    let settled = false;
    let cancelled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      this.playing = null;
      this.speaking = false;
      lipSync.end();
      g.markStarted();
      g.markDone();
    };
    // 합성을 기다리는 동안도 "말하는 중" 으로 두어 마이크가 열리지 않게 한다
    this.speaking = true;
    // 합성이 너무 오래 걸리면(한도·지연) 포기하고 기기 음성으로
    let gaveUp = false;
    const giveUp = window.setTimeout(() => {
      gaveUp = true;
    }, 6000);

    void gemini.synthesize(ctx, text, who).then(async (result) => {
      window.clearTimeout(giveUp);
      if (cancelled) return finish();
      if (!result || gaveUp) {
        // 기기 음성으로 대신 말하고 그 끝을 기다린다
        if (!this.noticed && gemini.lastError) {
          this.noticed = true;
          this.onNotice?.(gemini.lastError);
        }
        const fallback = this.speakDevice(text, who);
        fallbackHandle = fallback;
        void fallback.started.then(() => g.markStarted());
        await fallback.done;
        return finish();
      }
      if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
      const src = ctx.createBufferSource();
      src.buffer = result.buffer;
      src.connect(ctx.destination);
      src.onended = finish;
      this.playing = src;
      // 출력 지연(블루투스 이어폰은 수백 ms)만큼 입·자막을 늦춰 소리와 맞춘다
      const latencyMs = Math.min(600, Math.max(0, ((ctx.outputLatency || 0) + ctx.baseLatency) * 1000));
      window.setTimeout(() => {
        if (settled) return;
        lipSync.beginEnvelope(result.envelope, result.envelopeStepMs);
        g.markStarted();
      }, latencyMs);
      src.start();
      timer = window.setTimeout(finish, result.buffer.duration * 1000 + 1500);
    });

    let fallbackHandle: SpeakHandle | null = null;
    return {
      started: g.started,
      done: g.done,
      cancel: () => {
        cancelled = true;
        fallbackHandle?.cancel();
        try {
          this.playing?.stop();
        } catch {
          /* 이미 끝남 */
        }
        finish();
      },
    };
  }

  speak(text: string, who: Interviewer): SpeakHandle {
    if (this.enabled && text.trim()) {
      const g = this.speakGemini(text, who);
      if (g) return g;
    }
    return this.speakDevice(text, who);
  }

  get available() {
    return typeof speechSynthesis !== 'undefined';
  }

  get hasKoreanVoice() {
    return voicesCache.some((v) => v.lang?.toLowerCase().startsWith('ko'));
  }

  /** 기기 내장 음성(Web Speech) */
  private speakDevice(text: string, who: Interviewer): SpeakHandle {
    const g = gates();
    const done = g.done;
    let settled = false;
    let timer = 0;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      this.speaking = false;
      lipSync.end();
      g.markStarted();
      g.markDone();
    };

    // TTS 를 못 쓰면 글자 수에 비례한 시간만 흘려보낸다 (자막으로 진행)
    if (!this.available || !this.enabled || !text.trim()) {
      this.speaking = true;
      lipSync.begin(text);
      g.markStarted();
      timer = window.setTimeout(finish, clampMs(text.length * 95));
      return {
        started: g.started,
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
      g.markStarted();
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
    // onstart 가 안 오는 브라우저 안전망: 1.5초 뒤에는 시작한 것으로 본다
    window.setTimeout(() => g.markStarted(), 1500);

    return {
      started: g.started,
      done,
      cancel: () => {
        speechSynthesis.cancel();
        finish();
      },
    };
  }

  stop() {
    if (this.available) speechSynthesis.cancel();
    try {
      this.playing?.stop();
    } catch {
      /* noop */
    }
    this.playing = null;
    this.speaking = false;
  }
}
