import type {
  RecognitionMode,
  SignRecognitionResult,
  SignRecognizer,
} from './sign-recognition.types';

type VisionModule = typeof import('@mediapipe/tasks-vision');
const loadVisionModule = new Function('url', 'return import(url)') as (url: string) => Promise<VisionModule>;

type ForestTree = {
  left: number[];
  right: number[];
  feature: number[];
  threshold: number[];
  probabilityOffsets: number[];
  leafProbabilities: number[];
};

type ForestModel = {
  format: number;
  labels: string[];
  featureCount: number;
  classCount: number;
  trees: ForestTree[];
};

type FrameFeatures = {
  shape: number[];
  wristX: number;
  wristY: number;
};

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm';
const MODEL_ROOT = '/models';
const SEQUENCE_LENGTH = 20;
const SEQUENCE_SKIP = 5;
let visionResourcesPromise: Promise<{
  vision: VisionModule;
  fileset: Awaited<ReturnType<VisionModule['FilesetResolver']['forVisionTasks']>>;
  wordModel: ForestModel;
  numberModel: ForestModel;
  sequenceModel: ForestModel;
}> | null = null;

function loadVisionResources() {
  if (!visionResourcesPromise) {
    visionResourcesPromise = (async () => {
      const vision = await loadVisionModule(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs',
      );
      const [fileset, wordModel, numberModel, sequenceModel] = await Promise.all([
        vision.FilesetResolver.forVisionTasks(WASM_ROOT),
        loadCompressedModel('sign-model.json.gz'),
        loadCompressedModel('number-model.json.gz'),
        loadCompressedModel('sequence-model.json.gz'),
      ]);
      return { vision, fileset, wordModel, numberModel, sequenceModel };
    })().catch((error: unknown) => {
      visionResourcesPromise = null;
      throw error;
    });
  }
  return visionResourcesPromise;
}

async function loadCompressedModel(filename: string): Promise<ForestModel> {
  const response = await fetch(`${MODEL_ROOT}/${filename}`);
  if (!response.ok || !response.body) {
    throw new Error(`Could not load the on-device sign model (${response.status}).`);
  }

  if (!('DecompressionStream' in window)) {
    throw new Error('This browser does not support compressed on-device sign models.');
  }

  const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
  const model = (await new Response(decompressed).json()) as ForestModel;
  if (model.format !== 1 || !Array.isArray(model.trees) || !Array.isArray(model.labels)) {
    throw new Error(`The on-device sign model ${filename} has an unsupported format.`);
  }
  return model;
}

function predictForest(model: ForestModel, features: number[]): { label: string; confidence: number } {
  if (features.length !== model.featureCount) {
    throw new Error(`The sign model expected ${model.featureCount} features, received ${features.length}.`);
  }

  const probabilities = new Array<number>(model.classCount).fill(0);
  for (const tree of model.trees) {
    let node = 0;
    while (tree.left[node] !== -1) {
      const featureIndex = tree.feature[node];
      node = features[featureIndex] <= tree.threshold[node] ? tree.left[node] : tree.right[node];
    }

    const offset = tree.probabilityOffsets[node];
    if (offset < 0) continue;
    for (let classIndex = 0; classIndex < model.classCount; classIndex += 1) {
      probabilities[classIndex] += tree.leafProbabilities[offset + classIndex];
    }
  }

  const inverseTreeCount = 1 / model.trees.length;
  let predictedClass = 0;
  for (let classIndex = 0; classIndex < probabilities.length; classIndex += 1) {
    probabilities[classIndex] *= inverseTreeCount;
    if (probabilities[classIndex] > probabilities[predictedClass]) predictedClass = classIndex;
  }

  return {
    label: model.labels[predictedClass] ?? String(predictedClass),
    confidence: probabilities[predictedClass] ?? 0,
  };
}

function normalizedHand(points: { x: number; y: number }[]): number[] {
  const baseX = 1 - points[0].x;
  const baseY = points[0].y;
  return points.flatMap((point) => [1 - point.x - baseX, point.y - baseY]);
}

function frameFeatures(points: { x: number; y: number }[]): FrameFeatures {
  return {
    shape: normalizedHand(points),
    wristX: 1 - points[0].x,
    wristY: points[0].y,
  };
}

