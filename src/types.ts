/** Shared types for the career-ops pipeline. */

export type ResumeVariant = 'master' | 'ai' | 'ml' | 'robotics' | 'ta';

export type ApplicationStatus =
  | 'Ready'
  | 'Evaluated'
  | 'Applied'
  | 'Responded'
  | 'Interview'
  | 'Offer'
  | 'Rejected'
  | 'Discarded'
  | 'Closed'
  | 'SKIP';

export type Platform = 'linkedin' | 'wellfound' | 'handshake' | 'swelist' | 'newgrad' | 'googlejobs' | 'greenhouse' | 'direct';

export interface Job {
  id: string;
  title: string;
  company: string;
  url: string;
  platform: Platform;
  location: string;
  remote: boolean;
  postedAt: string;        // ISO date string
  discoveredAt: string;    // ISO date string
  jd: string;              // full job description text
  score?: number;
  status: 'discovered' | 'evaluated' | 'tailored' | 'applied';
  applyUrl?: string;
  sponsorshipMentioned?: boolean;
}

export interface ScanQuery {
  keywords?: string[];
  location?: string;
  postedWithinDays?: number;
  jobTypes?: ('internship' | 'full-time' | 'part-time' | 'co-op')[];
  remote?: boolean;
}

export interface EvaluationBreakdown {
  skillMatch: number;
  experienceMatch: number;
  locationMatch: number;
  visaMatch: number;
  companySignal: number;
  timingMatch: number;
}

export interface EvaluationResult {
  jobId: string;
  score: number;           // 0-100
  breakdown: EvaluationBreakdown;
  reasoning: string;
  resumeVariant: ResumeVariant;
  topMatchingSkills: string[];
  missingSkills: string[];
  shouldApply: boolean;
  shouldGenerateCoverLetter: boolean;
  evaluatedAt: string;
}

export interface KeywordInjection {
  keyword: string;
  location: string;        // e.g., "Laksh.ai bullet 3"
  reason: string;          // why this keyword matters for ATS/recruiter
}

export interface TailoringResult {
  jobId: string;
  resumeVariant: ResumeVariant;
  injectedKeywords: KeywordInjection[];
  tailoredResumePath: string;   // path to the .md file
  pdfPath?: string;
  coverLetterPath?: string;
  tailoredAt: string;
}

export interface Application {
  id: string;              // sequential 3-digit zero-padded
  jobId: string;
  date: string;            // YYYY-MM-DD
  company: string;
  role: string;
  score: number;
  url: string;
  status: ApplicationStatus;
  resumeVariant: ResumeVariant;
  pdfPath?: string;
  coverLetterPath?: string;
  notes: string;
  tailoredAt?: string;
  appliedAt?: string;
}

export interface DailyLog {
  date: string;
  scanned: Job[];
  evaluated: EvaluationResult[];
  applied: string[];       // job IDs
  tokenUsage: Record<string, number>;
}

export interface Stats {
  period: 'today' | 'week' | 'month' | 'all';
  totalApplications: number;
  byStatus: Record<ApplicationStatus, number>;
  byPlatform: Record<Platform, number>;
  byResumeVariant: Record<ResumeVariant, number>;
  conversionRate: {
    appliedToResponse: number;
    responseToInterview: number;
    interviewToOffer: number;
  };
  averageScore: number;
  topCompanies: Array<{ company: string; count: number }>;
}
