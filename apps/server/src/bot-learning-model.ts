import {
  LEARNING_FEATURES_V1,
  type LearningExampleV1,
  type LearningLabel,
} from './bot-learning-data.js'
import { LEARNING_FEATURES_V2 } from './bot-learning-data-v2.js'

export const ACTION_LABELS: readonly LearningLabel[] = ['fold', 'check', 'call', 'raise']

export const BOT_LEARNING_TUNING = {
  epochs: 140,
  learningRate: 0.35,
  l2: 0.002,
  identityPriorWeight: 12,
  probabilityFloor: 1e-12,
  calibrationBuckets: 10,
  calibrationEpochs: 90,
  calibrationLearningRate: 0.4,
  calibrationL2: 0.01,
  temperatureFirstStep: 12,
  temperatureLastStep: 36,
  temperatureStepDivisor: 20,
} as const

export interface ActionModelV1 {
  readonly version: 1
  readonly featureSchemaVersion: 1 | 2
  readonly featureNames: readonly string[]
  readonly labels: readonly LearningLabel[]
  readonly weights: readonly (readonly number[])[]
  readonly contextWeights?: {
    readonly free: readonly (readonly number[])[]
    readonly facing: readonly (readonly number[])[]
  }
  readonly trainedExamples: number
  readonly epochs: number
  readonly temperature: number
  readonly calibrationBias?: readonly number[]
}

export interface ActionProbabilities {
  readonly fold: number
  readonly check: number
  readonly call: number
  readonly raise: number
}

export interface ActionMetrics {
  readonly count: number
  readonly logLoss: number
  readonly brier: number
  readonly accuracy: number
  readonly calibrationError: number
  readonly byClass: Readonly<
    Record<
      LearningLabel,
      {
        readonly count: number
        readonly recall: number
        readonly probabilityBrier: number
        readonly probabilityCalibrationError: number
      }
    >
  >
}

export interface ActionEvaluation {
  readonly learned: ActionMetrics
  readonly statistical: ActionMetrics
  readonly logLossImprovement: number
  readonly calibrationImprovement: number
  readonly logLossConfidence95: readonly [number, number] | null
  readonly heldOutHands: number
}

export function trainActionModel(
  examples: readonly LearningExampleV1[],
  tuning: {
    readonly epochs: number
    readonly learningRate: number
    readonly l2: number
  } = BOT_LEARNING_TUNING,
  featureSchemaVersion: 1 | 2 = 1,
): ActionModelV1 {
  if (examples.length === 0) throw new Error('training needs examples')
  if (!Number.isSafeInteger(tuning.epochs) || tuning.epochs < 1) {
    throw new Error('epochs must be positive')
  }
  if (!(tuning.learningRate > 0) || !(tuning.l2 >= 0)) throw new Error('invalid training tuning')
  for (const example of examples) validateExample(example, featureSchemaVersion)

  const featureNames = namesFor(featureSchemaVersion)
  const width = featureNames.length + 1
  const weights = ACTION_LABELS.map(() => Array<number>(width).fill(0))
  for (let epoch = 0; epoch < tuning.epochs; epoch += 1) {
    const gradient = ACTION_LABELS.map(() => Array<number>(width).fill(0))
    for (const example of examples) {
      const probabilities = softmax(weights, example.features, example.legalLabels)
      for (let labelIndex = 0; labelIndex < ACTION_LABELS.length; labelIndex += 1) {
        const label = ACTION_LABELS[labelIndex]
        const row = gradient[labelIndex]
        if (label === undefined || row === undefined || !example.legalLabels.includes(label)) {
          continue
        }
        const error = probabilities[label] - Number(example.label === label)
        row[0] = (row[0] ?? 0) + error
        for (let featureIndex = 0; featureIndex < example.features.length; featureIndex += 1) {
          row[featureIndex + 1] =
            (row[featureIndex + 1] ?? 0) + error * (example.features[featureIndex] ?? 0)
        }
      }
    }
    for (let labelIndex = 0; labelIndex < weights.length; labelIndex += 1) {
      const row = weights[labelIndex]
      const updates = gradient[labelIndex]
      if (row === undefined || updates === undefined) continue
      for (let featureIndex = 0; featureIndex < row.length; featureIndex += 1) {
        const value = row[featureIndex] ?? 0
        const penalty = featureIndex === 0 ? 0 : tuning.l2 * value
        row[featureIndex] =
          value - tuning.learningRate * ((updates[featureIndex] ?? 0) / examples.length + penalty)
      }
    }
  }
  return {
    version: 1,
    featureSchemaVersion,
    featureNames: [...featureNames],
    labels: [...ACTION_LABELS],
    weights,
    trainedExamples: examples.length,
    epochs: tuning.epochs,
    temperature: 1,
  }
}

