export interface AppSettings {
  // Display Settings
  jobsPerPage: number;
  defaultView: 'unread' | 'read' | 'all';
  defaultSort: 'none' | 'date-desc' | 'date-asc' | 'title-asc' | 'title-desc' | 'company-asc';
  theme: 'light' | 'dark' | 'auto';

  // Extension Settings
  autoFetchDescriptions: boolean;

  // Email Fetching Settings
  customSenders: string[];
  defaultAutoArchive: boolean;

  // Job Management
  autoMarkReadAfterDays: number; // 0 = never
  autoDeleteAfterDays: number; // 0 = never
  resumeText: string;

  // Badge Settings
  badgeVisibility: {
    responsibilities: boolean;
    qualifications: boolean;
    skills: boolean;
    benefits: boolean;
  };
  customBadges: {
    responsibilities: string[];
    qualifications: string[];
    skills: string[];
    benefits: string[];
  };
  autoSuggestBadges: boolean;

  // AI Settings
  aiProvider: 'openai' | 'anthropic' | 'gemini' | 'none';
  aiApiKey: string;
  aiApiKeys: { gemini: string; openai: string; anthropic: string };
  aiModel: string;
  aiProxyUrl: string;
  aiSuggestionMode: 'predefined' | 'creative';

  // Resume Tailoring Settings
  tailorTone: 'professional' | 'casual' | 'executive' | 'technical';
  tailorLength: 'same' | 'concise' | 'detailed';
  tailorCustomInstructions: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  jobsPerPage: 20,
  defaultView: 'unread',
  defaultSort: 'none',
  theme: 'light',
  autoFetchDescriptions: false,
  customSenders: [],
  defaultAutoArchive: false,
  autoMarkReadAfterDays: 0,
  autoDeleteAfterDays: 0,
  resumeText: '',
  badgeVisibility: {
    responsibilities: true,
    qualifications: true,
    skills: true,
    benefits: true,
  },
  customBadges: {
    responsibilities: [],
    qualifications: [],
    skills: [],
    benefits: [],
  },
  autoSuggestBadges: false,
  aiProvider: 'none',
  aiApiKey: '',
  aiApiKeys: { gemini: '', openai: '', anthropic: '' },
  aiModel: '',
  aiProxyUrl: '',
  aiSuggestionMode: 'predefined',
  tailorTone: 'professional',
  tailorLength: 'same',
  tailorCustomInstructions: '',
};
