/**
 * ASL Alphabet Classifier
 * 
 * Uses a trained TensorFlow.js model to classify hand landmarks into ASL letters.
 * The model takes 21 hand landmarks (63 features) and outputs probabilities for 26 letters.
 */
import * as tf from '@tensorflow/tfjs'
import type { Landmark } from './types'

// ASL Alphabet labels (A-Z)
export const ASL_LABELS = [
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J',
  'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T',
  'U', 'V', 'W', 'X', 'Y', 'Z'
]

export interface ClassificationResult {
  prediction: string | null
  confidence: number
  topK: Array<{ label: string; confidence: number }>
  allProbabilities: Record<string, number>
}

export class ASLClassifier {
  private model: tf.LayersModel | null = null
  private isLoading = false
  private isReady = false

  /**
   * Load the trained model from a URL or local path
   */
  async loadModel(modelUrl: string = '/models/asl_classifier/model.json'): Promise<void> {
    if (this.isLoading || this.isReady) return

    this.isLoading = true
    console.log('[ASLClassifier] Loading model from:', modelUrl)

    try {
      this.model = await tf.loadLayersModel(modelUrl)
      this.isReady = true
      console.log('[ASLClassifier] Model loaded successfully')
      
      // Warm up the model with a dummy prediction
      const dummyInput = tf.zeros([1, 63])
      const warmup = this.model.predict(dummyInput) as tf.Tensor
      warmup.dispose()
      dummyInput.dispose()
      console.log('[ASLClassifier] Model warmed up')
    } catch (error) {
      console.error('[ASLClassifier] Failed to load model:', error)
      this.isReady = false
    } finally {
      this.isLoading = false
    }
  }

  /**
   * Check if the model is ready for inference
   */
  getIsReady(): boolean {
    return this.isReady
  }

  /**
   * Preprocess landmarks for the model
   * - Flatten 21 landmarks × 3 coords = 63 features
   * - Normalize relative to wrist position and hand size
   */
  preprocessLandmarks(landmarks: Landmark[]): Float32Array | null {
    if (!landmarks || landmarks.length !== 21) {
      return null
    }

    // Get wrist position as origin
    const wrist = landmarks[0]
    
    // Calculate hand scale (wrist to middle finger MCP distance)
    const middleMcp = landmarks[9]
    const scale = Math.sqrt(
      Math.pow(middleMcp.x - wrist.x, 2) +
      Math.pow(middleMcp.y - wrist.y, 2) +
      Math.pow(middleMcp.z - wrist.z, 2)
    ) || 1

    // Normalize landmarks relative to wrist and scale
    const features = new Float32Array(63)
    for (let i = 0; i < 21; i++) {
      const lm = landmarks[i]
      features[i * 3 + 0] = (lm.x - wrist.x) / scale
      features[i * 3 + 1] = (lm.y - wrist.y) / scale
      features[i * 3 + 2] = lm.z / scale
    }

    return features
  }

  /**
   * Classify hand landmarks into an ASL letter
   */
  async classify(landmarks: Landmark[]): Promise<ClassificationResult> {
    // Default result for when classification isn't possible
    const defaultResult: ClassificationResult = {
      prediction: null,
      confidence: 0,
      topK: [],
      allProbabilities: {}
    }

    if (!this.isReady || !this.model) {
      return defaultResult
    }

    // Preprocess landmarks
    const features = this.preprocessLandmarks(landmarks)
    if (!features) {
      return defaultResult
    }

    // Run inference
    const inputTensor = tf.tensor2d([Array.from(features)], [1, 63])
    const outputTensor = this.model.predict(inputTensor) as tf.Tensor
    const probabilities = await outputTensor.data()

    // Clean up tensors
    inputTensor.dispose()
    outputTensor.dispose()

    // Find top predictions
    const indexed = Array.from(probabilities).map((prob, idx) => ({
      label: ASL_LABELS[idx],
      confidence: prob
    }))
    indexed.sort((a, b) => b.confidence - a.confidence)

    // Build result
    const topK = indexed.slice(0, 5)
    const allProbabilities: Record<string, number> = {}
    indexed.forEach(item => {
      allProbabilities[item.label] = item.confidence
    })

    return {
      prediction: topK[0]?.label || null,
      confidence: topK[0]?.confidence || 0,
      topK,
      allProbabilities
    }
  }

  /**
   * Dispose of the model and free memory
   */
  dispose(): void {
    if (this.model) {
      this.model.dispose()
      this.model = null
    }
    this.isReady = false
    console.log('[ASLClassifier] Disposed')
  }
}

// Singleton instance
let classifierInstance: ASLClassifier | null = null

export function getASLClassifier(): ASLClassifier {
  if (!classifierInstance) {
    classifierInstance = new ASLClassifier()
  }
  return classifierInstance
}

export function disposeASLClassifier(): void {
  if (classifierInstance) {
    classifierInstance.dispose()
    classifierInstance = null
  }
}