export function trainContextualActionModel(
  examples: readonly LearningExampleV1[],
  tuning: {
    readonly epochs: number
    readonly learningRate: number
    readonly l2: number
  } = BOT_LEARNING_TUNING,
): ActionModelV1 {
  const facingIndex = LEARNING_FEATURES_V2.indexOf('facing_bet')
  if (facingIndex < 0) throw new Error('context feature missing')
  const free = examples.filter((example) => example.features[facingIndex] === 0)
  const facing = examples.filter((example) => example.features[facingIndex] === 1)
  if (free.length + facing.length !== examples.length) {
    throw new Error('contextual training received invalid facing feature')
  }
  if (free.length === 0 || facing.length === 0) {
    throw new Error('contextual training needs free and facing examples')
  }
  const freeModel = trainActionModel(free, tuning, 2)
  const facingModel = trainActionModel(facing, tuning, 2)
  return {
    ...freeModel,
    contextWeights: { free: freeModel.weights, facing: facingModel.weights },
    trainedExamples: examples.length,
  }
}

export function calibrateActionModel(
  model: ActionModelV1,
  validation: readonly LearningExampleV1[],
): ActionModelV1 {
  validateModel(model)
  if (validation.length === 0) throw new Error('calibration needs validation examples')
  for (const example of validation) validateExample(example, model.featureSchemaVersion)
  let best = model
  let bestLoss = Number.POSITIVE_INFINITY
  for (
    let step = BOT_LEARNING_TUNING.temperatureFirstStep;
    step <= BOT_LEARNING_TUNING.temperatureLastStep;
    step += 1
  ) {
    const temperature = step / BOT_LEARNING_TUNING.temperatureStepDivisor
    const calibrationBias = Array<number>(ACTION_LABELS.length).fill(0)
    for (let epoch = 0; epoch < BOT_LEARNING_TUNING.calibrationEpochs; epoch += 1) {
      const gradient = Array<number>(ACTION_LABELS.length).fill(0)
      for (const example of validation) {
        const probabilities = softmax(
          weightsFor(model, example.features),
          example.features,
          example.legalLabels,
          temperature,
          calibrationBias,
        )
        for (let index = 0; index < ACTION_LABELS.length; index += 1) {
          const label = ACTION_LABELS[index]
          if (label === undefined) continue
          gradient[index] =
            (gradient[index] ?? 0) + probabilities[label] - Number(label === example.label)
        }
      }
      for (let index = 0; index < calibrationBias.length; index += 1) {
        const bias = calibrationBias[index] ?? 0
        calibrationBias[index] =
          bias -
          BOT_LEARNING_TUNING.calibrationLearningRate *
            ((gradient[index] ?? 0) / validation.length + BOT_LEARNING_TUNING.calibrationL2 * bias)
      }
    }
    const candidate = { ...model, temperature, calibrationBias }
    const loss = score(validation, (example) =>
      softmax(
        weightsFor(candidate, example.features),
        example.features,
        example.legalLabels,
        temperature,
        calibrationBias,
      ),
    ).logLoss
    if (loss < bestLoss) {
      best = candidate
      bestLoss = loss
    }
  }
  return best
}

export function predictAction(
  model: ActionModelV1,
  features: readonly number[],
  legalLabels: readonly LearningLabel[],
): ActionProbabilities {
  validateModel(model)
  validateFeatures(features, legalLabels, model.featureSchemaVersion)
  return softmax(
    weightsFor(model, features),
    features,
    legalLabels,
    model.temperature,
    model.calibrationBias,
  )
}

