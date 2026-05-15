export interface BadgeSuggestions {
  responsibilities: string[];
  qualifications: string[];
  skills: string[];
  benefits: string[];
}

export interface AIJobContext {
  title: string;
  company: string;
  type: string;
  tags: string[];
  location: string;
}

export interface TailorQualification {
  requirement: string;
  match: string | null;
  isSuggestion: boolean;
  note?: string;
  suggestions: string[];
  readySentence?: string | null;
  include: boolean;
}

export interface TailorBullet {
  text: string;       // original text from resume
  tailored: string;   // AI-tailored version
  keywords: string[]; // job keywords matched by this bullet
  matchLevel: 'full' | 'partial' | 'none';
  isSuggestion: boolean;
  include: boolean;
}

export interface TailorExperience {
  company: string;
  title: string;
  period: string;
  location: string;
  bullets: TailorBullet[];
  include?: boolean;
}

export interface TailorSkill {
  name: string;
  category: string;
  fromResume: boolean;
  isSuggestion: boolean;
  note?: string;
  include: boolean;
}

export interface CustomSectionEntry {
  fields: Record<string, string>;
  include: boolean;
}

export interface CustomSection {
  id: string;
  type: string;
  title: string;
  entries: CustomSectionEntry[];
  include: boolean;
}

export interface TailorEducation {
  program: string;
  school: string;
  location: string;
  startDate: string;
  endDate: string;
}

export interface TailorAnalysis {
  candidateName: string;
  contactInfo: string[];
  originalSummary: string;
  summary: string;
  atsScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  tips: string[];
  qualifications: TailorQualification[];
  experience: TailorExperience[];
  skills: TailorSkill[];
  education: TailorEducation[];
  customSections: CustomSection[];
}

export interface AnalyzeTailorResult {
  analysis: TailorAnalysis | null;
  error: string | null;
}
