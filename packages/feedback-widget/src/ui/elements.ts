// ---------------------------------------------------------------------------
// Feedback Widget - DOM Element Factories
// ---------------------------------------------------------------------------
// Pure factory functions that create and return DOM elements.  No side effects
// beyond the returned node -- mounting is the caller's responsibility.
// ---------------------------------------------------------------------------

import type { FeedbackWidgetConfig } from '../types';

// ---------------------------------------------------------------------------
// SVG icons (inline so we avoid external asset loading)
// ---------------------------------------------------------------------------

/** Chat bubble icon used on the floating trigger button. */
const chatIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
</svg>`;

/** X icon used on the modal close button. */
const closeIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" aria-hidden="true">
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
</svg>`;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum character length required for the message to be submittable. */
const MIN_MESSAGE_LENGTH = 10;

/** Basic email regex -- intentionally permissive (just structural check). */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------------------
// Generic helper
// ---------------------------------------------------------------------------

/**
 * Shorthand to create an element, assign classes, and set attributes.
 */
const createElement = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>,
): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      el.setAttribute(k, v);
    }
  }
  return el;
};

// ---------------------------------------------------------------------------
// Element factories
// ---------------------------------------------------------------------------

/**
 * Creates the floating trigger button.
 *
 * @param onClick - Handler invoked when the button is clicked.
 */
export const createTriggerButton = (onClick: () => void): HTMLButtonElement => {
  const btn = createElement('button', 'fw-trigger', {
    'type': 'button',
    'aria-label': 'Open feedback form',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
  });
  btn.innerHTML = chatIconSvg;
  btn.addEventListener('click', onClick);
  return btn;
};

/**
 * Creates the semi-transparent backdrop behind the modal.
 *
 * @param onClick - Handler invoked when the backdrop is clicked (typically
 *                  closes the modal).
 */
export const createBackdrop = (onClick: () => void): HTMLDivElement => {
  const el = createElement('div', 'fw-backdrop', {
    'aria-hidden': 'true',
  });
  el.addEventListener('click', onClick);
  return el;
};

/**
 * Creates the modal panel including header, form body, and footer.
 *
 * @param config   - Widget config (used to render categories).
 * @param onClose  - Handler for the close button.
 * @param onSubmit - Handler for form submission.  Receives the form data.
 * @returns An object with the modal root element and references to key
 *          inner nodes needed by the orchestrator.
 */
