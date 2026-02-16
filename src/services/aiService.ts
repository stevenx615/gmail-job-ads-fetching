import { GoogleGenAI } from '@google/genai';
import type { BadgeSuggestions, AIJobContext } from '../types/ai';
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

async function callAnthropic(prompt: string, apiKey: string, model: string, proxyUrl?: string): Promise<string> {
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
      max_tokens: 1024,
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
