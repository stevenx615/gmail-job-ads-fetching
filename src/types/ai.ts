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
