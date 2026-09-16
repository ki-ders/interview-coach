/**
 * window.SpeechRecognition 자리에 꽂는 가짜 인식기.
 * 진짜 Stt 클래스가 그대로 돌아가도록 같은 이벤트 모양(onresult / onend …)을 낸다.
 * 답변 대본을 문장 단위로, 말하는 속도에 맞춰 interim → final 로 흘려보내고,
 * 그동안 SimWorld.speaking 을 켜서 가짜 마이크가 소리를 내게 한다.
 */
import { countSyllables } from '../scoring/korean';
import type { SimWorld } from './world';

export interface ScriptedAnswer {
  /** 빈 문자열이면 아무 말도 하지 않는다 (침묵 → 면접관이 재촉하는 경로) */
  text: string;
  /** 말 속도 (음절/초). 기본 5 */
  rate?: number;
  /** 문장 사이 기본 멈춤 (ms). 기본 350 */
  pauseMs?: number;
  /** 특정 문장 뒤의 긴 멈춤 (문장 인덱스 → ms). "절었다" 를 흉내낸다 */
  longPauseAfter?: Record<number, number>;
  /** 말을 시작하기 전 기다리는 시간 (ms). 면접관의 재촉을 받는 상황을 만든다 */
  delayMs?: number;
}

export class AnswerScript {
  private queue: ScriptedAnswer[];
  turn = 0;
  constructor(answers: ScriptedAnswer[]) {
    this.queue = [...answers];
  }
  next(): ScriptedAnswer | undefined {
    this.turn++;
    return this.queue.shift();
  }
  get remaining() {
    return this.queue.length;
  }
}

interface ResultLike {
  isFinal: boolean;
  length: number;
  0: { transcript: string; confidence: number };
}

function splitSentences(text: string): string[] {
  const out = text
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return out.length ? out : [text];
}

/** TTS 문장이 마이크로 되돌아와 인식된 것처럼 살짝 뭉갠다 */
function smudge(line: string): string {
  return line.replace(/[.,?!]/g, '').replace(/(.{7})./g, '$1');
}

const trace = (msg: string) => console.debug('[sim:stt]', msg);

export function installFakeRecognition(world: SimWorld, script: AnswerScript, log: (msg: string) => void) {
  class FakeRecognition extends EventTarget {
    lang = '';
    continuous = false;
    interimResults = false;
    maxAlternatives = 1;
    onresult: ((e: Event) => void) | null = null;
    onerror: ((e: Event) => void) | null = null;
    onend: (() => void) | null = null;
    onstart: (() => void) | null = null;

    private running = false;
    private stoppedByUser = true;
    private timers: number[] = [];
    private results: ResultLike[] = [];

    private later(ms: number, fn: () => void) {
      this.timers.push(window.setTimeout(fn, ms));
    }

    private emit(index: number, transcript: string, isFinal: boolean) {
      if (!this.running) return;
      trace(`emit #${index} ${isFinal ? 'final' : 'interim'} len=${transcript.length} have=${this.results.length}`);
      this.results[index] = { isFinal, length: 1, 0: { transcript, confidence: 0.9 } };
      const ev = new Event('result') as Event & { resultIndex: number; results: unknown };
      ev.resultIndex = index;
      const list: Record<number, ResultLike> & { length: number } = { length: this.results.length };
      this.results.forEach((r, i) => {
        list[i] = r;
      });
      ev.results = list;
      this.onresult?.(ev);
    }

    start() {
      if (this.running) throw new DOMException('recognition already started', 'InvalidStateError');
      trace(`start (newTurn=${this.stoppedByUser})`);
      this.running = true;
      this.results = [];
      window.setTimeout(() => this.onstart?.(), 0);
      if (this.stoppedByUser) {
        this.stoppedByUser = false;
        this.playTurn();
      }
    }

    stop() {
      trace('stop');
      this.stoppedByUser = true;
      this.halt();
    }

    abort() {
      trace('abort');
      this.stoppedByUser = true;
      this.halt();
    }

    private halt() {
      for (const t of this.timers) window.clearTimeout(t);
      this.timers = [];
      world.speaking = false;
      if (!this.running) return;
      this.running = false;
      window.setTimeout(() => this.onend?.(), 40);
    }

    private playTurn() {
      const answer = script.next();
      let index = 0;
      let at = 0;

      // 면접관 TTS 의 잔향이 뒤늦게 인식돼 들어오는 상황 (게이트가 열린 700ms 뒤)
      if (world.lastLine) {
        at = 950;
        const echo = smudge(world.lastLine);
        const echoIndex = index++;
        this.later(at, () => this.emit(echoIndex, echo, true));
      }

      if (!answer || !answer.text.trim()) {
        log(`턴 ${script.turn}: 침묵`);
        return;
      }

      const rate = answer.rate ?? 5;
      const pause = answer.pauseMs ?? 350;
      const sentences = splitSentences(answer.text);
      log(`턴 ${script.turn}: ${sentences.length}문장, ${countSyllables(answer.text)}음절`);

      at += 1400 + (answer.delayMs ?? 0);
      sentences.forEach((sentence, si) => {
        const words = sentence.split(/\s+/);
        const durMs = (countSyllables(sentence) / rate) * 1000;
        const myIndex = index++;
        this.later(at, () => {
          world.speaking = true;
        });
        // 단어가 쌓이는 interim 결과
        const steps = Math.max(1, Math.round(durMs / 380));
        for (let k = 1; k < steps; k++) {
          const nWords = Math.max(1, Math.round((words.length * k) / steps));
          this.later(at + (durMs * k) / steps, () => this.emit(myIndex, words.slice(0, nWords).join(' '), false));
        }
        this.later(at + durMs, () => {
          this.emit(myIndex, sentence, true);
          world.speaking = false;
        });
        at += durMs + (answer.longPauseAfter?.[si] ?? pause);
      });

      // 크롬처럼 침묵이 이어지면 스스로 끝난다 (Stt 가 다시 띄운다)
      this.later(at + 3000, () => {
        if (this.running && !this.stoppedByUser) {
          trace('auto-end');
          this.running = false;
          this.onend?.();
        }
      });
    }
  }

  const w = window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  w.SpeechRecognition = FakeRecognition;
  w.webkitSpeechRecognition = FakeRecognition;
}