export const createModal = (
  config: FeedbackWidgetConfig,
  onClose: () => void,
  onSubmit: (data: {
    message: string;
    category?: string;
    email?: string;
  }) => void,
): {
  modal: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  emailInput: HTMLInputElement;
  emailHintEl: HTMLDivElement;
  categorySelect: HTMLSelectElement | null;
  submitBtn: HTMLButtonElement;
  statusEl: HTMLDivElement;
  charCountEl: HTMLDivElement;
  form: HTMLFormElement;
} => {
  const modal = createElement('div', 'fw-modal', {
    'role': 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Send feedback',
  });

  // ---- Header ----
  const header = createElement('div', 'fw-header');
  const title = createElement('span', 'fw-header-title');
  title.textContent = 'Send Feedback';

  const closeBtn = createElement('button', 'fw-close-btn', {
    'type': 'button',
    'aria-label': 'Close feedback form',
  });
  closeBtn.innerHTML = closeIconSvg;
  closeBtn.addEventListener('click', onClose);

  header.appendChild(title);
  header.appendChild(closeBtn);

  // ---- Body (form) ----
  const form = createElement('form', undefined, {
    'novalidate': '',
  });
  const body = createElement('div', 'fw-body');

  // Status message area
  const statusEl = createElement('div', 'fw-status', {
    'role': 'alert',
    'aria-live': 'polite',
  });

  body.appendChild(statusEl);

  // Category select (conditional)
  let categorySelect: HTMLSelectElement | null = null;

  if (config.categories && config.categories.length > 0) {
    const field = createElement('div', 'fw-field');
    const label = createElement('label', 'fw-label', { for: 'fw-category' });
    label.textContent = 'Category';

    categorySelect = createElement('select', 'fw-select', {
      id: 'fw-category',
      name: 'category',
    });

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = 'Select a category...';
    categorySelect.appendChild(defaultOpt);

    for (const cat of config.categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    }

    field.appendChild(label);
    field.appendChild(categorySelect);
    body.appendChild(field);
  }

  // Message textarea
  const messageField = createElement('div', 'fw-field');
  const messageLabel = createElement('label', 'fw-label', { for: 'fw-message' });
  messageLabel.textContent = 'Message *';

  const textarea = createElement('textarea', 'fw-textarea', {
    id: 'fw-message',
    name: 'message',
    placeholder: "What's on your mind?",
    required: '',
    maxlength: '5000',
    rows: '4',
  });

  const charCountEl = createElement('div', 'fw-char-count');
  charCountEl.textContent = `0 / 5000 (min ${MIN_MESSAGE_LENGTH})`;

  // NOTE: `submitBtn` is referenced here but declared further down. The
  // listener is only invoked by user input which happens well after the
  // button is in the DOM, so the forward reference is safe.
  textarea.addEventListener('input', () => {
    const len = textarea.value.length;
    const trimmedLen = textarea.value.trim().length;

    charCountEl.textContent = `${len} / 5000`;

    // Visual feedback: over limit
    charCountEl.classList.remove('fw-char-count--over', 'fw-char-count--warning');
    if (len > 5000) {
      charCountEl.classList.add('fw-char-count--over');
    } else if (trimmedLen > 0 && trimmedLen < MIN_MESSAGE_LENGTH) {
      charCountEl.classList.add('fw-char-count--warning');
      charCountEl.textContent = `${len} / 5000 (min ${MIN_MESSAGE_LENGTH})`;
    }

    // Enable/disable submit button based on minimum length
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    submitBtn.disabled = trimmedLen < MIN_MESSAGE_LENGTH;
  });

  messageField.appendChild(messageLabel);
  messageField.appendChild(textarea);
  messageField.appendChild(charCountEl);
  body.appendChild(messageField);

  // Email input (optional)
  const emailField = createElement('div', 'fw-field');
  const emailLabel = createElement('label', 'fw-label', { for: 'fw-email' });
  emailLabel.textContent = 'Email (optional)';

  const emailInput = createElement('input', 'fw-input', {
    type: 'email',
    id: 'fw-email',
    name: 'email',
    placeholder: 'your@email.com',
    autocomplete: 'email',
  });

  const emailHintEl = createElement('div', 'fw-validation-hint fw-validation-hint--error');
  emailHintEl.textContent = 'Please enter a valid email address.';

  // Validate email on blur (only when user has typed something).
  emailInput.addEventListener('blur', () => {
    const val = emailInput.value.trim();
    if (val && !EMAIL_REGEX.test(val)) {
      emailHintEl.classList.add('fw-validation-hint--visible');
      emailInput.classList.add('fw-input--invalid');
    } else {
      emailHintEl.classList.remove('fw-validation-hint--visible');
      emailInput.classList.remove('fw-input--invalid');
    }
  });

  // Clear validation as soon as user starts fixing the email.
  emailInput.addEventListener('input', () => {
    emailHintEl.classList.remove('fw-validation-hint--visible');
    emailInput.classList.remove('fw-input--invalid');
  });

  emailField.appendChild(emailLabel);
  emailField.appendChild(emailInput);
  emailField.appendChild(emailHintEl);
  body.appendChild(emailField);

  form.appendChild(body);

  // ---- Footer ----
  const footer = createElement('div', 'fw-footer');
  const submitBtn = createElement('button', 'fw-submit-btn', {
    type: 'submit',
    'aria-label': 'Send feedback',
  });
  submitBtn.textContent = 'Send Feedback';
  // Start disabled -- message is empty on mount.
  submitBtn.disabled = true;
  footer.appendChild(submitBtn);
  form.appendChild(footer);

  // ---- Form submit handler ----
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const message = textarea.value.trim();
    if (!message || message.length < MIN_MESSAGE_LENGTH) {
      textarea.focus();
      return;
    }

    // Validate email format (if provided).
    const email = emailInput.value.trim();
    if (email && !EMAIL_REGEX.test(email)) {
      emailHintEl.classList.add('fw-validation-hint--visible');
      emailInput.classList.add('fw-input--invalid');
      emailInput.focus();
      return;
    }

    const data: { message: string; category?: string; email?: string } = {
      message,
    };

    if (categorySelect && categorySelect.value) {
      data.category = categorySelect.value;
    }

    if (email) {
      data.email = email;
    }

    onSubmit(data);
  });

  // ---- Assemble ----
  modal.appendChild(header);
  modal.appendChild(form);

  return {
    modal,
    textarea,
    emailInput,
    emailHintEl,
    categorySelect,
    submitBtn,
    statusEl,
    charCountEl,
    form,
  };
};
