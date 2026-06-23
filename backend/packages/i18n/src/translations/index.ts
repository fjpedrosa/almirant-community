import type { Translations } from '../types';

/**
 * Index of all translation files
 * Maps locale to translation object
 */
import { en } from './en';
import { es } from './es';

export const translations: Record<string, Translations> = {
  en,
  es,
};

export { en, es };
