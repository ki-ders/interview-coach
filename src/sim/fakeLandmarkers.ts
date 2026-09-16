import type { FaceLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmarkers } from '../vision/landmarkers';
import { NO_FACE, makeRng, synthFace, synthPose } from './synth';
import type { SimWorld } from './world';

/**
 * MediaPipe 대신 SimWorld 의 지원자 상태로 랜드마크를 만들어 돌려준다.
 * 세션 루프는 detectForVideo 두 개만 호출하므로 그것만 구현한다.
 */
export function createFakeLandmarkers(world: SimWorld): Landmarkers {
  const rng = makeRng(77);
  const face = {
    detectForVideo: (_frame: unknown, timestampMs: number) =>
      world.faceVisible ? synthFace(world.faceAt(timestampMs), rng) : NO_FACE,
    close() {},
  };
  const pose = {
    detectForVideo: (_frame: unknown, timestampMs: number) => synthPose(world.poseAt(timestampMs), rng),
    close() {},
  };
  return {
    face: face as unknown as FaceLandmarker,
    pose: pose as unknown as PoseLandmarker,
    close() {},
  };
}