export function evaluateActionModel(
  model: ActionModelV1,
  training: readonly LearningExampleV1[],
  heldOut: readonly LearningExampleV1[],
): ActionEvaluation {
  if (heldOut.length === 0) throw new Error('held-out evaluation needs examples')
  const trainingHands = new Set(training.map((example) => example.handId))
  if (heldOut.some((example) => trainingHands.has(example.handId))) {
    throw new Error('training and held-out hands overlap')
  }
  for (const example of [...training, ...heldOut]) {
    validateExample(example, model.featureSchemaVersion)
  }
  const baseline = frequencyBaseline(training)
  const learned = score(heldOut, (example) =>
    predictAction(model, example.features, example.legalLabels),
  )
  const statistical = score(heldOut, (example) => baseline(example))
  const differenceByHand = new Map<string, { sum: number; count: number }>()
  for (const example of heldOut) {
    const learnedProbability = predictAction(model, example.features, example.legalLabels)[
      example.label
    ]
    const baselineProbability = baseline(example)[example.label]
    const difference =
      Math.log(Math.max(BOT_LEARNING_TUNING.probabilityFloor, learnedProbability)) -
      Math.log(Math.max(BOT_LEARNING_TUNING.probabilityFloor, baselineProbability))
    const hand = differenceByHand.get(example.handId) ?? { sum: 0, count: 0 }
    hand.sum += difference
    hand.count += 1
    differenceByHand.set(example.handId, hand)
  }
  const improvement = statistical.logLoss - learned.logLoss
  const hands = [...differenceByHand.values()]
  const squaredInfluence = hands.reduce(
    (sum, hand) => sum + (hand.sum - improvement * hand.count) ** 2,
    0,
  )
  const uncertainty =
    hands.length < 2
      ? null
      : (1.96 * Math.sqrt((hands.length / (hands.length - 1)) * squaredInfluence)) / heldOut.length
  return {
    learned,
    statistical,
    logLossImprovement: improvement,
    calibrationImprovement: statistical.calibrationError - learned.calibrationError,
    logLossConfidence95:
      uncertainty === null ? null : [improvement - uncertainty, improvement + uncertainty],
    heldOutHands: hands.length,
  }
}

export function scoreActionPredictions(
  examples: readonly LearningExampleV1[],
  predict: (example: LearningExampleV1) => ActionProbabilities,
): ActionMetrics {
  if (examples.length === 0) throw new Error('scoring needs examples')
  return score(examples, predict)
}

export function validateModel(value: unknown): asserts value is ActionModelV1 {
  if (typeof value !== 'object' || value === null) {
    throw new Error('incompatible or invalid action model')
  }
  const model = value as Partial<ActionModelV1>
  const featureSchemaVersion = model.featureSchemaVersion
  if (
    model.version !== 1 ||
    (featureSchemaVersion !== 1 && featureSchemaVersion !== 2) ||
    !Array.isArray(model.featureNames) ||
    model.featureNames.length !== namesFor(featureSchemaVersion).length ||
    model.featureNames.some((name, index) => name !== namesFor(featureSchemaVersion)[index]) ||
    !Array.isArray(model.labels) ||
    model.labels.length !== ACTION_LABELS.length ||
    model.labels.some((label, index) => label !== ACTION_LABELS[index]) ||
    !Number.isFinite(model.temperature) ||
    (model.temperature ?? 0) <= 0 ||
    (model.calibrationBias !== undefined &&
      (!Array.isArray(model.calibrationBias) ||
        model.calibrationBias.length !== ACTION_LABELS.length ||
        model.calibrationBias.some((bias) => !Number.isFinite(bias)))) ||
    !Number.isSafeInteger(model.trainedExamples) ||
    (model.trainedExamples ?? 0) <= 0 ||
    !Number.isSafeInteger(model.epochs) ||
    (model.epochs ?? 0) <= 0 ||
    !validWeights(model.weights, namesFor(featureSchemaVersion).length) ||
    (model.contextWeights !== undefined &&
      (featureSchemaVersion !== 2 ||
        typeof model.contextWeights !== 'object' ||
        model.contextWeights === null ||
        !validWeights(model.contextWeights.free, LEARNING_FEATURES_V2.length) ||
        !validWeights(model.contextWeights.facing, LEARNING_FEATURES_V2.length)))
  ) {
    throw new Error('incompatible or invalid action model')
  }
}

