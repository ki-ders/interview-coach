/**
 * 시뮬레이션 모드 (?sim=basic|nudge|good).
 * 카메라·마이크·MediaPipe·음성인식을 전부 가짜로 바꿔 끼우고, 나머지 세션 로직은
 * 실제 코드 그대로 돌린다. 리포트가 대본대로 나오는지 확인하는 데 쓴다.
 */
import type { ComponentType } from 'react';
import type { SessionDeps } from '../interview/useSession';
import { Tts } from '../audio/tts';
import { Stt } from '../audio/stt';
import type { Interviewer } from '../types';
import { createFakeLandmarkers } from './fakeLandmarkers';
import { FakeLlm } from './fakeLlm';
import { createFakeMedia } from './fakeMedia';
import { AnswerScript, installFakeRecognition } from './fakeRecognition';
import { getScenario, type Scenario } from './scenarios';
import { SimDriver } from './SimDriver';
import { SimWorld } from './world';

export interface SimSetup {
  deps: SessionDeps;
  world: SimWorld;
  scenario: Scenario;
  log: string[];
  bus: EventTarget;
  Driver: ComponentType<Parameters<typeof SimDriver>[0]>;
}

/** 소리는 내지 않고(타이머 경로) 무슨 문장을 말했는지만 세계에 알려주는 TTS */
class SimTts extends Tts {
  private readonly world: SimWorld;
  constructor(world: SimWorld) {
    super();
    this.world = world;
    this.enabled = false;
  }
  override speak(text: string, who: Interviewer) {
    this.world.lastLine = text;
    this.world.interviewerSpeaking = true;
    const handle = super.speak(text, who);
    void handle.done.then(() => {
      this.world.interviewerSpeaking = false;
    });
    return handle;
  }
}

export function createSim(scenarioId: string): SimSetup {
  const scenario = getScenario(scenarioId);
  const world = new SimWorld();
  const log: string[] = [];
  const bus = new EventTarget();
  const say = (msg: string) => {
    log.push(`${new Date().toLocaleTimeString('ko-KR', { hour12: false })} ${msg}`);
    bus.dispatchEvent(new Event('log'));
    console.info('[sim]', msg);
  };

  const script = new AnswerScript(scenario.answers);
  installFakeRecognition(world, script, say);

  let media: Awaited<ReturnType<typeof createFakeMedia>> | null = null;

  const deps: SessionDeps = {
    async getUserMedia() {
      media?.dispose();
      media = await createFakeMedia(world);
      say('가짜 카메라·마이크 연결');
      return media.stream;
    },
    async loadLandmarkers(onProgress) {
      onProgress?.('합성 랜드마크 준비');
      say('MediaPipe 대신 합성 랜드마크 사용');
      return createFakeLandmarkers(world);
    },
    // 가짜 인식기가 window.SpeechRecognition 에 꽂혀 있으므로 진짜 Stt 클래스를 그대로 쓴다
    createStt: () => new Stt(),
    createTts: () => new SimTts(world),
    // 시나리오가 두뇌를 켜 두면 키 없이 가짜 LLM 으로 흐름을 검증한다
    createLlm: async (cfg) => (cfg.llmProvider === 'none' ? null : new FakeLlm(say)),
  };

  say(`시나리오: ${scenario.name}`);
  return { deps, world, scenario, log, bus, Driver: SimDriver };
}
