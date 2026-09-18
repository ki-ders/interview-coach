/**
 * 면접 영상 녹화 (MediaRecorder). 카메라·마이크 스트림을 그대로 담아 끝나면 파일로 준다.
 * 면접관 목소리(스피커)는 스트림에 없으므로 지원자 본인만 찍힌다. 어디로도 전송하지 않는다.
 */

export interface Recording {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** 브라우저마다 지원하는 컨테이너가 다르다: Safari 는 mp4, Chrome 계열은 webm */
const CANDIDATES = [
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickRecordingMime(): string | null {
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

export function recordingSupported(): boolean {
  return pickRecordingMime() !== null;
}

export function recordingExtension(mimeType: string): string {
  return mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export class SessionRecorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private mimeType = '';

  get active() {
    return this.rec !== null && this.rec.state === 'recording';
  }

  /** 녹화를 시작한다. 지원하지 않거나 실패하면 false */
  start(stream: MediaStream): boolean {
    const mime = pickRecordingMime();
    if (!mime) return false;
    try {
      this.chunks = [];
      this.mimeType = mime;
      this.rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1_400_000, audioBitsPerSecond: 96_000 });
      this.rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) this.chunks.push(e.data);
      };
      // 조각을 주기적으로 받아 두면 탭이 죽어도 앞부분은 남는다
      this.rec.start(2000);
      this.startedAt = performance.now();
      return true;
    } catch (err) {
      console.warn('[recorder] 시작 실패', err);
      this.rec = null;
      return false;
    }
  }

  /** 녹화를 끝내고 파일을 돌려준다. 녹화 중이 아니었으면 null */
  stop(): Promise<Recording | null> {
    const rec = this.rec;
    if (!rec) return Promise.resolve(null);
    this.rec = null;
    if (rec.state === 'inactive') return Promise.resolve(this.collect());
    return new Promise((resolve) => {
      const timer = window.setTimeout(() => resolve(this.collect()), 3000);
      rec.onstop = () => {
        window.clearTimeout(timer);
        resolve(this.collect());
      };
      try {
        rec.stop();
      } catch {
        window.clearTimeout(timer);
        resolve(this.collect());
      }
    });
  }

  private collect(): Recording | null {
    if (!this.chunks.length) return null;
    const blob = new Blob(this.chunks, { type: this.mimeType });
    this.chunks = [];
    return { blob, mimeType: this.mimeType, durationMs: performance.now() - this.startedAt };
  }
}
