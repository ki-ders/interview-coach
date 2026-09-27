/**
 * 시뮬레이션용 Gemini API 흉내 (?sim=...&gemini=mock).
 * 진짜 GeminiLlm·GeminiTts 코드가 그대로 돌도록 fetch 를 가로채 실제 응답 모양으로 답한다.
 * 키 없이 요청 형식·응답 파싱·음성 재생·전사 교체까지 한 번에 검증하는 데 쓴다.
 */

interface MockStats {
  /** 전사를 같이 받은 평가 요청 */
  merged: number;
  tts: number;
  transcribe: number;
  evaluate: number;
  summary: number;
  other: number;
  /** 전사 요청에 실린 오디오 형식 */
  audioMimes: string[];
}

export const mockGeminiStats: MockStats = { merged: 0, tts: 0, transcribe: 0, evaluate: 0, summary: 0, other: 0, audioMimes: [] };

/** 0.9초짜리 24kHz 16bit PCM (음절처럼 켜졌다 꺼지는 톤) → base64 */
function fakeSpeechPcm(seconds: number): string {
  const rate = 24000;
  const n = Math.round(rate * seconds);
  const bytes = new Uint8Array(n * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = 0.5 - 0.5 * Math.cos(2 * Math.PI * 4.5 * t);
    const v = Math.sin(2 * Math.PI * 170 * t) * 0.25 * syllable;
    view.setInt16(i * 2, Math.round(v * 32767), true);
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function reply(text: string): Response {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function installMockGemini(log: (msg: string) => void) {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes('generativelanguage.googleapis.com')) return realFetch(input, init);
    // 실제 네트워크처럼 조금 늦게
    await new Promise((r) => setTimeout(r, 350));
    if (!init?.body) return new Response(JSON.stringify({ models: [] }), { status: 200 });
    const body = JSON.parse(String(init.body)) as {
      contents?: { parts?: { text?: string; inlineData?: { mimeType: string; data: string } }[] }[];
      generationConfig?: { responseModalities?: string[]; responseSchema?: { properties?: Record<string, unknown> } };
    };
    const parts = body.contents?.[0]?.parts ?? [];
    const promptText = parts.map((p) => p.text ?? '').join('\n');
    const props = body.generationConfig?.responseSchema?.properties ?? {};

    // 음성 합성
    if (body.generationConfig?.responseModalities?.includes('AUDIO')) {
      mockGeminiStats.tts++;
      const spoken = promptText.split('\n').slice(1).join(' ');
      const seconds = Math.min(6, Math.max(0.8, spoken.length / 9));
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: fakeSpeechPcm(seconds) } }] } }],
        }),
        { status: 200 },
      );
    }

    // 전사만: 브라우저 인식 결과(hint)를 "더 정확한" 전사로 돌려준다 (평가 요청이 아닐 때)
    if ('transcript' in props && !('relevance' in props)) {
      mockGeminiStats.transcribe++;
      const audio = parts.find((p) => p.inlineData);
      if (audio?.inlineData) mockGeminiStats.audioMimes.push(audio.inlineData.mimeType);
      const hint = /"([\s\S]*)"/.exec(promptText)?.[1] ?? '';
      log(`가짜 Gemini: 전사 (${audio?.inlineData?.mimeType ?? '오디오 없음'})`);
      return reply(JSON.stringify({ transcript: hint ? `${hint} (정확한 전사)` : '' }));
    }

    // 답변 평가
    if ('relevance' in props) {
      mockGeminiStats.evaluate++;
      const answer = /\[지원자 답변\] ([\s\S]*?)(\n\[|$)/.exec(promptText)?.[1] ?? '';
      const short = answer.replace(/\s/g, '').length < 25;
      const withAudio = 'transcript' in props;
      const audio = parts.find((p) => p.inlineData);
      if (withAudio) {
        mockGeminiStats.merged++;
        if (audio?.inlineData) mockGeminiStats.audioMimes.push(audio.inlineData.mimeType);
      }
      log(`가짜 Gemini: 평가${withAudio ? '+전사' : ''} (${short ? '짧음 → 꼬리질문' : '충분'})`);
      return reply(
        JSON.stringify({
          relevance: short ? 30 : 82,
          note: short ? '근거가 없습니다. 구체적인 사례를 들어야 합니다.' : '사례는 좋지만 본인의 역할을 더 분명히 하세요.',
          followUp: short ? '방금 말씀하신 내용을 실제 사례 하나로 설명해 주시겠어요?' : '',
          handoff: short,
          bridge: short ? '' : '좋은 사례였습니다.',
          gist: answer.slice(0, 40),
          flags: [],
          ...(withAudio ? { transcript: `${answer} (정확한 전사)` } : {}),
        }),
      );
    }

    if ('summary' in props) {
      mockGeminiStats.summary++;
      log('가짜 Gemini: 총평');
      return reply(
        JSON.stringify({
          summary: '질문의 의도는 잘 잡았지만 근거가 약한 답변이 있었습니다.',
          strengths: ['첫 답변에서 수치로 성과를 보였습니다.'],
          improvements: ['짧은 답에는 사례를 하나 붙이세요.'],
        }),
      );
    }

    mockGeminiStats.other++;
    return reply('{}');
  };
  (window as unknown as { __mockGemini?: MockStats }).__mockGemini = mockGeminiStats;
}
