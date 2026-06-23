/**
 * Supported locales for backend i18n
 */
export type Locale = 'en' | 'es';

/**
 * Array of all supported locales
 */
export const SUPPORTED_LOCALES: Locale[] = ['en', 'es'];

/**
 * Default locale to use when none is specified
 */
export const DEFAULT_LOCALE: Locale = 'en';

/**
 * Type guard to check if a string is a valid locale
 */
export function isValidLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}

/**
 * Parse a locale string, returning the default if invalid
 */
export function parseLocale(value: string | undefined | null): Locale {
  if (!value) return DEFAULT_LOCALE;
  return isValidLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Translation namespace types for type-safe translations
 */
export interface EmailTranslations {
  common: {
    greeting: string;
    farewell: string;
    footer: string;
    poweredBy: string;
    viewInApp: string;
    viewReport: string;
    unsubscribe: string;
    manageNotifications: string;
    copyright: string;
  };
  workItem: {
    subject: {
      moved: string;
      assigned: string;
      completed: string;
      reviewed: string;
      userActions: string;
    };
    heading: {
      moved: string;
      assigned: string;
      completed: string;
      reviewed: string;
      userActions: string;
    };
    preheader: {
      moved: string;
      assigned: string;
      completed: string;
      reviewed: string;
      userActions: string;
    };
    body: {
      moved: string;
      movedFrom: string;
      movedTo: string;
      assigned: string;
      assignedTo: string;
      assignedBy: string;
      completed: string;
      completedBy: string;
      reviewed: string;
      reviewPassed: string;
      reviewFailed: string;
      reviewResult: string;
      viewDetails: string;
    };
    meta: {
      project: string;
      board: string;
    };
  };
  sprint: {
    subject: {
      closed: string;
    };
    heading: {
      closed: string;
    };
    preheader: {
      closed: string;
    };
    meta: {
      sprint: string;
      completed: string;
    };
  };
  ideaHub: {
    subject: {
      created: string;
      promoted: string;
      statusChanged: string;
      assignmentSingle: string;
      assignmentPlural: string;
      commentSingle: string;
      commentPlural: string;
      mentionSingle: string;
      mentionPlural: string;
    };
    body: {
      created: string;
      promoted: string;
      promotedTo: string;
      statusChanged: string;
      statusChangedFrom: string;
      statusChangedTo: string;
      viewIdea: string;
      greeting: string;
      assignmentSingle: string;
      assignmentPlural: string;
      assignedBy: string;
      commentSingle: string;
      commentPlural: string;
      commentedOn: string;
      mentionSingle: string;
      mentionPlural: string;
      mentionedOn: string;
      footer: string;
    };
  };
  memberRemoval: {
    subject: string;
    heading: string;
    preheader: string;
    body: {
      accessRevoked: string;
      disclaimer: string;
    };
    meta: {
      member: string;
      organization: string;
      removedOn: string;
    };
    cta: string;
  };
  waitlist: {
    subject: {
      confirmation: string;
      referralConfirmed: string;
      approved: string;
    };
    body: {
      confirmation: string;
      confirmationMessage: string;
      approved: string;
      approvedMessage: string;
      getStarted: string;
      header: string;
      subheading: string;
      greeting: string;
      greetingSuffix: string;
      confirmMessage: string;
      confirmButton: string;
      disclaimer: string;
      warmGreeting: string;
      footer: string;
      referralMessage: string;
      referralPointsAdded: string;
      referralFallbackName: string;
    };
  };
  waitlistThankYou: {
    subject: {
      pioneer: string;
      supporter: string;
      earlyAdopter: string;
    };
    body: {
      header: string;
      greeting: string;
      pioneer: {
        opening: string;
        main: string;
        closing: string;
      };
      supporter: {
        opening: string;
        main: string;
        closing: string;
      };
      earlyAdopter: {
        opening: string;
        main: string;
        closing: string;
      };
      replyInvite: string;
      signatureIntro: string;
      signature: string;
      footer: string;
    };
  };
}

/**
 * Root translation object type
 */
export interface Translations {
  emails: EmailTranslations;
}

/**
 * Deep partial type for allowing partial translations
 */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
