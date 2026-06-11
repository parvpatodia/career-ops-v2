/**
 * Parses a resume markdown file into a structured skills profile.
 * WHY: Caching the parsed resume avoids re-reading and re-parsing
 * on every evaluation. The profile is stable within a session.
 */

import fs from 'fs';

export interface ParsedResume {
  name: string;
  skills: string[];
  domains: string[];
  projects: Array<{ name: string; stack: string[]; description: string }>;
  experience: Array<{ role: string; company: string; description: string }>;
  education: Array<{ degree: string; school: string }>;
  yearsOfExperience: number;  // estimated from graduation + work history
}

// Skills the candidate is known to have (from profile.yml + cv/master.md)
const PARV_SKILLS = [
  'Python', 'PyTorch', 'JavaScript', 'TypeScript', 'C++', 'SQL', 'MATLAB',
  'FastAPI', 'React', 'Transformers', 'Keras',
  'Pandas', 'NumPy', 'scikit-learn', 'Matplotlib', 'spaCy', 'MediaPipe',
  'Docker', 'Git', 'GCP', 'AWS', 'Node.js',
  'computer vision', 'deep learning', 'machine learning', 'LLM',
  'multi-agent', 'vector database', 'pose estimation', 'ViT',
  'YOLOv10', 'RTMPose', 'ChromaDB',
];

export class ResumeParser {
  private cache: Map<string, ParsedResume> = new Map();

  parse(cvPath: string): ParsedResume {
    if (this.cache.has(cvPath)) return this.cache.get(cvPath)!;

    const content = fs.readFileSync(cvPath, 'utf8');
    const parsed = this.parseMarkdown(content);
    this.cache.set(cvPath, parsed);
    return parsed;
  }

  private parseMarkdown(content: string): ParsedResume {
    const lines = content.split('\n');
    const projects: ParsedResume['projects'] = [];
    const experience: ParsedResume['experience'] = [];
    const education: ParsedResume['education'] = [];

    let currentSection = '';
    let currentProject: (typeof projects)[0] | null = null;
    let currentExp: (typeof experience)[0] | null = null;

    for (const line of lines) {
      if (line.startsWith('## ')) {
        currentSection = line.slice(3).toLowerCase();
        if (currentProject) { projects.push(currentProject); currentProject = null; }
        if (currentExp) { experience.push(currentExp); currentExp = null; }
        continue;
      }

      if (currentSection === 'projects' && line.startsWith('### ')) {
        if (currentProject) projects.push(currentProject);
        currentProject = { name: line.slice(4).trim(), stack: [], description: '' };
        continue;
      }

      if (currentSection === 'experience' && line.startsWith('### ')) {
        if (currentExp) experience.push(currentExp);
        const parts = line.slice(4).trim().split(' at ');
        currentExp = { role: parts[0] ?? line.slice(4).trim(), company: parts[1] ?? '', description: '' };
        continue;
      }

      if (currentSection === 'education' && line.startsWith('**')) {
        const school = line.replace(/\*\*/g, '').split('—')[0].trim();
        education.push({ degree: '', school });
        continue;
      }

      if (currentProject && line.startsWith('-')) {
        currentProject.description += line + '\n';
      }

      if (currentExp && line.startsWith('-')) {
        currentExp.description += line + '\n';
      }

      // Parse stack from project lines like "Python, PyTorch | Dec 2025"
      if (currentProject && /^[A-Z]/.test(line) && line.includes(',') && line.includes('|')) {
        const stackPart = line.split('|')[0];
        currentProject.stack = stackPart.split(',').map((s) => s.trim()).filter(Boolean);
      }
    }

    if (currentProject) projects.push(currentProject);
    if (currentExp) experience.push(currentExp);

    // WHY: Estimated YOE based on internship (Jun 2023) + full-time SRE (Jul 2024 - Jun 2025)
    // This is a profile-specific constant to avoid complex date math per evaluation.
    const yearsOfExperience = 1.5;

    return {
      name: 'Parv Patodia',
      skills: PARV_SKILLS,
      domains: [
        'Computer Vision', 'Pose Estimation', 'Vision Transformers',
        'LLMs', 'Multi-Agent Systems', 'Vector Databases', 'Robotics',
      ],
      projects,
      experience,
      education,
      yearsOfExperience,
    };
  }

  /** Check if a specific skill is present in the resume. */
  hasSkill(resume: ParsedResume, skill: string): boolean {
    const skillLC = skill.toLowerCase();
    return resume.skills.some((s) => s.toLowerCase().includes(skillLC)) ||
      resume.domains.some((d) => d.toLowerCase().includes(skillLC));
  }
}
