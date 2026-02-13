export interface BadgeCategory {
  key: string;
  label: string;
  badges: string[];
}

// Job type specific skill suggestions
const FRONTEND_SKILLS = ['JavaScript/TypeScript', 'React', 'CSS/HTML', 'Vue/Angular', 'Figma/Design Tools', 'REST APIs', 'GraphQL'];
const BACKEND_SKILLS = ['Python', 'Node.js', 'SQL/Databases', 'REST APIs', 'GraphQL', 'Docker/Kubernetes', 'Cloud (AWS/GCP/Azure)', 'Microservices'];
const FULLSTACK_SKILLS = ['JavaScript/TypeScript', 'React', 'Node.js', 'SQL/Databases', 'REST APIs', 'Docker/Kubernetes', 'Cloud (AWS/GCP/Azure)'];
const MOBILE_SKILLS = ['React Native', 'Swift/iOS', 'Kotlin/Android', 'Flutter', 'Mobile UI/UX', 'REST APIs', 'App Store/Play Store'];
const DEVOPS_SKILLS = ['Docker/Kubernetes', 'Cloud (AWS/GCP/Azure)', 'CI/CD Pipeline', 'Terraform/IaC', 'Linux/Bash', 'Monitoring/Logging', 'Git'];
const DATA_SKILLS = ['Python', 'SQL/Databases', 'Machine Learning', 'Data Analysis', 'Pandas/NumPy', 'Spark/Hadoop', 'Tableau/PowerBI'];
const DESIGN_SKILLS = ['Figma/Design Tools', 'Adobe Creative Suite', 'UI/UX Design', 'Prototyping', 'Design Systems', 'User Research'];
const QA_SKILLS = ['Testing/QA', 'Selenium/Cypress', 'Test Automation', 'Bug Tracking', 'API Testing', 'Performance Testing'];
const GAME_SKILLS = ['Unity/Unreal', 'C++/C#', '3D Modeling', 'Game Physics', 'Shader Programming', 'Multiplayer/Networking'];

const ALL_SKILLS = [
  'JavaScript/TypeScript', 'React', 'Python', 'SQL/Databases', 'Cloud (AWS/GCP/Azure)',
  'Docker/Kubernetes', 'Git', 'REST APIs', 'GraphQL', 'Machine Learning',
  'Unity/Unreal', 'Figma/Design Tools', 'Node.js', 'CSS/HTML', 'Vue/Angular',
  'Microservices', 'React Native', 'Swift/iOS', 'Kotlin/Android', 'Flutter',
  'Mobile UI/UX', 'App Store/Play Store', 'CI/CD Pipeline', 'Terraform/IaC',
  'Linux/Bash', 'Monitoring/Logging', 'Pandas/NumPy', 'Spark/Hadoop', 'Tableau/PowerBI',
  'Adobe Creative Suite', 'UI/UX Design', 'Prototyping', 'Design Systems', 'User Research',
  'Selenium/Cypress', 'Test Automation', 'Bug Tracking', 'API Testing', 'Performance Testing',
  'C++/C#', '3D Modeling', 'Game Physics', 'Shader Programming', 'Multiplayer/Networking',
];

export function getSkillsForJobType(jobType: string): string[] {
  const type = jobType.toLowerCase();

  if (type.includes('frontend') || type.includes('front-end') || type.includes('front end')) {
    return FRONTEND_SKILLS;
  }
  if (type.includes('backend') || type.includes('back-end') || type.includes('back end')) {
    return BACKEND_SKILLS;
  }
  if (type.includes('fullstack') || type.includes('full-stack') || type.includes('full stack')) {
    return FULLSTACK_SKILLS;
  }
  if (type.includes('mobile') || type.includes('ios') || type.includes('android')) {
    return MOBILE_SKILLS;
  }
  if (type.includes('devops') || type.includes('sre') || type.includes('infrastructure')) {
    return DEVOPS_SKILLS;
  }
  if (type.includes('data') || type.includes('ml') || type.includes('machine learning') || type.includes('ai')) {
    return DATA_SKILLS;
  }
  if (type.includes('design') || type.includes('ux') || type.includes('ui')) {
    return DESIGN_SKILLS;
  }
  if (type.includes('qa') || type.includes('test') || type.includes('quality')) {
    return QA_SKILLS;
  }
  if (type.includes('game') || type.includes('unity') || type.includes('unreal')) {
    return GAME_SKILLS;
  }

  return ALL_SKILLS;
}

export const BADGE_CATEGORIES: BadgeCategory[] = [
  {
    key: 'responsibilities',
    label: 'Responsibilities',
    badges: [
      'Code Review', 'System Design', 'Bug Fixing', 'Testing/QA', 'Documentation',
      'Mentoring', 'Client-Facing', 'On-Call/Support', 'Data Analysis', 'CI/CD Pipeline',
    ],
  },
  {
    key: 'qualifications',
    label: 'Qualifications',
    badges: [
      "Bachelor's Degree", "Master's Degree", '1-2 Years Exp', '3-5 Years Exp', '5+ Years Exp',
      'No Degree Required', 'Certification Required', 'Portfolio Required', 'Security Clearance', 'Bilingual',
    ],
  },
  {
    key: 'skills',
    label: 'Skills',
    badges: ALL_SKILLS,
  },
  {
    key: 'benefits',
    label: 'Benefits',
    badges: [
      'Remote', 'Hybrid', 'Health Insurance', '401k/RRSP', 'Stock Options',
      'Flexible Hours', 'PTO/Vacation', 'Relocation', 'Visa Sponsorship', 'Signing Bonus',
    ],
  },
];

export function getBadgeCategoriesForJobType(jobType: string): BadgeCategory[] {
  return BADGE_CATEGORIES.map(cat => {
    if (cat.key === 'skills') {
      return {
        ...cat,
        badges: getSkillsForJobType(jobType),
      };
    }
    return cat;
  });
}
