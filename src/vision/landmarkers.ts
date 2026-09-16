import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export interface Landmarkers {
  face: FaceLandmarker;
  pose: PoseLandmarker;
  close(): void;
}

let cached: Promise<Landmarkers> | null = null;

async function build(onProgress?: (msg: string) => void): Promise<Landmarkers> {
  onProgress?.('분석 엔진 로딩 중…');
  const fileset = await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`);

  onProgress?.('얼굴 인식 모델 로딩 중…');
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: `${base}/mediapipe/models/face_landmarker.task`,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });

  onProgress?.('자세 인식 모델 로딩 중…');
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: `${base}/mediapipe/models/pose_landmarker_lite.task`,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  onProgress?.('준비 완료');
  return {
    face,
    pose,
    close() {
      face.close();
      pose.close();
      cached = null;
    },
  };
}

export function loadLandmarkers(onProgress?: (msg: string) => void): Promise<Landmarkers> {
  if (!cached) {
    cached = build(onProgress).catch((err) => {
      cached = null;
      throw err;
    });
  }
  return cached;
}
