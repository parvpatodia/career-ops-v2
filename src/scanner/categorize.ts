/**
 * Buckets a role into a coarse category for the command-center UI (M8 F4), so
 * the fresh-roles feed can group by "AI/ML", "Robotics/AV", "Data", "Software",
 * or "Other". Pure + first-match-wins: order matters (a "ML platform engineer"
 * is AI/ML, not Software). Title is the primary signal; the JD is a fallback.
 */
export type RoleCategory = 'AI/ML' | 'Robotics/AV' | 'Data' | 'Software' | 'Other';

const RULES: Array<[RoleCategory, RegExp]> = [
  ['Robotics/AV', /(robotic|robot|autonom|self-?driving|\bav\b|perception|slam|motion planning|controls engineer|manipulation|drone|humanoid)/i],
  ['AI/ML', /(machine learning|\bml\b|\bai\b|artificial intelligence|deep learning|computer vision|\bcv\b|\bnlp\b|\bllm\b|generative|research (scientist|engineer)|applied scien|ml(ops| infra| platform)|model|neural)/i],
  ['Data', /(data scien|data engineer|data analyst|analytics|\betl\b|data platform|business intelligence|\bbi\b)/i],
  ['Software', /(software engineer|\bswe\b|software developer|full[- ]stack|front[- ]?end|back[- ]?end|platform engineer|infrastructure|systems engineer|developer|programmer)/i],
];

export function categorize(title: string, jd = ''): RoleCategory {
  const hay = `${title ?? ''} ${jd ?? ''}`;
  for (const [cat, re] of RULES) {
    if (re.test(hay)) return cat;
  }
  return 'Other';
}
