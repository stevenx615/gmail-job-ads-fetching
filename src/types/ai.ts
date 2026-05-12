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
  bullets: TailorBullet[];
}

export interface TailorSkill {
  name: string;
  fromResume: boolean;
  isSuggestion: boolean;
  note?: string;
  include: boolean;
}

export interface TailorOtherItem {
  text: string;
  include: boolean;
}

export interface TailorOtherSection {
  title: string;
  items: TailorOtherItem[];
}

export interface TailorAnalysis {
  candidateName: string;
  summary: string;
  atsScore: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  tips: string[];
  qualifications: TailorQualification[];
  experience: TailorExperience[];
  skills: TailorSkill[];
  education: string[];
  other: TailorOtherSection[];
}

export interface AnalyzeTailorResult {
  analysis: TailorAnalysis | null;
  error: string | null;
}