function sequenceFeatures(frames: FrameFeatures[]): number[] {
  const wristsX = frames.map((frame) => frame.wristX);
  const wristsY = frames.map((frame) => frame.wristY);
  const count = frames.length;
  const totalDx = wristsX[count - 1] - wristsX[0];
  const totalDy = wristsY[count - 1] - wristsY[0];
  let pathLength = 0;
  const dxs: number[] = [];
  const dys: number[] = [];

  for (let index = 1; index < count; index += 1) {
    const dx = wristsX[index] - wristsX[index - 1];
    const dy = wristsY[index] - wristsY[index - 1];
    dxs.push(dx);
    dys.push(dy);
    pathLength += Math.hypot(dx, dy);
  }

  const meanX = wristsX.reduce((sum, value) => sum + value, 0) / count;
  const meanY = wristsY.reduce((sum, value) => sum + value, 0) / count;
  const varianceX = wristsX.reduce((sum, value) => sum + (value - meanX) ** 2, 0) / count;
  const varianceY = wristsY.reduce((sum, value) => sum + (value - meanY) ** 2, 0) / count;
  const reversalsX = dxs.slice(1).filter((value, index) => value * dxs[index] < 0).length;
  const reversalsY = dys.slice(1).filter((value, index) => value * dys[index] < 0).length;
  const trajectory = [
    totalDx,
    totalDy,
    pathLength,
    Math.atan2(totalDy, totalDx) / Math.PI,
    varianceX,
    varianceY,
    reversalsX,
    reversalsY,
  ];

  const startShape = frames[0].shape;
  const endShape = frames[count - 1].shape;
  const meanShape = startShape.map((_, featureIndex) =>
    frames.reduce((sum, frame) => sum + frame.shape[featureIndex], 0) / count,
  );
  const tipDisplacements = [4, 8, 12, 16, 20].flatMap((tipIndex) => {
    const featureIndex = tipIndex * 2;
    return [
      endShape[featureIndex] - startShape[featureIndex],
      endShape[featureIndex + 1] - startShape[featureIndex + 1],
    ];
  });

  return [...trajectory, ...startShape, ...endShape, ...meanShape, ...tipDisplacements];
}

async function createLandmarker(
  vision: VisionModule,
  fileset: Awaited<ReturnType<VisionModule['FilesetResolver']['forVisionTasks']>>,
) {
  const modelAssetPath = new URL(`${MODEL_ROOT}/hand_landmarker.task`, window.location.origin).toString();
  const baseOptions = { modelAssetPath };

  try {
    return await vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch {
    return vision.HandLandmarker.createFromOptions(fileset, {
      baseOptions: { ...baseOptions, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
}

export async function createSignRecognizer(): Promise<SignRecognizer> {
  const { vision, fileset, wordModel, numberModel, sequenceModel } = await loadVisionResources();
  const landmarker = await createLandmarker(vision, fileset);
  let currentMode: RecognitionMode | null = null;
  let sequenceBuffer: FrameFeatures[] = [];
  let frameCounter = 0;
  let dynamicCache: { label: string | null; confidence: number } = { label: null, confidence: 0 };

  const resetSequence = () => {
    sequenceBuffer = [];
    frameCounter = 0;
    dynamicCache = { label: null, confidence: 0 };
  };

  const predict = (video: HTMLVideoElement, mode: RecognitionMode): SignRecognitionResult => {
    if (currentMode !== mode) {
      currentMode = mode;
      resetSequence();
    }

    const result = landmarker.detectForVideo(video, performance.now());
    const hands = result.landmarks;
    if (hands.length === 0) {
      resetSequence();
      return { hand_count: 0, sign: 'No Hand', confidence: 0 };
    }

    const features = hands.flatMap(normalizedHand);
    const paddedFeatures = [...features];
    while (paddedFeatures.length < 84) paddedFeatures.push(0);
    const selectedModel = mode === 'numbers' ? numberModel : wordModel;
    const staticPrediction = predictForest(selectedModel, paddedFeatures.slice(0, 84));

    if (mode === 'numbers') {
      return {
        hand_count: hands.length,
        sign: staticPrediction.label,
        confidence: Math.round(staticPrediction.confidence * 100),
      };
    }

    let staticLabel = staticPrediction.label;
    let staticConfidence = staticPrediction.confidence;
    if (hands.length > 1 && staticLabel === 'my') {
      staticLabel = 'No Hand';
      staticConfidence = 0;
    }

    sequenceBuffer.push(frameFeatures(hands[0]));
    if (sequenceBuffer.length > SEQUENCE_LENGTH) sequenceBuffer.shift();
    frameCounter += 1;

    if (sequenceBuffer.length === SEQUENCE_LENGTH && frameCounter % SEQUENCE_SKIP === 0) {
      let motion = 0;
      for (let index = 1; index < sequenceBuffer.length; index += 1) {
        motion += Math.hypot(
          sequenceBuffer[index].wristX - sequenceBuffer[index - 1].wristX,
          sequenceBuffer[index].wristY - sequenceBuffer[index - 1].wristY,
        );
      }

      if (motion > 0.04) {
        const dynamicPrediction = predictForest(sequenceModel, sequenceFeatures(sequenceBuffer));
        dynamicCache = dynamicPrediction;
      } else {
        dynamicCache = { label: null, confidence: 0 };
      }
    }

    if (
      dynamicCache.label !== null &&
      dynamicCache.confidence > staticConfidence + 0.7
    ) {
      return {
        hand_count: hands.length,
        sign: dynamicCache.label,
        confidence: Math.round(dynamicCache.confidence * 100),
      };
    }

    return {
      hand_count: hands.length,
      sign: staticLabel,
      confidence: Math.round(staticConfidence * 100),
    };
  };

  return {
    predict,
    close: () => landmarker.close(),
  };
}
