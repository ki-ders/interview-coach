/**
 * 가짜 카메라·마이크. 캔버스에 그린 지원자 그림을 영상 트랙으로, Web Audio 로 합성한
 * 소음+목소리를 오디오 트랙으로 내보낸다. MicAnalyzer 는 이 트랙을 진짜 마이크처럼 분석한다.
 */
import { NOISE_DBFS, type SimWorld } from './world';

const dbToAmp = (db: number) => (Number.isFinite(db) ? Math.pow(10, db / 20) : 0);

export interface FakeMedia {
  stream: MediaStream;
  dispose(): void;
}

function drawFigure(ctx: CanvasRenderingContext2D, world: SimWorld, now: number) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = '#d9dee6';
  ctx.fillRect(0, 0, W, H);

  const pose = world.poseAt(now);
  const face = world.faceAt(now);

  // 몸통
  const sx = pose.cx * W;
  const sy = pose.shoulderY * H;
  const sw = pose.shoulderW * W;
  ctx.fillStyle = '#3b4a63';
  ctx.beginPath();
  ctx.moveTo(sx - sw / 2 - 10, sy);
  ctx.lineTo(sx + sw / 2 + 10, sy);
  ctx.lineTo(sx + sw / 2 + 16, pose.hipY * H);
  ctx.lineTo(sx - sw / 2 - 16, pose.hipY * H);
  ctx.closePath();
  ctx.fill();

  // 다리
  if (pose.kneeVisibility > 0.5) {
    ctx.strokeStyle = '#2b3345';
    ctx.lineWidth = sw * 0.32;
    ctx.lineCap = 'round';
    for (const side of [-0.7, 0.7]) {
      ctx.beginPath();
      ctx.moveTo((pose.cx + (side * pose.shoulderW) / 2) * W, pose.hipY * H);
      ctx.lineTo((pose.cx + (side * pose.shoulderW) / 2) * W, pose.kneeY * H);
      ctx.stroke();
    }
  }

  // 손
  ctx.fillStyle = '#e8c4a8';
  for (const w of [pose.wristL, pose.wristR]) {
    ctx.beginPath();
    ctx.arc((pose.cx + w.x * pose.shoulderW) * W, (pose.shoulderY + w.y * pose.shoulderW) * H, sw * 0.09, 0, Math.PI * 2);
    ctx.fill();
  }

  // 머리 (yaw/pitch 만큼 눈·코를 옮긴다)
  const r = face.scale * 0.23 * W;
  const hx = face.cx * W;
  const hy = face.cy * H;
  ctx.fillStyle = '#e8c4a8';
  ctx.beginPath();
  ctx.ellipse(hx, hy, r * 0.85, r, 0, 0, Math.PI * 2);
  ctx.fill();
  const ox = Math.sin(face.yaw) * r * 0.6;
  const oy = Math.sin(face.pitch) * r * 0.6;
  ctx.fillStyle = '#222';
  const eyeH = face.blink > 0.5 ? r * 0.03 : r * 0.1;
  for (const s of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + ox + s * r * 0.35, hy + oy - r * 0.15, r * 0.1, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(hx + ox * 1.4, hy + oy * 1.4 + r * 0.15, r * 0.07, 0, Math.PI * 2);
  ctx.fill();
  // 입: 말할 때 벌어짐
  ctx.fillStyle = '#7a3b3b';
  ctx.beginPath();
  const open = world.speaking ? (0.5 + 0.5 * Math.sin(now / 90)) * r * 0.12 : r * 0.02;
  ctx.ellipse(hx + ox * 1.2, hy + oy * 1.2 + r * 0.45, r * 0.22, open, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.font = '13px sans-serif';
  ctx.fillText(`SIM · ${world.describe()}`, 10, H - 12);
}

export async function createFakeMedia(world: SimWorld): Promise<FakeMedia> {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 컨텍스트를 만들 수 없습니다');
  const videoTimer = window.setInterval(() => drawFigure(ctx, world, performance.now()), 33);
  drawFigure(ctx, world, performance.now());
  const videoStream = canvas.captureStream(30);

  const ac = new AudioContext();
  if (ac.state === 'suspended') await ac.resume().catch(() => undefined);

  // 배경 소음: 백색 잡음
  const noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
  const data = noiseBuf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ac.createBufferSource();
  noise.buffer = noiseBuf;
  noise.loop = true;
  const noiseGain = ac.createGain();
  // 균등분포 잡음의 RMS 는 1/√3
  noiseGain.gain.value = dbToAmp(NOISE_DBFS) * Math.sqrt(3);

  // 목소리: 톱니파 기음 + 배음, 음절 리듬으로 진폭 변조
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 140;
  const osc2 = ac.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 420;
  const voiceGain = ac.createGain();
  voiceGain.gain.value = 0;

  const dest = ac.createMediaStreamDestination();
  noise.connect(noiseGain).connect(dest);
  osc.connect(voiceGain);
  osc2.connect(voiceGain);
  voiceGain.connect(dest);
  noise.start();
  osc.start();
  osc2.start();

  let syllable = 0;
  const audioTimer = window.setInterval(() => {
    const db = world.voiceDb();
    if (!Number.isFinite(db)) {
      voiceGain.gain.setTargetAtTime(0, ac.currentTime, 0.03);
      return;
    }
    // 톱니파 RMS ≈ A/√3. 음절마다 0.55~1.0 사이로 출렁이게 한다
    syllable++;
    const env = 0.55 + 0.45 * Math.abs(Math.sin(syllable * 0.9));
    const amp = dbToAmp(db) * Math.sqrt(3) * env;
    voiceGain.gain.setTargetAtTime(amp, ac.currentTime, 0.02);
  }, 100);

  const stream = new MediaStream([...videoStream.getVideoTracks(), ...dest.stream.getAudioTracks()]);

  return {
    stream,
    dispose() {
      window.clearInterval(videoTimer);
      window.clearInterval(audioTimer);
      try {
        osc.stop();
        osc2.stop();
        noise.stop();
      } catch {
        /* 이미 멈춤 */
      }
      void ac.close();
    },
  };
}
