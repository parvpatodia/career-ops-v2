/**
 * The single canonical list of recognized technical skills.
 * WHY: this constant used to live inline in JobParser; the M6 KeywordExtractor
 * needs the same vocabulary. Per the engineering standard (domain constants in
 * exactly one module), it lives here and both importers share it, so the two
 * can never drift apart.
 */
export const SKILL_PATTERNS: readonly string[] = [
  'Python', 'PyTorch', 'TensorFlow', 'JavaScript', 'TypeScript', 'C++', 'Java',
  'React', 'FastAPI', 'Django', 'Node.js', 'Go', 'Rust', 'SQL', 'Postgres',
  'MySQL', 'MongoDB', 'Redis', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
  'Git', 'Linux', 'CUDA', 'OpenCV', 'scikit-learn', 'Pandas', 'NumPy',
  'Transformers', 'LangChain', 'RAG', 'LLM', 'RLHF', 'fine-tuning', 'MLflow',
  'MediaPipe', 'YOLO', 'Detectron', 'ViT', 'BERT', 'GPT', 'diffusion models',
  'computer vision', 'NLP', 'deep learning', 'machine learning', 'reinforcement learning',
  'multi-agent', 'robotics', 'ROS', 'SLAM', 'point cloud', 'LiDAR',
];
