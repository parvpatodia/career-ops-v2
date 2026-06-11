/**
 * Classifies a job into the right resume variant using keyword matching.
 * WHY: No Claude API call needed — keyword matching is fast, free, and
 * deterministic. Variant selection is about category, not nuance.
 */

import type { ResumeVariant } from '../types.js';

const KEYWORDS: Record<ResumeVariant, string[]> = {
  robotics: [
    'robot', 'robotics', 'autonomous vehicle', 'self-driving', 'lidar', 'ros',
    'navigation', 'hardware', 'embedded', 'sensor fusion', 'slam', 'actuator',
    'mechatronics', 'motion planning', 'manipulation', 'drone', 'uav',
  ],
  ml: [
    'machine learning', 'deep learning', 'nlp', 'natural language', 'llm',
    'large language model', 'model training', 'model inference', 'transformer',
    'fine-tuning', 'rlhf', 'research scientist', 'ml research', 'data science',
    'applied scientist', 'foundation model',
  ],
  ai: [
    'artificial intelligence', 'computer vision', 'generative ai', 'gen ai',
    'ai engineer', 'ai agent', 'multimodal', 'image recognition', 'object detection',
    'pose estimation', 'langchain', 'rag', 'vector', 'embedding',
  ],
  ta: [
    'teaching assistant', 'teaching associate', 'course instructor', 'curriculum',
    'grader', 'tutor', 'education', 'academic', 'research assistant',
  ],
  master: [], // fallback
};

export class VariantClassifier {
  classify(title: string, jd: string): ResumeVariant {
    const text = `${title} ${jd}`.toLowerCase();

    // Check in priority order: robotics > ta > ml > ai > master
    for (const variant of ['robotics', 'ta', 'ml', 'ai'] as ResumeVariant[]) {
      if (KEYWORDS[variant].some((kw) => text.includes(kw))) {
        return variant;
      }
    }
    return 'master';
  }
}
