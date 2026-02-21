import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';

const SETTINGS_KEY = 'app_settings';

export function getSettings(): AppSettings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return DEFAULT_SETTINGS;

    const parsed = JSON.parse(stored);
    // Merge with defaults to handle new settings added in updates
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      aiApiKeys: { ...DEFAULT_SETTINGS.aiApiKeys, ...(parsed.aiApiKeys || {}) },
    };
  } catch (error) {
    console.error('[settingsService] Error loading settings:', error);
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    console.log('[settingsService] Settings saved');
  } catch (error) {
    console.error('[settingsService] Error saving settings:', error);
  }
}

export function resetSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    console.log('[settingsService] Settings reset to defaults');
  } catch (error) {
    console.error('[settingsService] Error resetting settings:', error);
  }
}

export function updateSetting<K extends keyof AppSettings>(
  key: K,
  value: AppSettings[K]
): void {
  const settings = getSettings();
  settings[key] = value;
  saveSettings(settings);
}
