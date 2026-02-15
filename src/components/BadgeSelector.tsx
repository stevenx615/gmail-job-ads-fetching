import { useState, useEffect, useRef } from 'react';
import { getBadgeCategoriesForJobType } from '../constants/badgeDefinitions';
import { getSettings, updateSetting } from '../services/settingsService';
import type { JobBadges } from '../types';

interface BadgeSelectorProps {
  badges: JobBadges;
  jobType: string;
  onConfirm: (badges: JobBadges) => void;
  onCancel: () => void;
}

const EMPTY_BADGES: JobBadges = {
  responsibilities: [],
  qualifications: [],
  skills: [],
  benefits: [],
};

export function BadgeSelector({ badges, jobType, onConfirm, onCancel }: BadgeSelectorProps) {
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

  useEffect(() => {
    if (selectorRef.current) {
      setTimeout(() => {
        selectorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 50);
    }
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
      <div className="badge-selector-scroll">
        <div className="badge-selector-categories">
          {categories.map(cat => (
            <div key={cat.key} className="badge-selector-category">
              <span className={`badge-selector-cat-label ${getCategoryClass(cat.key)}`}>{cat.label}</span>
              <div className="badge-selector-items">
                {cat.badges.map(badge => {
                  const selected = localBadges[cat.key as keyof JobBadges].includes(badge);
                  return (
                    <button
                      key={badge}
                      className={`badge-selector-item ${getCategoryClass(cat.key)} ${selected ? 'selected' : ''}`}
                      onClick={() => toggleBadge(cat.key as keyof JobBadges, badge)}
                    >
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
        <button className="badge-selector-confirm" onClick={() => onConfirm(localBadges)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
          Add
        </button>
      </div>
    </div>
  );
}
