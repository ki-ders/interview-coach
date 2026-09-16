/**
 * 안드로이드(Capacitor) 용 음성 인식.
 * WebView 에는 Web Speech API 가 없어서 @capacitor-community/speech-recognition 플러그인을 쓴다.
 * stt.ts 의 Stt 와 같은 표면을 제공한다.
 *
 * 주의: 이 파일은 실제 기기에서 검증되지 않았다 (개발 PC 에 Android SDK 없음).
 */
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import type { PluginListenerHandle } from '@capacitor/core';
import { looksLikeEcho, type SttSnapshot } from './stt';

export class NativeStt {
  private wantRunning = false;
  private running = false;
  private restartTimer = 0;
  private listeners: PluginListenerHandle[] = [];
  private finalText = '';
  private interimText = '';
  private permissionAsked = false;

  gated = false;
  ignoreText = '';
  onUpdate: ((snap: SttSnapshot) => void) | null = null;
  onFatal: ((reason: string) => void) | null = null;

  /** 플러그인이 붙어 있으면 지원한다고 본다. 실제 가용성은 start 에서 확인한다. */
  readonly supported = true;

  private emit() {
    this.onUpdate?.(this.snapshot());
  }

  private async ensureListeners() {
    if (this.listeners.length) return;
    this.listeners.push(
      await SpeechRecognition.addListener('partialResults', ({ matches }) => {
        if (this.gated) return;
        // matches 는 현재 발화에 대한 후보 목록이며 첫 번째가 가장 유력하다
        this.interimText = (matches?.[0] ?? '').trim();
        this.emit();
      }),
    );
    this.listeners.push(
      await SpeechRecognition.addListener('listeningState', ({ status }) => {
        if (status === 'started') {
          this.running = true;
          return;
        }
        // 안드로이드 인식기는 발화 하나가 끝나면 멈춘다 → 지금까지의 가설을 확정하고 다시 켠다
        this.running = false;
        this.commitInterim();
        if (this.wantRunning) {
          window.clearTimeout(this.restartTimer);
          this.restartTimer = window.setTimeout(() => void this.launch(), 250);
        }
      }),
    );
  }

  private commitInterim() {
    const text = this.interimText.trim();
    this.interimText = '';
    if (!text || this.gated || looksLikeEcho(text, this.ignoreText)) {
      this.emit();
      return;
    }
    this.finalText += (this.finalText ? ' ' : '') + text;
    this.emit();
  }

  private async launch() {
    if (!this.wantRunning || this.running) return;
    try {
      if (!this.permissionAsked) {
        this.permissionAsked = true;
        const { speechRecognition } = await SpeechRecognition.requestPermissions();
        if (speechRecognition !== 'granted') {
          this.wantRunning = false;
          this.onFatal?.('마이크 권한이 거부되어 음성 인식을 쓸 수 없습니다.');
          return;
        }
        const { available } = await SpeechRecognition.available();
        if (!available) {
          this.wantRunning = false;
          this.onFatal?.('이 기기에는 음성 인식 서비스가 없습니다. 말투·내용 평가는 건너뜁니다.');
          return;
        }
      }
      await this.ensureListeners();
      this.running = true;
      await SpeechRecognition.start({
        language: 'ko-KR',
        maxResults: 1,
        partialResults: true,
        popup: false,
      });
    } catch (err) {
      this.running = false;
      // 일시적 오류(무음 등)는 재시도, 그 외에는 알린다
      const msg = err instanceof Error ? err.message : String(err);
      if (/permission|denied/i.test(msg)) {
        this.wantRunning = false;
        this.onFatal?.('마이크 권한이 거부되어 음성 인식을 쓸 수 없습니다.');
        return;
      }
      if (this.wantRunning) {
        window.clearTimeout(this.restartTimer);
        this.restartTimer = window.setTimeout(() => void this.launch(), 600);
      }
    }
  }

  start() {
    this.wantRunning = true;
    void this.launch();
  }

  stop() {
    this.wantRunning = false;
    window.clearTimeout(this.restartTimer);
    void SpeechRecognition.stop().catch(() => undefined);
  }

  dispose() {
    this.stop();
    for (const l of this.listeners) void l.remove();
    this.listeners = [];
  }

  beginTurn() {
    this.finalText = '';
    this.interimText = '';
    this.emit();
  }

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
