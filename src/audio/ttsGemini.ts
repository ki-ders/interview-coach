/**
 * Gemini 음성 합성 (무료 티어). 기기 내장 음성보다 훨씬 자연스럽고 면접관마다 다른 목소리를 낼 수 있다.
 * 응답은 24kHz 16bit PCM 이라 Web Audio 로 바로 재생한다. 한도에 걸리거나 실패하면 null 을 돌려주고
 * 호출부가 기기 음성으로 넘어간다.
 */
import type { Interviewer } from '../types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const MODELS = ['gemini-2.5-flash-tts', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-lite-preview-tts'];
const TIMEOUT_MS = 15000;
const SAMPLE_RATE = 24000;

/** 면접관 성향별 목소리와 말투 지시 (Gemini 의 미리 만든 음성 이름) */
function voiceOf(who: Interviewer): { name: string; style: string } {
  if (who.voice.preferFemale) {
    return who.mood === 'stern'
      ? { name: 'Kore', style: '차갑고 단호한 여성 면접관이 감정 없이 또박또박 말하듯' }
      : who.mood === 'warm'
        ? { name: 'Aoede', style: '따뜻하고 차분한 여성 면접관이 부드럽게 말하듯' }
        : { name: 'Kore', style: '감정을 드러내지 않는 중립적인 여성 면접관이 또박또박 말하듯' };
  }
  return who.mood === 'stern'
    ? { name: 'Orus', style: '낮고 단호한 남성 면접관이 압박하듯 짧게 끊어 말하듯' }
    : who.mood === 'warm'
      ? { name: 'Puck', style: '푸근한 중년 남성 면접관이 편안하게 말하듯' }
      : { name: 'Charon', style: '차분하고 사무적인 남성 면접관이 또박또박 말하듯' };
}

export interface SynthResult {
  buffer: AudioBuffer;
  /** 20ms 단위 진폭 포락선 (0~1) — 립싱크용 */
  envelope: Float32Array;
  envelopeStepMs: number;
}

interface GeminiAudioResponse {
  candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
  error?: { code?: number; message?: string; status?: string };
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** PCM s16le → AudioBuffer + 포락선 */
function pcmToBuffer(ctx: AudioContext, bytes: Uint8Array, rate: number): SynthResult {
  const n = Math.floor(bytes.byteLength / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, n * 2);
  const buffer = ctx.createBuffer(1, n, rate);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = view.getInt16(i * 2, true) / 32768;

  const stepMs = 20;
  const step = Math.round((rate * stepMs) / 1000);
  const frames = Math.ceil(n / step);
  const envelope = new Float32Array(frames);
  let peak = 1e-4;
  for (let f = 0; f < frames; f++) {
    let sum = 0;
    const s0 = f * step;
    const s1 = Math.min(n, s0 + step);
    for (let i = s0; i < s1; i++) sum += ch[i] * ch[i];
    const rms = Math.sqrt(sum / Math.max(1, s1 - s0));
    envelope[f] = rms;
    if (rms > peak) peak = rms;
  }
  // 0~1 로 정규화하고 살짝 부드럽게
  let prev = 0;
  for (let f = 0; f < frames; f++) {
    const v = Math.min(1, envelope[f] / peak);
    prev = prev * 0.35 + v * 0.65;
    envelope[f] = prev;
  }
  return { buffer, envelope, envelopeStepMs: stepMs };
}

export class GeminiTts {
  private readonly key: string;
  private model = MODELS[0];
  private cache = new Map<string, SynthResult>();
  private pending = new Map<string, Promise<SynthResult | null>>();
  /** 한도 초과·실패가 이어지면 잠시 끈다 (기기 음성으로) */
  disabledUntil = 0;
  lastError: string | null = null;
  /** 이 세션에서 한 번이라도 성공했는지 */
  everWorked = false;

  constructor(apiKey: string) {
    this.key = apiKey.trim();
  }

  get available() {
    return !!this.key && performance.now() >= this.disabledUntil;
  }

  private cacheKey(text: string, who: Interviewer) {
    return `${who.id}|${text}`;
  }

  /** 미리 만들어 두면 말할 때 기다리지 않는다 (질문 목록에 쓴다) */
  prefetch(ctx: AudioContext, text: string, who: Interviewer) {
    void this.synthesize(ctx, text, who);
  }

  synthesize(ctx: AudioContext, text: string, who: Interviewer): Promise<SynthResult | null> {
    const key = this.cacheKey(text, who);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const p = this.request(ctx, text, who)
      .then((r) => {
        if (r) this.cache.set(key, r);
        return r;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  private async request(ctx: AudioContext, text: string, who: Interviewer): Promise<SynthResult | null> {
    if (!this.available) return null;
    const { name, style } = voiceOf(who);
    for (let attempt = 0; attempt < MODELS.length; attempt++) {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${BASE}/models/${this.model}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
          signal: ctrl.signal,
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${style} 한국어로 읽어 주세요. 다른 말은 덧붙이지 마세요:\n${text}` }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: name } } },
            },
          }),
        });
        if (res.status === 404 && attempt < MODELS.length - 1) {
          this.model = MODELS[attempt + 1];
          continue;
        }
        const data = (await res.json().catch(() => ({}))) as GeminiAudioResponse;
        if (!res.ok) {
          if (res.status === 429) {
            // 분당·일일 한도 — 2분 쉬었다가 다시 시도한다. 그동안은 기기 음성
            this.disabledUntil = performance.now() + 120000;
            this.lastError = 'Gemini 음성 무료 한도에 걸려 잠시 기기 음성으로 말합니다.';
          } else {
            this.disabledUntil = performance.now() + 600000;
            this.lastError = `Gemini 음성을 쓸 수 없어 기기 음성으로 말합니다 (${data.error?.message ?? res.status}).`;
          }
          return null;
        }
        const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
        const b64 = part?.inlineData?.data;
        if (!b64) {
          this.lastError = 'Gemini 음성 응답이 비어 기기 음성으로 말합니다.';
          return null;
        }
        const rateMatch = /rate=(\d+)/.exec(part?.inlineData?.mimeType ?? '');
        const rate = rateMatch ? Number(rateMatch[1]) : SAMPLE_RATE;
        this.everWorked = true;
        this.lastError = null;
        return pcmToBuffer(ctx, decodeBase64(b64), rate);
      } catch (err) {
        this.lastError =
          err instanceof Error && err.name === 'AbortError'
            ? 'Gemini 음성 응답이 늦어 기기 음성으로 말합니다.'
            : `Gemini 음성 연결 실패로 기기 음성으로 말합니다: ${String(err)}`;
        return null;
      } finally {
        window.clearTimeout(timer);
      }
    }
    return null;
  }
}
