export function cleanUrl(url: string): string {
  try {
    const decoded = url.replace(/&amp;/g, '&');
    const urlObj = new URL(decoded);
    urlObj.searchParams.delete('utm_source');
    urlObj.searchParams.delete('utm_medium');
    urlObj.searchParams.delete('utm_campaign');
    urlObj.searchParams.delete('utm_content');
    urlObj.searchParams.delete('utm_term');
    return urlObj.toString();
  } catch {
    return url;
  }
}

export function cleanText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TYPE_KEYWORDS: Record<string, string[]> = {
  developer: [
    'developer', 'software engineer', 'software dev', 'full stack', 'fullstack',
    'frontend', 'front-end', 'front end engineer', 'backend', 'back-end',
    'web developer', 'web development', 'mobile developer',
    'react', 'angular', 'vue', 'node', 'python',
    'java developer', '.net', 'devops', 'cloud engineer', 'sre',
    'data engineer', 'ml engineer', 'ai engineer', 'ai architect',
    'cyber security engineer', 'security engineer', 'vdi engineer',
    'software implementation', 'développeur',
    'computer engineer',
  ],
  'game-dev': [
    'game developer', 'game designer', 'game programmer', 'unity', 'unreal',
    'game artist', 'game producer', 'game dev',
  ],
  designer: [
    'ui designer', 'ux designer', 'ui/ux', 'graphic designer', 'visual designer',
    'product designer', 'web designer', 'interaction designer',
  ],
  'it-support': [
    'it support', 'help desk', 'helpdesk', 'system admin', 'sysadmin',
    'network admin', 'network manager', 'network security',
    'it technician', 'desktop support', 'it specialist', 'it analyst',
    'it admin', 'it summer', 'it systems', 'it /',
    'junior it',
    'service desk', 'application support', 'computer support',
    'computer operator', 'computer network',
    'technical support', 'technology support', 'support specialist',
    'information technology', 'ict systems', 'ingénierie des systèmes tic',
    'technologies de l\'informatique',
    'identity and access',
  ],
  'data-entry': [
    'data entry', 'data administrator',
  ],
};

export function inferType(title: string): string {
  const lower = title.toLowerCase();
  for (const [type, keywords] of Object.entries(TYPE_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) return type;
    }
  }
  return 'other';
}

export function inferTags(title: string): string[] {
  const tags: string[] = [];
  const lower = title.toLowerCase();

  const tagKeywords: Record<string, string[]> = {
    remote: ['remote', 'work from home', 'wfh'],
    hybrid: ['hybrid'],
    onsite: ['on-site', 'onsite', 'in-office'],
    senior: ['senior', 'sr.', 'lead', 'principal', 'staff'],
    junior: ['junior', 'jr.', 'entry level', 'entry-level', 'intern'],
    contract: ['contract', 'freelance', 'temporary'],
    fulltime: ['full-time', 'full time', 'permanent'],
  };

  for (const [tag, keywords] of Object.entries(tagKeywords)) {
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        tags.push(tag);
        break;
      }
    }
  }

  return tags;
}

export function createDomParser(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(html, 'text/html');
}
