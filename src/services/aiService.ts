import { GoogleGenAI } from '@google/genai';
import type { BadgeSuggestions, AIJobContext, TailorAnalysis, AnalyzeTailorResult, CustomSection } from '../types/ai';
import type { AppSettings } from '../types/settings';
import { getBadgeCategoriesForJobType } from '../constants/badgeDefinitions';

// In-memory cache keyed by job context
const suggestionCache = new Map<string, BadgeSuggestions>();

function getCacheKey(ctx: AIJobContext, mode: string): string {
  return `${ctx.title}|${ctx.company}|${ctx.type}|${mode}`;
}

export function clearSuggestionCache(): void {
  suggestionCache.clear();
}

const DEFAULT_MODELS: Record<string, string> = {
  openai: 'gpt-4o-mini',
  anthropic: 'claude-3-5-haiku-20241022',
  gemini: 'gemini-2.5-flash',
};

export function getDefaultModel(provider: string): string {
  return DEFAULT_MODELS[provider] || '';
}

function buildPrompt(jobContext: AIJobContext, availableBadges: Record<string, string[]>, mode: 'predefined' | 'creative'): string {
  const jobInfo = `Job metadata:
- Title: ${jobContext.title}
- Company: ${jobContext.company}
- Type: ${jobContext.type}
- Tags: ${jobContext.tags.join(', ') || 'none'}
- Location: ${jobContext.location || 'unknown'}`;

  if (mode === 'creative') {
    return `You are a job posting analyst. Given the following job metadata, suggest the most relevant badges for each category. You may pick from the provided lists OR create new short badge labels that fit the job well. Keep badge names concise (1-4 words). Pick 2-5 badges per category.

${jobInfo}

Reference badges (you can use these or create new ones):
- Responsibilities: ${availableBadges.responsibilities.join(', ')}
- Qualifications: ${availableBadges.qualifications.join(', ')}
- Skills: ${availableBadges.skills.join(', ')}
- Benefits: ${availableBadges.benefits.join(', ')}

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{"responsibilities":["badge1","badge2"],"qualifications":["badge1","badge2"],"skills":["badge1","badge2"],"benefits":["badge1","badge2"]}`;
  }

  return `You are a job posting analyst. Given the following job metadata, suggest the most relevant badges from the provided vocabulary for each category. Pick 2-5 badges per category ONLY from the provided lists.

${jobInfo}

Available badges by category:
- Responsibilities: ${availableBadges.responsibilities.join(', ')}
- Qualifications: ${availableBadges.qualifications.join(', ')}
- Skills: ${availableBadges.skills.join(', ')}
- Benefits: ${availableBadges.benefits.join(', ')}

Respond with ONLY a JSON object (no markdown, no explanation) in this exact format:
{"responsibilities":["badge1","badge2"],"qualifications":["badge1","badge2"],"skills":["badge1","badge2"],"benefits":["badge1","badge2"]}`;
}

function parseAIResponse(text: string, availableBadges: Record<string, string[]>, mode: 'predefined' | 'creative'): BadgeSuggestions | null {
  // Strip markdown code blocks if present
  let cleaned = text.trim();
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  }

  // Try to extract JSON object
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result: BadgeSuggestions = {
      responsibilities: [],
      qualifications: [],
      skills: [],
      benefits: [],
    };

    for (const category of ['responsibilities', 'qualifications', 'skills', 'benefits'] as const) {
      const suggested = parsed[category];
      if (Array.isArray(suggested)) {
        if (mode === 'creative') {
          // Accept any string badges in creative mode
          result[category] = suggested.filter((b: unknown) => typeof b === 'string' && (b as string).trim().length > 0);
        } else {
          // Validate each badge exists in the vocabulary
          const validSet = new Set(availableBadges[category]);
          result[category] = suggested.filter((b: unknown) => typeof b === 'string' && validSet.has(b));
        }
      }
    }

    return result;
  } catch {
    return null;
  }
}

async function callBackendAI(prompt: string, apiKey: string, model: string, provider: string, maxTokens: number = 4096): Promise<string> {
  const res = await fetch('/api/ai/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider, apiKey, model, prompt, maxTokens }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('429 rate limit exceeded');
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key');
    const detail = await res.text().catch(() => '');
    throw new Error(`AI API error: ${res.status}${detail ? ` — ${detail}` : ''}`);
  }

  const data = await res.json();
  return data.text || '';
}

