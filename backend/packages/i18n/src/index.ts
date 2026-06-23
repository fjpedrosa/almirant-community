// Types
export type {
  Locale,
  Translations,
  EmailTranslations,
  DeepPartial,
} from './types';

// Constants
export { SUPPORTED_LOCALES, DEFAULT_LOCALE } from './types';

// Type guards and parsers
export { isValidLocale, parseLocale } from './types';

// Translation files
export { translations, en, es } from './translations';

// Translation utilities
export {
  getTranslations,
  getTranslation,
  interpolate,
  t,
  createTranslator,
  getEmailTranslations,
  hasTranslation,
} from './lib/get-translation';
