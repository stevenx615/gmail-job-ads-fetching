export type WizardStep =
  | 'jd'
  | 'resume'
  | 'scratch'
  | 'analyzing'
  | 'workshop';

export interface ScratchPersonal {
  name: string;
  email: string;
  phone: string;
  linkedin: string;
  location: string;
}

export interface ScratchExperience {
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  location: string;
  bullets: string; // one bullet per line
}

export interface ScratchEducation {
  institution: string;
  degree: string;
  field: string;
  startDate: string;
  endDate: string;
}

export interface ScratchResume {
  personal: ScratchPersonal;
  summary: string;
  experience: ScratchExperience[];
  skills: string;
  education: ScratchEducation[];
}

export function assembleResumeText(s: ScratchResume): string {
  const lines: string[] = [];
  const { personal, summary, experience, skills, education } = s;

  if (personal.name) lines.push(personal.name);
  const contact = [personal.email, personal.phone, personal.location].filter(Boolean);
  if (contact.length) lines.push(contact.join(' | '));
  if (personal.linkedin) lines.push(personal.linkedin);

  if (summary) lines.push('', 'SUMMARY', summary);

  if (experience.length) {
    lines.push('', 'EXPERIENCE');
    for (const e of experience) {
      const header = [e.company, e.role].filter(Boolean).join(' — ');
      const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      const meta = [period, e.location].filter(Boolean).join(' | ');
      if (header) lines.push(header + (meta ? ' | ' + meta : ''));
      e.bullets.split('\n').filter(b => b.trim()).forEach(b => lines.push('• ' + b.trim()));
    }
  }

  if (skills) lines.push('', 'SKILLS', skills);

  if (education.length) {
    lines.push('', 'EDUCATION');
    for (const e of education) {
      const deg = [e.degree, e.field].filter(Boolean).join(' in ');
      const header = [e.institution, deg].filter(Boolean).join(' — ');
      const period = [e.startDate, e.endDate].filter(Boolean).join(' – ');
      if (header) lines.push(header + (period ? ' | ' + period : ''));
    }
  }

  return lines.join('\n');
}