async function callGemini(prompt: string, apiKey: string, model: string): Promise<string> {
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
  });
  return response.text ?? '';
}

async function callOpenAI(prompt: string, apiKey: string, model: string, proxyUrl?: string): Promise<string> {
  const baseUrl = proxyUrl || 'https://api.openai.com';
  const url = `${baseUrl}/v1/chat/completions`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('429 rate limit exceeded');
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key');
    throw new Error(`OpenAI API error: ${res.status}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(prompt: string, apiKey: string, model: string, proxyUrl?: string, maxTokens: number = 1024): Promise<string> {
  const baseUrl = proxyUrl || 'https://api.anthropic.com';
  const url = `${baseUrl}/v1/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    if (res.status === 429) throw new Error('429 rate limit exceeded');
    if (res.status === 401 || res.status === 403) throw new Error('Invalid API key');
    throw new Error(`Anthropic API error: ${res.status}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

function isCorsError(error: unknown): boolean {
  if (error instanceof TypeError && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
    return true;
  }
  return false;
}

function isRateLimitError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('429') || msg.includes('resource_exhausted') || msg.includes('quota') || msg.includes('rate limit');
  }
  return false;
}

function parseRetryDelay(error: unknown): string | null {
  if (error instanceof Error) {
    const match = error.message.match(/retry in (\d+(?:\.\d+)?s)/i);
    if (match) return match[1];
    const retryMatch = error.message.match(/"retryDelay"\s*:\s*"(\d+s)"/);
    if (retryMatch) return retryMatch[1];
  }
  return null;
}

export interface SuggestBadgesResult {
  suggestions: BadgeSuggestions | null;
  error: string | null;
}

export async function suggestBadges(
  jobContext: AIJobContext,
  settings: AppSettings,
): Promise<SuggestBadgesResult> {
  const { aiProvider, aiApiKey, aiModel, aiProxyUrl } = settings;

  if (aiProvider === 'none' || !aiApiKey) {
    return { suggestions: null, error: null };
  }

  const mode = settings.aiSuggestionMode || 'predefined';

  // Check cache
  const cacheKey = getCacheKey(jobContext, mode);
  const cached = suggestionCache.get(cacheKey);
  if (cached) {
    return { suggestions: cached, error: null };
  }

  // Build available badges vocabulary
  const categories = getBadgeCategoriesForJobType(jobContext.type, settings.customBadges);
  const availableBadges: Record<string, string[]> = {};
  for (const cat of categories) {
    availableBadges[cat.key] = cat.badges;
  }

  const model = aiModel || getDefaultModel(aiProvider);
  const prompt = buildPrompt(jobContext, availableBadges, mode);

  try {
    let responseText: string;

    switch (aiProvider) {
      case 'gemini':
        responseText = await callGemini(prompt, aiApiKey, model);
        break;
      case 'openai':
        responseText = await callOpenAI(prompt, aiApiKey, model, aiProxyUrl || undefined);
        break;
      case 'anthropic':
        responseText = await callAnthropic(prompt, aiApiKey, model, aiProxyUrl || undefined);
        break;
      default:
        return { suggestions: null, error: 'Unknown provider' };
    }

    const suggestions = parseAIResponse(responseText, availableBadges, mode);
    if (!suggestions) {
      return { suggestions: null, error: 'Could not parse AI response' };
    }

    // Cache the result
    suggestionCache.set(cacheKey, suggestions);
    return { suggestions, error: null };
  } catch (err) {
    if (isRateLimitError(err)) {
      const delay = parseRetryDelay(err);
      const retryHint = delay ? ` Retry in ${delay}.` : ' Please wait and try again.';
      return { suggestions: null, error: `API quota exceeded.${retryHint} Check your plan at ai.google.dev.` };
    }
    if (isCorsError(err)) {
      const hint = aiProvider === 'gemini'
        ? 'Unexpected CORS error with Gemini.'
        : `CORS blocked. Add a proxy URL in Settings, or switch to Google Gemini.`;
      return { suggestions: null, error: hint };
    }
    if (err instanceof Error && err.message === 'Invalid API key') {
      return { suggestions: null, error: 'Invalid API key. Check your key in Settings.' };
    }
    return { suggestions: null, error: `AI request failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildTailorPrompt(resumeText: string, jobDescription: string, jobTitle: string, company: string, settings: AppSettings): string {
  const toneMap: Record<string, string> = {
    professional: 'professional and formal',
    casual: 'conversational and approachable',
    executive: 'executive and leadership-focused',
    technical: 'technical and detail-oriented',
  };
  const lengthMap: Record<string, string> = {
    same: 'Keep the same length as the original resume',
    concise: 'Make it more concise — trim less relevant details',
    detailed: 'Expand with more detail to better match the role',
  };
  const customPart = settings.tailorCustomInstructions?.trim()
    ? `- Additional instructions: ${settings.tailorCustomInstructions}`
    : '';

  return `You are a professional resume writer. Your task is to tailor the provided resume to the job description below.

Instructions:
- Tone: Write in a ${toneMap[settings.tailorTone] || 'professional and formal'} tone
- Length: ${lengthMap[settings.tailorLength] || 'Keep the same length as the original resume'}
- Reorder and emphasize bullet points to match the job requirements
- Adapt the summary/objective to align with the role
- Use keywords from the job description where they accurately reflect the candidate's experience
- Do NOT invent or fabricate any experience, skills, or qualifications not present in the original resume${customPart ? `\n- ${customPart}` : ''}
- Return the tailored resume as clean HTML using only these tags: <p>, <strong>, <em>, <ul>, <ol>, <li>, <h2>, <h3>, <br>, <hr>
- Use <h2> for the candidate's name and <h3> for each section title (e.g. Summary, Experience, Education, Skills)
- Use <p> for regular text, <ul>/<li> for bullet points, <strong> for job titles or company names within paragraphs
- No inline styles, no classes, no doctype, no <html> or <body> wrapper, no markdown, no explanation

Job Title: ${jobTitle}
Company: ${company}

Job Description:
${jobDescription}

Original Resume:
${resumeText}

Tailored Resume (HTML only):`;
}

function cleanTailoredHtml(raw: string): string {
  const fenceMatch = raw.match(/```(?:html)?\s*([\s\S]*?)```/);
  return (fenceMatch ? fenceMatch[1] : raw).trim();
}

export interface TailorResumeResult {
  tailoredResume: string | null;
  error: string | null;
}

export async function tailorResume(
  resumeText: string,
  jobDescription: string,
  jobTitle: string,
  company: string,
  settings: AppSettings,
): Promise<TailorResumeResult> {
  const { aiProvider, aiApiKey, aiModel } = settings;

  if (aiProvider === 'none' || !aiApiKey) {
    return { tailoredResume: null, error: 'No AI provider configured. Set one up in Settings.' };
  }

  const cleanedDescription = stripHtml(jobDescription);
  const cleanedResume = stripHtml(resumeText);
  const prompt = buildTailorPrompt(cleanedResume, cleanedDescription, jobTitle, company, settings);
  const model = aiModel || getDefaultModel(aiProvider);

  try {
    const responseText = await callBackendAI(prompt, aiApiKey, model, aiProvider, 4096);
    return { tailoredResume: cleanTailoredHtml(responseText), error: null };
  } catch (err) {
    if (isRateLimitError(err)) {
      const delay = parseRetryDelay(err);
      const retryHint = delay ? ` Retry in ${delay}.` : ' Please wait and try again.';
      return { tailoredResume: null, error: `API quota exceeded.${retryHint}` };
    }
    if (isCorsError(err)) {
      return { tailoredResume: null, error: 'Backend not available. Start the local backend to use resume tailoring.' };
    }
    if (err instanceof Error && err.message === 'Invalid API key') {
      return { tailoredResume: null, error: 'Invalid API key. Check your key in Settings.' };
    }
    return { tailoredResume: null, error: `AI request failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

export interface DocxSection { index: number; type: string; text: string; }
export interface DocxReplacement { index: number; new_text: string; }
export interface TailorDocxResult {
  replacements: DocxReplacement[] | null;
  error: string | null;
}

export async function tailorResumeDocx(
  contentSections: DocxSection[],
  jobDescription: string,
  jobTitle: string,
  company: string,
  settings: AppSettings,
): Promise<TailorDocxResult> {
  const { aiProvider, aiApiKey, aiModel } = settings;

  if (aiProvider === 'none' || !aiApiKey) {
    return { replacements: null, error: 'No AI provider configured. Set one up in Settings.' };
  }

  const cleanedJobDescription = stripHtml(jobDescription);
  const model = aiModel || getDefaultModel(aiProvider);

  const prompt = `You are a professional resume editor. Edit the content sections below to better match the job description.
RULES:
- Edit ONLY the provided sections (these are bullet points and descriptions, NOT headings or contact info)
- Use keywords from the job description where they accurately reflect experience
- Keep the same bullet point structure and roughly the same length
- Do NOT fabricate experience or skills not in the original
- Return ONLY a JSON array (no explanation): [{"i": <index>, "text": "<edited text>"}, ...]
- Include only sections you changed

Job: ${jobTitle} at ${company}
Job Description:
${cleanedJobDescription}

Resume sections to edit:
${JSON.stringify(contentSections.map(s => ({ i: s.index, text: s.text })))}`;

  try {
    const responseText = await callBackendAI(prompt, aiApiKey, model, aiProvider, 4096);

    let cleaned = responseText.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!arrayMatch) return { replacements: null, error: 'Could not parse AI response as JSON array' };

    const parsed = JSON.parse(arrayMatch[0]);
    if (!Array.isArray(parsed)) return { replacements: null, error: 'AI response is not a JSON array' };

    const replacements: DocxReplacement[] = parsed
      .filter((item: unknown) => item !== null && typeof item === 'object' && 'i' in (item as object) && 'text' in (item as object))
      .map((item: { i: number; text: string }) => ({ index: item.i, new_text: item.text }));

    return { replacements, error: null };
  } catch (err) {
    if (isRateLimitError(err)) {
      const delay = parseRetryDelay(err);
      const retryHint = delay ? ` Retry in ${delay}.` : ' Please wait and try again.';
      return { replacements: null, error: `API quota exceeded.${retryHint}` };
    }
    if (isCorsError(err)) {
      return { replacements: null, error: 'Backend not available. Start the local backend to use resume tailoring.' };
    }
    if (err instanceof Error && err.message === 'Invalid API key') {
      return { replacements: null, error: 'Invalid API key. Check your key in Settings.' };
    }
    return { replacements: null, error: `AI request failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

function buildAnalyzePrompt(resumeText: string, jobDescription: string, jobTitle: string, company: string): string {
  return `You are a professional resume advisor. Analyze the resume against the job description and return a structured JSON analysis.

RULES:
- Only list skills, experiences, and qualifications ACTUALLY present in the resume
- Mark isSuggestion: true only for items the candidate does NOT have but should consider (coaching hints)
- For job requirements not found in resume: set match to null and include to false
- NEVER fabricate work history, skills, education, or experience
- include: true = recommended to include in the final resume; false = optional or gap

Return ONLY valid JSON (no markdown, no code fences, no explanation):
{
  "candidateName": "Full name from resume header",
  "contactInfo": ["email@example.com", "555-123-4567", "City, State", "linkedin.com/in/handle"],
  "originalSummary": "The exact professional summary or objective copied verbatim from the resume. Empty string if the resume has none.",
  "summary": "Professional summary written specifically for this role — maximum 3 sentences",
  "atsScore": 85,
  "matchedKeywords": ["keyword1", "keyword2"],
  "missingKeywords": ["missing1", "missing2"],
  "tips": ["Tip to improve match", "Another tip"],
  "qualifications": [
    {
      "requirement": "specific requirement from job posting",
      "match": "relevant text from resume or null if absent",
      "isSuggestion": false,
      "note": "optional coaching note",
      "suggestions": ["coaching hint or description of why this matters (non-selectable, shown as context to the user)"],
      "readySentence": "A complete, polished resume bullet or phrase ready to paste in — ONLY set when match is null, null otherwise",
      "include": true
    }
  ],
  "experience": [
    { "company": "Company Name", "title": "Job Title", "period": "Date Range", "location": "City, State or Remote", "bullets": [
      {
        "text": "EXACT original bullet text from the resume",
        "tailored": "improved version with job-relevant keywords and stronger phrasing",
        "keywords": ["matched", "keywords"],
        "matchLevel": "full",
        "isSuggestion": false,
        "include": true
      }
    ]}
  ],
  "skills": [
    { "name": "Skill", "category": "Languages", "fromResume": true, "isSuggestion": false, "note": "", "include": true }
  ],
  "education": [
    { "program": "Bachelor of Science in Computer Science", "school": "MIT", "location": "Cambridge, MA", "startDate": "2018", "endDate": "2022" }
  ],
  "customSections": [
    {
      "type": "volunteer",
      "title": "Volunteer Experience",
      "entries": [{ "fields": { "org": "Red Cross", "role": "Coordinator", "period": "2020–2021", "location": "NYC", "description": "Led weekly food drives..." } }]
    },
    {
      "type": "certifications",
      "title": "Certifications",
      "entries": [{ "fields": { "name": "AWS Solutions Architect", "issuer": "Amazon", "date": "2022", "link": "" } }]
    }
  ]
}

Skill category values to use (pick the closest fit):
"Languages" · "Frameworks" · "Databases" · "Cloud & DevOps" · "Tools" · "Soft Skills" · "Other"

Known customSection types and field keys — only include types actually present in the resume:
- volunteer: org, role, period, location, description
- additional: company, role, period, location, description
- projects: name, tech, period, link, description
- certifications: name, issuer, date, link
- publications: title, publisher, date, link
- awards: title, issuer, date, description
- languages: language, proficiency
- courses: name, institution, date

Job: ${jobTitle} at ${company}

Job Description:
${jobDescription}

Resume:
${resumeText}`;
}

export async function analyzeTailorSections(
  resumeText: string,
  jobDescription: string,
  jobTitle: string,
  company: string,
  settings: AppSettings,
): Promise<AnalyzeTailorResult> {
  const { aiProvider, aiApiKey, aiModel } = settings;

  if (aiProvider === 'none' || !aiApiKey) {
    return { analysis: null, error: 'No AI provider configured. Set one up in Settings.' };
  }

  const model = aiModel || getDefaultModel(aiProvider);
  const prompt = buildAnalyzePrompt(resumeText, jobDescription, jobTitle, company);

  try {
    const responseText = await callBackendAI(prompt, aiApiKey, model, aiProvider, 8192);

    let cleaned = responseText.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { analysis: null, error: 'Could not parse AI response as JSON' };

    const parsed = JSON.parse(jsonMatch[0]);

    const analysis: TailorAnalysis = {
      candidateName: String(parsed.candidateName || ''),
      contactInfo: Array.isArray(parsed.contactInfo) ? parsed.contactInfo.map(String).filter(Boolean) : [],
      originalSummary: String(parsed.originalSummary || ''),
      summary: String(parsed.summary || ''),
      atsScore: typeof parsed.atsScore === 'number' ? Math.max(0, Math.min(100, parsed.atsScore)) : 0,
      matchedKeywords: Array.isArray(parsed.matchedKeywords) ? parsed.matchedKeywords.map(String) : [],
      missingKeywords: Array.isArray(parsed.missingKeywords) ? parsed.missingKeywords.map(String) : [],
      tips: Array.isArray(parsed.tips) ? parsed.tips.map(String) : [],
      qualifications: Array.isArray(parsed.qualifications)
        ? parsed.qualifications.map((q: Record<string, unknown>) => ({
            requirement: String(q.requirement || ''),
            match: q.match ? String(q.match) : null,
            isSuggestion: !!q.isSuggestion,
            note: q.note ? String(q.note) : undefined,
            suggestions: Array.isArray(q.suggestions) ? q.suggestions.map(String).filter(Boolean) : [],
            readySentence: q.readySentence ? String(q.readySentence) : null,
            include: q.match ? q.include !== false : false,
          }))
        : [],
      experience: Array.isArray(parsed.experience)
        ? parsed.experience.map((e: Record<string, unknown>) => ({
            company: String(e.company || ''),
            title: String(e.title || ''),
            period: String(e.period || ''),
            location: String(e.location || ''),
            include: true,
            bullets: Array.isArray(e.bullets)
              ? e.bullets.map((b: Record<string, unknown>) => ({
                  text: String(b.text || ''),
                  tailored: String(b.tailored || b.text || ''),
                  keywords: Array.isArray(b.keywords) ? b.keywords.map(String) : [],
                  matchLevel: (['full', 'partial', 'none'].includes(b.matchLevel as string) ? b.matchLevel : 'partial') as 'full' | 'partial' | 'none',
                  isSuggestion: !!b.isSuggestion,
                  include: b.include !== false,
                }))
              : [],
          }))
        : [],
      skills: Array.isArray(parsed.skills)
        ? parsed.skills.map((s: Record<string, unknown>) => ({
            name: String(s.name || ''),
            category: String(s.category || 'Other'),
            fromResume: !!s.fromResume,
            isSuggestion: !!s.isSuggestion,
            note: s.note ? String(s.note) : undefined,
            include: s.include !== false,
          }))
        : [],
      education: Array.isArray(parsed.education)
        ? parsed.education.map((e: Record<string, unknown>) =>
            typeof e === 'string'
              ? { program: e, school: '', location: '', startDate: '', endDate: '' }
              : { program: String(e.program || ''), school: String(e.school || ''), location: String(e.location || ''), startDate: String(e.startDate || ''), endDate: String(e.endDate || '') }
          )
        : [],
      customSections: Array.isArray(parsed.customSections)
        ? parsed.customSections.map((s: Record<string, unknown>, i: number): CustomSection => ({
            id: `ai-${i}-${Date.now()}`,
            type: String(s.type || 'other'),
            title: String(s.title || ''),
            entries: Array.isArray(s.entries)
              ? s.entries.map((e: Record<string, unknown>) => ({
                  fields: (typeof e.fields === 'object' && e.fields !== null)
                    ? Object.fromEntries(Object.entries(e.fields as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]))
                    : {},
                  include: true,
                }))
              : [],
            include: true,
          }))
        : [],
    };

    return { analysis, error: null };
  } catch (err) {
    if (isRateLimitError(err)) {
      const delay = parseRetryDelay(err);
      return { analysis: null, error: `API quota exceeded.${delay ? ` Retry in ${delay}.` : ' Please wait and try again.'}` };
    }
    if (isCorsError(err)) {
      return { analysis: null, error: 'Backend not available. Start the local backend to use resume tailoring.' };
    }
    if (err instanceof Error && err.message === 'Invalid API key') {
      return { analysis: null, error: 'Invalid API key. Check your key in Settings.' };
    }
    return { analysis: null, error: `AI request failed: ${err instanceof Error ? err.message : 'Unknown error'}` };
  }
}

export async function regenerateQualification(
  requirement: string,
  jobTitle: string,
  company: string,
  currentMatch: string | null,
  settings: AppSettings,
): Promise<{ text: string | null; error: string | null }> {
  const { aiProvider, aiApiKey, aiModel } = settings;
  if (aiProvider === 'none' || !aiApiKey) return { text: null, error: 'No AI provider configured' };

  const model = aiModel || getDefaultModel(aiProvider);
  const context = currentMatch ? `Current match from resume: "${currentMatch}"` : 'This requirement was not found in the resume.';
  const prompt = `Write a single resume bullet point that addresses the following job requirement for ${jobTitle} at ${company}.

Requirement: "${requirement}"
${context}

Rules:
- Write one concise sentence suitable for a resume qualifications section
- If a current match is provided, improve or rephrase it to better address the requirement
- If not found, write a plausible sentence a candidate might add if they have relevant experience
- Do NOT invent specific metrics or credentials out of thin air
- Return ONLY the sentence, no quotes, no explanation`;

  try {
    const text = await callBackendAI(prompt, aiApiKey, model, aiProvider, 200);
    return { text: text.trim().replace(/^["']|["']$/g, ''), error: null };
  } catch (err) {
    if (isCorsError(err)) return { text: null, error: 'Backend not available.' };
    return { text: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function suggestBullet(
  expTitle: string,
  expCompany: string,
  jobTitle: string,
  jobCompany: string,
  jobDescription: string,
  matchedKeywords: string[],
  settings: AppSettings,
): Promise<{ text: string | null; keywords: string[]; error: string | null }> {
  const { aiProvider, aiApiKey, aiModel } = settings;
  if (aiProvider === 'none' || !aiApiKey) return { text: null, keywords: [], error: 'No AI provider configured' };

  const model = aiModel || getDefaultModel(aiProvider);
  const kwList = matchedKeywords.length > 0 ? matchedKeywords.slice(0, 15).join(', ') : 'none';
  const prompt = `Generate a single resume bullet point for a ${expTitle} at ${expCompany}, applying for ${jobTitle} at ${jobCompany}.

Job description excerpt:
${jobDescription.slice(0, 800)}

Relevant keywords: ${kwList}

Rules:
- Start with a strong action verb
- Be specific and achievement-focused
- Incorporate 1-3 of the relevant keywords naturally where accurate
- Keep to one concise sentence
- Do NOT fabricate specific metrics not implied by context
- Return ONLY a JSON object (no markdown): {"text": "the bullet text", "keywords": ["kw1", "kw2"]}
  where keywords are items from the relevant keywords list that appear in the bullet`;

  try {
    const raw = await callBackendAI(prompt, aiApiKey, model, aiProvider, 256);
    let cleaned = raw.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) cleaned = fenceMatch[1].trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const text = cleaned.replace(/^["']|["']$/g, '');
      return { text, keywords: [], error: null };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    const text = String(parsed.text || '').replace(/^["']|["']$/g, '');
    const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean) : [];
    return { text, keywords, error: null };
  } catch (err) {
    if (isCorsError(err)) return { text: null, keywords: [], error: 'Backend not available.' };
    return { text: null, keywords: [], error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function regenerateBullet(
  originalText: string,
  jobTitle: string,
  company: string,
  keywords: string[],
  settings: AppSettings,
): Promise<{ tailored: string | null; error: string | null }> {
  const { aiProvider, aiApiKey, aiModel } = settings;
  if (aiProvider === 'none' || !aiApiKey) return { tailored: null, error: 'No AI provider configured' };

  const model = aiModel || getDefaultModel(aiProvider);
  const kwList = keywords.length > 0 ? keywords.join(', ') : 'none';
  const prompt = `Rewrite the following resume bullet point to be tailored for the role of ${jobTitle} at ${company}.

Original bullet: "${originalText}"

Target keywords to incorporate naturally (only where accurate): ${kwList}

Rules:
- Keep the same core achievement or responsibility
- Do NOT invent metrics or skills not implied by the original
- Return ONLY the rewritten bullet as a single sentence, no quotes, no explanation`;

  try {
    const text = await callBackendAI(prompt, aiApiKey, model, aiProvider, 256);
    return { tailored: text.trim().replace(/^["']|["']$/g, ''), error: null };
  } catch (err) {
    if (isCorsError(err)) return { tailored: null, error: 'Backend not available.' };
    return { tailored: null, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

/** Test the AI connection with a sample request */
export async function testAIConnection(settings: AppSettings): Promise<{ success: boolean; error?: string }> {
  const { aiProvider, aiApiKey, aiModel, aiProxyUrl } = settings;

  if (aiProvider === 'none' || !aiApiKey) {
    return { success: false, error: 'No provider or API key configured' };
  }

  const model = aiModel || getDefaultModel(aiProvider);
  const testPrompt = 'Respond with exactly: {"status":"ok"}';

  try {
    switch (aiProvider) {
      case 'gemini':
        await callGemini(testPrompt, aiApiKey, model);
        break;
      case 'openai':
        await callOpenAI(testPrompt, aiApiKey, model, aiProxyUrl || undefined);
        break;
      case 'anthropic':
        await callAnthropic(testPrompt, aiApiKey, model, aiProxyUrl || undefined);
        break;
    }
    return { success: true };
  } catch (err) {
    if (isRateLimitError(err)) {
      const delay = parseRetryDelay(err);
      const retryHint = delay ? ` Retry in ${delay}.` : ' Please wait and try again.';
      return { success: false, error: `API quota exceeded.${retryHint}` };
    }
    if (isCorsError(err)) {
      const hint = aiProvider === 'gemini'
        ? 'CORS error.'
        : 'CORS blocked. Add a proxy URL or switch to Google Gemini.';
      return { success: false, error: hint };
    }
    return { success: false, error: err instanceof Error ? err.message : 'Connection failed' };
  }
}