function validateExample(example: LearningExampleV1, featureSchemaVersion: 1 | 2): void {
  validateFeatures(example.features, example.legalLabels, featureSchemaVersion)
  if (!example.legalLabels.includes(example.label)) throw new Error('label must be legal')
  if (!example.handId || !example.actorId) throw new Error('example identity missing')
}

function validateFeatures(
  features: readonly number[],
  legalLabels: readonly LearningLabel[],
  featureSchemaVersion: 1 | 2,
): void {
  if (
    features.length !== namesFor(featureSchemaVersion).length ||
    features.some((feature) => !Number.isFinite(feature) || feature < 0 || feature > 1) ||
    legalLabels.length === 0 ||
    new Set(legalLabels).size !== legalLabels.length ||
    legalLabels.some((label) => !ACTION_LABELS.includes(label))
  ) {
    throw new Error('invalid action features or legal labels')
  }
}

function namesFor(version: 1 | 2): readonly string[] {
  return version === 1 ? LEARNING_FEATURES_V1 : LEARNING_FEATURES_V2
}

function validWeights(weights: unknown, features: number): boolean {
  return (
    Array.isArray(weights) &&
    weights.length === ACTION_LABELS.length &&
    weights.every(
      (row) =>
        Array.isArray(row) &&
        row.length === features + 1 &&
        row.every((weight) => typeof weight === 'number' && Number.isFinite(weight)),
    )
  )
}

function weightsFor(
  model: ActionModelV1,
  features: readonly number[],
): readonly (readonly number[])[] {
  if (model.contextWeights === undefined) return model.weights
  const facingIndex = LEARNING_FEATURES_V2.indexOf('facing_bet')
  const facing = features[facingIndex]
  if (facing !== 0 && facing !== 1) throw new Error('invalid context feature')
  return facing === 1 ? model.contextWeights.facing : model.contextWeights.free
}

function softmax(
  weights: readonly (readonly number[])[],
  features: readonly number[],
  legalLabels: readonly LearningLabel[],
  temperature = 1,
  calibrationBias: readonly number[] = [0, 0, 0, 0],
): ActionProbabilities {
  const scores = ACTION_LABELS.map((label, index) => {
    if (!legalLabels.includes(label)) return Number.NEGATIVE_INFINITY
    const row = weights[index]
    if (row === undefined) throw new Error('model row missing')
    let value = row[0] ?? 0
    for (let featureIndex = 0; featureIndex < features.length; featureIndex += 1) {
      value += (row[featureIndex + 1] ?? 0) * (features[featureIndex] ?? 0)
    }
    return value / temperature + (calibrationBias[index] ?? 0)
  })
  const maximum = Math.max(...scores)
  const exponentials = scores.map((value) => Math.exp(value - maximum))
  const total = exponentials.reduce((sum, value) => sum + value, 0)
  return {
    fold: (exponentials[0] ?? 0) / total,
    check: (exponentials[1] ?? 0) / total,
    call: (exponentials[2] ?? 0) / total,
    raise: (exponentials[3] ?? 0) / total,
  }
}

function frequencyBaseline(training: readonly LearningExampleV1[]) {
  const global = new Map<string, number[]>()
  const byActor = new Map<string, number[]>()
  for (const example of training) {
    const legalKey = [...example.legalLabels].sort().join(',')
    const index = ACTION_LABELS.indexOf(example.label)
    for (const [map, key] of [
      [global, legalKey],
      [byActor, `${example.actorId}:${legalKey}`],
    ] as const) {
      const counts = map.get(key) ?? [0, 0, 0, 0]
      counts[index] = (counts[index] ?? 0) + 1
      map.set(key, counts)
    }
  }
  return (example: LearningExampleV1): ActionProbabilities => {
    const legalKey = [...example.legalLabels].sort().join(',')
    const population = global.get(legalKey) ?? [0, 0, 0, 0]
    const individual = byActor.get(`${example.actorId}:${legalKey}`) ?? [0, 0, 0, 0]
    const populationTotal = population.reduce((sum, count) => sum + count, 0)
    const individualTotal = individual.reduce((sum, count) => sum + count, 0)
    const raw = ACTION_LABELS.map((label, index) => {
      if (!example.legalLabels.includes(label)) return 0
      const populationRate =
        ((population[index] ?? 0) + 1) / (populationTotal + example.legalLabels.length)
      return (individual[index] ?? 0) + BOT_LEARNING_TUNING.identityPriorWeight * populationRate
    })
    const total = individualTotal + BOT_LEARNING_TUNING.identityPriorWeight
    return {
      fold: (raw[0] ?? 0) / total,
      check: (raw[1] ?? 0) / total,
      call: (raw[2] ?? 0) / total,
      raise: (raw[3] ?? 0) / total,
    }
  }
}

