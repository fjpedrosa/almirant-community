import type { Locale, Translations, DeepPartial } from '../types';
import { DEFAULT_LOCALE } from '../types';
import { translations } from '../translations';

/**
 * Get the full translation object for a given locale
 * Falls back to DEFAULT_LOCALE if the locale is not found
 */
export function getTranslations(locale: Locale): Translations {
  const fallback = translations[DEFAULT_LOCALE];
  if (!fallback) {
    throw new Error(`Missing fallback translations for locale "${DEFAULT_LOCALE}"`);
  }
  return translations[locale] ?? fallback;
}

/**
 * Get a nested translation value by dot-notation path
 * @example getTranslation('en', 'emails.common.greeting') // 'Hello'
 */
export function getTranslation(locale: Locale, path: string): string {
  const translation = getTranslations(locale);
  const parts = path.split('.');
  
  let current: unknown = translation;
  
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      // Path not found, try fallback locale
      if (locale !== DEFAULT_LOCALE) {
        return getTranslation(DEFAULT_LOCALE, path);
      }
      return path; // Return the path as fallback
    }
  }
  
  return typeof current === 'string' ? current : path;
}

/**
 * Interpolate a translation string with variables
 * @example interpolate('Hello {name}!', { name: 'World' }) // 'Hello World!'
 */
export function interpolate(
  template: string,
  variables: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in variables ? String(variables[key]) : match;
  });
}

/**
 * Get a translation and interpolate it with variables
 * @example t('en', 'emails.common.copyright', { year: '2024' })
 */
export function t(
  locale: Locale,
  path: string,
  variables?: Record<string, string | number>
): string {
  const translation = getTranslation(locale, path);
  return variables ? interpolate(translation, variables) : translation;
}

/**
 * Create a bound translation function for a specific locale
 * Useful for creating locale-specific translation helpers
 */
export function createTranslator(locale: Locale) {
  return (path: string, variables?: Record<string, string | number>) =>
    t(locale, path, variables);
}

/**
 * Get a specific email translation namespace
 * Convenient for email templates
 */
export function getEmailTranslations(locale: Locale): Translations['emails'] {
  return getTranslations(locale).emails;
}

/**
 * Check if a translation path exists
 */
export function hasTranslation(locale: Locale, path: string): boolean {
  try {
    const translation = getTranslations(locale);
    const parts = path.split('.');
    
    let current: unknown = translation;
    
    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return false;
      }
    }
    
    return typeof current === 'string';
  } catch {
    return false;
  }
}
