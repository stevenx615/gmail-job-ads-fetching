import { useState, useEffect, useRef } from 'react';
import { getBadgeCategoriesForJobType } from '../constants/badgeDefinitions';
import { getSettings, updateSetting } from '../services/settingsService';
import { suggestBadges } from '../services/aiService';
import type { JobBadges } from '../types';
import type { AIJobContext } from '../types/ai';

interface BadgeSelectorProps {
  badges: JobBadges;
  jobType: string;
  jobTitle?: string;
  jobCompany?: string;
  jobTags?: string[];
  jobLocation?: string;
  onConfirm: (badges: JobBadges) => void;
  onCancel: () => void;
}

const EMPTY_BADGES: JobBadges = {
  responsibilities: [],
  qualifications: [],
  skills: [],
  benefits: [],
};

export function BadgeSelector({ badges, jobType, jobTitle, jobCompany, jobTags, jobLocation, onConfirm, onCancel }: BadgeSelectorProps) {
  const settings = getSettings();
  const [customBadges, setCustomBadges] = useState(settings.customBadges);
  const categories = getBadgeCategoriesForJobType(jobType, customBadges)
    .filter(cat => settings.badgeVisibility[cat.key as keyof typeof settings.badgeVisibility]);
  const selectorRef = useRef<HTMLDivElement>(null);

  const [localBadges, setLocalBadges] = useState<JobBadges>({
    ...EMPTY_BADGES,
    ...badges,
    responsibilities: [...(badges.responsibilities || [])],
    qualifications: [...(badges.qualifications || [])],
    skills: [...(badges.skills || [])],
    benefits: [...(badges.benefits || [])],
  });

  const [newBadgeInputs, setNewBadgeInputs] = useState<Record<string, string>>({});
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [aiSuggestedBadges, setAiSuggestedBadges] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (selectorRef.current) {
      setTimeout(() => {
        selectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
  }, []);

  // Track new badges suggested by AI that aren't in the predefined list (creative mode)
  const [aiNewBadges, setAiNewBadges] = useState<Record<string, string[]>>({
    responsibilities: [],
    qualifications: [],
    skills: [],
    benefits: [],
  });

  // AI badge suggestions on mount
  useEffect(() => {
    if (!settings.autoSuggestBadges || settings.aiProvider === 'none' || !settings.aiApiKey) return;
    if (!jobTitle) return;

    let cancelled = false;

    const jobContext: AIJobContext = {
      title: jobTitle || '',
      company: jobCompany || '',
      type: jobType || '',
      tags: jobTags || [],
      location: jobLocation || '',
    };

    setIsLoadingSuggestions(true);
    setSuggestionError(null);

    suggestBadges(jobContext, settings).then(({ suggestions, error }) => {
      if (cancelled) return;

      if (error) {
        setSuggestionError(error);
      }
      if (suggestions) {
        const suggested = new Set<string>();
        const newBadgesByCategory: Record<string, string[]> = {
          responsibilities: [],
          qualifications: [],
          skills: [],
          benefits: [],
        };

        // Build set of all known badges per category
        const knownBadges: Record<string, Set<string>> = {};
        for (const cat of categories) {
          knownBadges[cat.key] = new Set(cat.badges);
        }

        // Check if the job already has saved badges (user has previously edited)
        const hasSavedBadges = ['responsibilities', 'qualifications', 'skills', 'benefits']
          .some(cat => (badges[cat as keyof JobBadges] || []).length > 0);

        setLocalBadges(prev => {
          const merged = { ...prev };
          for (const category of ['responsibilities', 'qualifications', 'skills', 'benefits'] as const) {
            const existing = new Set(prev[category]);
            const known = knownBadges[category] || new Set();
            for (const badge of suggestions[category]) {
              suggested.add(badge);
              // Only auto-select if no badges were previously saved
              if (!hasSavedBadges && !existing.has(badge)) {
                merged[category] = [...merged[category], badge];
              }
              // Track badges that aren't in the predefined list (deduplicate)
              if (!known.has(badge) && !newBadgesByCategory[category].includes(badge)) {
                newBadgesByCategory[category].push(badge);
              }
            }
          }
          return merged;
        });
        setAiSuggestedBadges(suggested);
        setAiNewBadges(newBadgesByCategory);
      }
      setIsLoadingSuggestions(false);
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleBadge = (category: keyof JobBadges, badge: string) => {
    setLocalBadges(prev => {
      const list = prev[category];
      const next = list.includes(badge)
        ? list.filter(b => b !== badge)
        : [...list, badge];
      return { ...prev, [category]: next };
    });
  };

  const addCustomBadge = (categoryKey: string) => {
    const trimmed = (newBadgeInputs[categoryKey] || '').trim();
    if (!trimmed) return;
    const catKey = categoryKey as keyof JobBadges;

    const cat = categories.find(c => c.key === categoryKey);
    const alreadyExists = cat?.badges.includes(trimmed);

    if (!alreadyExists) {
      const updated = {
        ...customBadges,
        [catKey]: [...customBadges[catKey], trimmed],
      };
      setCustomBadges(updated);
      updateSetting('customBadges', updated);
    }

    if (!localBadges[catKey].includes(trimmed)) {
      setLocalBadges(prev => ({
        ...prev,
        [catKey]: [...prev[catKey], trimmed],
      }));
    }

    setNewBadgeInputs(prev => ({ ...prev, [categoryKey]: '' }));
  };

  const getCategoryClass = (key: string) => {
    switch (key) {
      case 'responsibilities': return 'badge-cat-resp';
      case 'qualifications': return 'badge-cat-qual';
      case 'skills': return 'badge-cat-skill';
      case 'benefits': return 'badge-cat-bene';
      default: return '';
    }
  };

  return (
    <div className="badge-selector" ref={selectorRef} onClick={e => e.stopPropagation()}>
      {isLoadingSuggestions && (
        <div className="badge-selector-ai-loading">
          <span className="badge-selector-ai-spinner" />
          AI is suggesting badges...
        </div>
      )}
      {suggestionError && (
        <div className="badge-selector-ai-error">
          <span>{suggestionError}</span>
          <button className="badge-selector-ai-error-dismiss" onClick={() => setSuggestionError(null)}>&times;</button>
        </div>
      )}
      <div className="badge-selector-scroll">
        <div className="badge-selector-categories">
          {categories.map(cat => (
            <div key={cat.key} className="badge-selector-category">
              <span className={`badge-selector-cat-label ${getCategoryClass(cat.key)}`}>{cat.label}</span>
              <div className="badge-selector-items">
                {cat.badges.map(badge => {
                  const selected = localBadges[cat.key as keyof JobBadges].includes(badge);
                  const isAiSuggested = aiSuggestedBadges.has(badge);
                  return (
                    <button
                      key={badge}
                      className={`badge-selector-item ${getCategoryClass(cat.key)} ${selected ? 'selected' : ''} ${isAiSuggested && selected ? 'ai-suggested' : ''}`}
                      onClick={() => toggleBadge(cat.key as keyof JobBadges, badge)}
                    >
                      {isAiSuggested && <span className="ai-sparkle">&#10024;</span>}
                      {badge}
                    </button>
                  );
                })}
                {aiNewBadges[cat.key as keyof JobBadges]?.map(badge => {
                  const selected = localBadges[cat.key as keyof JobBadges].includes(badge);
                  return (
                    <button
                      key={`ai-new-${cat.key}-${badge}`}
                      className={`badge-selector-item ${getCategoryClass(cat.key)} ai-new-badge ${selected ? 'selected' : ''}`}
                      onClick={() => toggleBadge(cat.key as keyof JobBadges, badge)}
                      title="AI-suggested new badge"
                    >
                      <span className="ai-sparkle">&#10024;</span>
                      {badge}
                    </button>
                  );
                })}
                <div className="badge-selector-add-inline">
                  <input
                    type="text"
                    className="badge-selector-add-input"
                    placeholder="+ Custom"
                    value={newBadgeInputs[cat.key] || ''}
                    onChange={e => setNewBadgeInputs(prev => ({ ...prev, [cat.key]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomBadge(cat.key); } }}
                  />
                  {(newBadgeInputs[cat.key] || '').trim() && (
                    <button
                      className={`badge-selector-add-btn ${getCategoryClass(cat.key)}`}
                      onClick={() => addCustomBadge(cat.key)}
                    >+</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="badge-selector-actions">
        <button className="badge-selector-cancel" onClick={onCancel}>Cancel</button>
        <button className="badge-selector-confirm" onClick={() => {
          // Save any new AI-suggested badges that the user kept selected as custom badges
          const updatedCustom = { ...customBadges };
          let customChanged = false;
          for (const category of ['responsibilities', 'qualifications', 'skills', 'benefits'] as const) {
            for (const badge of aiNewBadges[category]) {
              if (localBadges[category].includes(badge) && !updatedCustom[category].includes(badge)) {
                updatedCustom[category] = [...updatedCustom[category], badge];
                customChanged = true;
              }
            }
          }
          if (customChanged) {
            setCustomBadges(updatedCustom);
            updateSetting('customBadges', updatedCustom);
          }
          onConfirm(localBadges);
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          Add
        </button>
      </div>
    </div>
  );
}
