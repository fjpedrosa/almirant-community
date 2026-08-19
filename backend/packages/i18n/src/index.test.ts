import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  en,
  es,
  getEmailTranslations,
  getTranslation,
  getTranslations,
  hasTranslation,
  interpolate,
  isValidLocale,
  parseLocale,
  t,
  translations,
  type Locale,
} from '@almirant/i18n';

// Keep the test runner runtime-only so this package needs no Bun type dependency.
const bunTestModule = 'bun:test';
const { describe, expect, it } = await import(bunTestModule);

function flattenCatalog(
  value: unknown,
  path: string[] = [],
  result = new Map<string, string>(),
): Map<string, string> {
  if (typeof value === 'string') {
    result.set(path.join('.'), value);
    return result;
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Non-string translation at "${path.join('.')}"`);
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    flattenCatalog(nestedValue, [...path, key], result);
  }

  return result;
}

function placeholders(value: string): string[] {
  return [
    ...new Set(
      Array.from(value.matchAll(/\{(\w+)\}/g), (match) => match[1] ?? ''),
    ),
  ].sort();
}

describe('@almirant/i18n public surface', () => {
  it('defines supported locales and uses English as the default fallback', () => {
    expect(SUPPORTED_LOCALES).toEqual(['en', 'es']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(Object.keys(translations).sort()).toEqual(['en', 'es']);
    expect(translations.en).toBe(en);
    expect(translations.es).toBe(es);

    expect(isValidLocale('en')).toBe(true);
    expect(isValidLocale('es')).toBe(true);
    expect(isValidLocale('fr')).toBe(false);

    expect(parseLocale('es')).toBe('es');
    for (const invalidLocale of [undefined, null, '', 'EN', 'en-US']) {
      expect(parseLocale(invalidLocale)).toBe(DEFAULT_LOCALE);
    }

    expect(getTranslations('en')).toBe(en);
    expect(getTranslations('es')).toBe(es);
    expect(getTranslations('fr' as Locale)).toBe(en);
  });

  it('looks up nested translations and returns stable fallbacks', () => {
    expect(getTranslation('en', 'emails.common.greeting')).toBe('Hello');
    expect(getTranslation('es', 'emails.common.greeting')).toBe('Hola');
    expect(getTranslation('fr' as Locale, 'emails.common.greeting')).toBe('Hello');
    expect(getTranslation('en', 'emails.common')).toBe('emails.common');
    expect(getTranslation('en', 'emails.missing')).toBe('emails.missing');

    const spanishGreeting = es.emails.common.greeting;
    Reflect.deleteProperty(es.emails.common, 'greeting');

    try {
      expect(getTranslation('es', 'emails.common.greeting')).toBe(
        en.emails.common.greeting,
      );
    } finally {
      es.emails.common.greeting = spanishGreeting;
    }
  });

  it('interpolates strings and preserves unresolved placeholders', () => {
    expect(interpolate('Hello {name}, task {id}', { name: 'Ada', id: 42 })).toBe(
      'Hello Ada, task 42',
    );
    expect(interpolate('Hello {name} from {workspace}', { name: 'Ada' })).toBe(
      'Hello Ada from {workspace}',
    );
    expect(interpolate('{count} of {count}', { count: 0 })).toBe('0 of 0');
  });

  it('translates directly and through a locale-bound translator', () => {
    expect(t('en', 'emails.common.copyright', { year: 2026 })).toBe(
      '© 2026 Almirant. All rights reserved.',
    );

    const translateToSpanish = createTranslator('es');
    expect(
      translateToSpanish('emails.ideaHub.body.greeting', { name: 'Ana' }),
    ).toBe('Hola Ana,');
  });

  it('returns email namespaces and detects only string translation leaves', () => {
    expect(getEmailTranslations('en')).toBe(en.emails);
    expect(getEmailTranslations('es')).toBe(es.emails);
    expect(getEmailTranslations('fr' as Locale)).toBe(en.emails);

    expect(hasTranslation('en', 'emails.common.greeting')).toBe(true);
    expect(hasTranslation('es', 'emails.waitlist.body.confirmButton')).toBe(true);
    expect(hasTranslation('en', 'emails.common')).toBe(false);
    expect(hasTranslation('en', 'emails.missing')).toBe(false);
  });

  it('keeps English and Spanish leaf keys and placeholders in recursive parity', () => {
    const english = flattenCatalog(en);
    const spanish = flattenCatalog(es);
    const englishKeys = [...english.keys()].sort();
    const spanishKeys = [...spanish.keys()].sort();
    const representativeKeys = [
      'emails.common.greeting',
      'emails.common.copyright',
      'emails.workItem.subject.moved',
      'emails.ideaHub.body.greeting',
      'emails.memberRemoval.subject',
      'emails.waitlist.body.confirmButton',
      'emails.waitlistThankYou.body.greeting',
    ];

    for (const key of representativeKeys) {
      expect(englishKeys).toContain(key);
      expect(spanishKeys).toContain(key);
    }

    expect(spanishKeys).toEqual(englishKeys);

    for (const key of englishKeys) {
      const englishValue = english.get(key);
      const spanishValue = spanish.get(key);

      if (englishValue === undefined || spanishValue === undefined) {
        throw new Error(`Missing translation leaf at "${key}"`);
      }

      expect(placeholders(spanishValue)).toEqual(placeholders(englishValue));
    }
  });
});
