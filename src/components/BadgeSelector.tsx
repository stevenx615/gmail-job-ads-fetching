import { useState, useEffect, useRef } from 'react';
import { getBadgeCategoriesForJobType } from '../constants/badgeDefinitions';
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
  const categories = getBadgeCategoriesForJobType(jobType);
  const selectorRef = useRef<HTMLDivElement>(null);

  const [localBadges, setLocalBadges] = useState<JobBadges>({
    ...EMPTY_BADGES,
    ...badges,
    responsibilities: [...(badges.responsibilities || [])],
    qualifications: [...(badges.qualifications || [])],
    skills: [...(badges.skills || [])],
    benefits: [...(badges.benefits || [])],
  });

  useEffect(() => {
    // Scroll the selector into view when it opens
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
