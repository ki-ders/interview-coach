/**
 * 답변 한 턴의 목소리만 따로 녹음한다 (오디오 전용 MediaRecorder).
 * 끝나면 Blob 을 돌려주고, 세션은 이것을 Gemini 에 보내 브라우저 받아쓰기보다 정확한 전사를 받는다.
 */

const CANDIDATES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

export function pickAudioMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch {
      /* 다음 후보 */
    }
  }
  return null;
}

export interface AnswerAudio {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

export class AnswerRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mimeType = '';

  get active() {
    return this.rec !== null && this.rec.state === 'recording';
  }

  start(stream: MediaStream): boolean {
    const mime = pickAudioMime();
    const tracks = stream.getAudioTracks();
    if (!mime || !tracks.length) return false;
    try {
      this.chunks = [];
      this.mimeType = mime;
      this.rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, audioBitsPerSecond: 48_000 });
      this.rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      this.rec.start(1000);
      this.startedAt = performance.now();
      return true;
    } catch (err) {
      console.warn('[answerRecorder] 시작 실패', err);
      this.rec = null;
      return false;
    }
  }

  stop(): Promise<AnswerAudio | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    const collect = (): AnswerAudio | null => {
      if (!this.chunks.length) return null;
      const blob = new Blob(this.chunks, { type: this.mimeType });
      this.chunks = [];
      return { blob, mimeType: this.mimeType.split(';')[0], durationMs: performance.now() - this.startedAt };
    };
    if (rec.state === 'inactive') return Promise.resolve(collect());
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(collect()), 2000);
      rec.onstop = () => {
        window.clearTimeout(timer);
        resolve(collect());
      };
      try {
        rec.stop();
      } catch {
        window.clearTimeout(timer);
        resolve(collect());
      }
    });
  }
}

/** Blob → base64 (data: 접두어 없이) */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const s = String(fr.result);
      resolve(s.slice(s.indexOf(',') + 1));
    };
    fr.readAsDataURL(blob);
  });
}

/**
 * 녹음(webm/opus 또는 mp4/aac)을 16kHz 모노 WAV 로 바꾼다.
 * Gemini 가 확실히 받아들이는 형식이고, 브라우저마다 다른 컨테이너 문제를 피한다.
 */
export async function toWav16k(blob: Blob): Promise<Blob> {
  const Ctor: typeof AudioContext =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctor();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const rate = 16000;
    const length = Math.ceil(decoded.duration * rate);
    const offline = new OfflineAudioContext(1, length, rate);
    const src = offline.createBufferSource();
    src.buffer = decoded;
    src.connect(offline.destination);
    src.start();
    const mono = await offline.startRendering();
    const pcm = mono.getChannelData(0);
    const out = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i));
    };
    str(0, 'RIFF');
    out.setUint32(4, 36 + pcm.length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    out.setUint32(16, 16, true);
    out.setUint16(20, 1, true);
    out.setUint16(22, 1, true);
    out.setUint32(24, rate, true);
    out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true);
    out.setUint16(34, 16, true);
    str(36, 'data');
    out.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const v = Math.max(-1, Math.min(1, pcm[i]));
      out.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return new Blob([out.buffer], { type: 'audio/wav' });
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