function score(
  examples: readonly LearningExampleV1[],
  predict: (example: LearningExampleV1) => ActionProbabilities,
): ActionMetrics {
  let logLoss = 0
  let brier = 0
  let correct = 0
  const classCounts = [0, 0, 0, 0]
  const classHits = [0, 0, 0, 0]
  const classProbabilityErrors = [0, 0, 0, 0]
  const classBuckets = ACTION_LABELS.map(() =>
    Array.from({ length: BOT_LEARNING_TUNING.calibrationBuckets }, () => ({
      count: 0,
      probability: 0,
      actual: 0,
    })),
  )
  const buckets = Array.from({ length: BOT_LEARNING_TUNING.calibrationBuckets }, () => ({
    count: 0,
    confidence: 0,
    correct: 0,
  }))
  for (const example of examples) {
    const probabilities = predict(example)
    logLoss -= Math.log(
      Math.max(BOT_LEARNING_TUNING.probabilityFloor, probabilities[example.label]),
    )
    let predicted: LearningLabel = ACTION_LABELS[0] ?? 'fold'
    for (let index = 0; index < ACTION_LABELS.length; index += 1) {
      const label = ACTION_LABELS[index]
      if (label === undefined) continue
      const actual = Number(example.label === label)
      const squaredError = (probabilities[label] - actual) ** 2
      brier += squaredError / ACTION_LABELS.length
      classProbabilityErrors[index] = (classProbabilityErrors[index] ?? 0) + squaredError
      const classBucket =
        classBuckets[index]?.[
          Math.min(
            BOT_LEARNING_TUNING.calibrationBuckets - 1,
            Math.floor(probabilities[label] * BOT_LEARNING_TUNING.calibrationBuckets),
          )
        ]
      if (classBucket !== undefined) {
        classBucket.count += 1
        classBucket.probability += probabilities[label]
        classBucket.actual += actual
      }
      if (probabilities[label] > probabilities[predicted]) predicted = label
    }
    const hit = Number(predicted === example.label)
    correct += hit
    const actualIndex = ACTION_LABELS.indexOf(example.label)
    classCounts[actualIndex] = (classCounts[actualIndex] ?? 0) + 1
    classHits[actualIndex] = (classHits[actualIndex] ?? 0) + hit
    const confidence = probabilities[predicted]
    const bucket = buckets[Math.min(buckets.length - 1, Math.floor(confidence * buckets.length))]
    if (bucket !== undefined) {
      bucket.count += 1
      bucket.confidence += confidence
      bucket.correct += hit
    }
  }
  return {
    count: examples.length,
    logLoss: logLoss / examples.length,
    brier: brier / examples.length,
    accuracy: correct / examples.length,
    calibrationError: buckets.reduce(
      (sum, bucket) =>
        sum +
        (bucket.count / examples.length) *
          Math.abs((bucket.confidence - bucket.correct) / Math.max(1, bucket.count)),
      0,
    ),
    byClass: Object.fromEntries(
      ACTION_LABELS.map((label, index) => [
        label,
        {
          count: classCounts[index] ?? 0,
          recall: (classHits[index] ?? 0) / Math.max(1, classCounts[index] ?? 0),
          probabilityBrier: (classProbabilityErrors[index] ?? 0) / examples.length,
          probabilityCalibrationError:
            classBuckets[index]?.reduce(
              (sum, bucket) =>
                sum +
                (bucket.count / examples.length) *
                  Math.abs((bucket.probability - bucket.actual) / Math.max(1, bucket.count)),
              0,
            ) ?? 0,
        },
      ]),
    ) as ActionMetrics['byClass'],
  }
}
