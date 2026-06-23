// ---------------------------------------------------------------------------
// Feedback Widget - Styles Module
// ---------------------------------------------------------------------------
// All CSS for the widget is defined here as template strings and injected
// into the widget root container as a <style> element.  Every class name is
// prefixed with `fw-` to avoid collisions with the host page.
// ---------------------------------------------------------------------------

import type { WidgetPosition, WidgetTheme } from '../types';

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const lightTokens = `
  --fw-bg: #ffffff;
  --fw-bg-hover: #f8fafc;
  --fw-text: #0f172a;
  --fw-text-secondary: #64748b;
  --fw-border: #e2e8f0;
  --fw-primary: #6366f1;
  --fw-primary-hover: #4f46e5;
  --fw-primary-text: #ffffff;
  --fw-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  --fw-shadow-btn: 0 4px 14px -3px rgba(99, 102, 241, 0.5);
  --fw-input-bg: #ffffff;
  --fw-input-border: #e2e8f0;
  --fw-input-focus-border: #6366f1;
  --fw-input-focus-ring: rgba(99, 102, 241, 0.2);
  --fw-overlay: rgba(0, 0, 0, 0.1);
  --fw-success-bg: #ecfdf5;
  --fw-success-text: #065f46;
  --fw-error-bg: #fef2f2;
  --fw-error-text: #991b1b;
  --fw-warning-text: #92400e;
`;

const darkTokens = `
  --fw-bg: #1e293b;
  --fw-bg-hover: #334155;
  --fw-text: #f1f5f9;
  --fw-text-secondary: #94a3b8;
  --fw-border: #334155;
  --fw-primary: #818cf8;
  --fw-primary-hover: #6366f1;
  --fw-primary-text: #ffffff;
  --fw-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
  --fw-shadow-btn: 0 4px 14px -3px rgba(129, 140, 248, 0.4);
  --fw-input-bg: #0f172a;
  --fw-input-border: #334155;
  --fw-input-focus-border: #818cf8;
  --fw-input-focus-ring: rgba(129, 140, 248, 0.2);
  --fw-overlay: rgba(0, 0, 0, 0.3);
  --fw-success-bg: #064e3b;
  --fw-success-text: #a7f3d0;
  --fw-error-bg: #450a0a;
  --fw-error-text: #fecaca;
  --fw-warning-text: #fbbf24;
`;

// ---------------------------------------------------------------------------
// Position CSS map
// ---------------------------------------------------------------------------

const positionMap: Record<WidgetPosition, string> = {
  'bottom-right': `
    .fw-trigger { bottom: 20px; right: 20px; }
    .fw-modal { bottom: 84px; right: 20px; transform-origin: bottom right; }
  `,
  'bottom-left': `
    .fw-trigger { bottom: 20px; left: 20px; }
    .fw-modal { bottom: 84px; left: 20px; transform-origin: bottom left; }
  `,
  'top-right': `
    .fw-trigger { top: 20px; right: 20px; }
    .fw-modal { top: 84px; right: 20px; transform-origin: top right; }
  `,
  'top-left': `
    .fw-trigger { top: 20px; left: 20px; }
    .fw-modal { top: 84px; left: 20px; transform-origin: top left; }
  `,
};

// ---------------------------------------------------------------------------
// Core styles
// ---------------------------------------------------------------------------

const coreStyles = `
  /* Reset inside widget root */
  #feedback-widget-root *,
  #feedback-widget-root *::before,
  #feedback-widget-root *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  #feedback-widget-root {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
    color: var(--fw-text);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* ---- Trigger button ---- */

  .fw-trigger {
    position: fixed;
    z-index: 2147483645;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    border: none;
    background: var(--fw-primary);
    color: var(--fw-primary-text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: var(--fw-shadow-btn);
    transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease;
    outline: none;
    padding: 0;
  }

  .fw-trigger:hover {
    transform: scale(1.08);
    box-shadow: var(--fw-shadow);
  }

  .fw-trigger:focus-visible {
    outline: 2px solid var(--fw-primary);
    outline-offset: 3px;
  }

  .fw-trigger:active {
    transform: scale(0.96);
  }

  .fw-trigger svg {
    width: 24px;
    height: 24px;
    fill: currentColor;
  }

  .fw-trigger--hidden {
    opacity: 0;
    pointer-events: none;
    transform: scale(0.6);
  }

  /* ---- Modal overlay backdrop ---- */

  .fw-backdrop {
    position: fixed;
    inset: 0;
    z-index: 2147483646;
    background: var(--fw-overlay);
    opacity: 0;
    transition: opacity 0.2s ease;
    pointer-events: none;
  }

  .fw-backdrop--visible {
    opacity: 1;
    pointer-events: auto;
  }

  /* ---- Modal ---- */

  .fw-modal {
    position: fixed;
    z-index: 2147483647;
    width: 380px;
    max-height: calc(100vh - 120px);
    background: var(--fw-bg);
    border: 1px solid var(--fw-border);
    border-radius: 16px;
    box-shadow: var(--fw-shadow);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: scale(0.9);
    opacity: 0;
    transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
                opacity 0.2s ease;
    pointer-events: none;
  }

  .fw-modal--open {
    transform: scale(1);
    opacity: 1;
    pointer-events: auto;
  }

  /* ---- Header ---- */

  .fw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--fw-border);
    flex-shrink: 0;
  }

  .fw-header-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--fw-text);
  }

  .fw-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: var(--fw-text-secondary);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
    padding: 0;
  }

  .fw-close-btn:hover {
    background: var(--fw-bg-hover);
    color: var(--fw-text);
  }

  .fw-close-btn:focus-visible {
    outline: 2px solid var(--fw-primary);
    outline-offset: -2px;
  }

  .fw-close-btn svg {
    width: 18px;
    height: 18px;
    stroke: currentColor;
    stroke-width: 2;
    fill: none;
  }

  /* ---- Form body ---- */

  .fw-body {
    padding: 20px;
    overflow-y: auto;
    flex: 1;
  }

  .fw-field {
    margin-bottom: 16px;
  }

  .fw-field:last-child {
    margin-bottom: 0;
  }

  .fw-label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--fw-text-secondary);
    margin-bottom: 6px;
  }

  .fw-select,
  .fw-textarea,
  .fw-input {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    line-height: 1.5;
    color: var(--fw-text);
    background: var(--fw-input-bg);
    border: 1px solid var(--fw-input-border);
    border-radius: 10px;
    outline: none;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
    appearance: none;
    -webkit-appearance: none;
  }

  .fw-select:focus,
  .fw-textarea:focus,
  .fw-input:focus {
    border-color: var(--fw-input-focus-border);
    box-shadow: 0 0 0 3px var(--fw-input-focus-ring);
  }

  .fw-textarea {
    resize: vertical;
    min-height: 100px;
    max-height: 200px;
  }

  .fw-select {
    cursor: pointer;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 32px;
  }

  /* ---- Footer / submit ---- */

  .fw-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--fw-border);
    flex-shrink: 0;
  }

  .fw-submit-btn {
    width: 100%;
    padding: 10px 16px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    line-height: 1.5;
    color: var(--fw-primary-text);
    background: var(--fw-primary);
    border: none;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    outline: none;
  }

  .fw-submit-btn:hover:not(:disabled) {
    background: var(--fw-primary-hover);
  }

  .fw-submit-btn:focus-visible {
    outline: 2px solid var(--fw-primary);
    outline-offset: 3px;
  }

  .fw-submit-btn:active:not(:disabled) {
    transform: scale(0.98);
  }

  .fw-submit-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* ---- Status messages ---- */

  .fw-status {
    padding: 10px 14px;
    border-radius: 10px;
    font-size: 13px;
    margin-bottom: 16px;
    display: none;
  }

  .fw-status--visible {
    display: block;
  }

  .fw-status--success {
    background: var(--fw-success-bg);
    color: var(--fw-success-text);
  }

  .fw-status--error {
    background: var(--fw-error-bg);
    color: var(--fw-error-text);
  }

  /* ---- Character counter ---- */

  .fw-char-count {
    font-size: 12px;
    color: var(--fw-text-secondary);
    text-align: right;
    margin-top: 4px;
  }

  .fw-char-count--over {
    color: var(--fw-error-text);
  }

  .fw-char-count--warning {
    color: var(--fw-warning-text, #92400e);
  }

  /* ---- Validation hints ---- */

  .fw-validation-hint {
    font-size: 12px;
    margin-top: 4px;
    display: none;
  }

  .fw-validation-hint--visible {
    display: block;
  }

  .fw-validation-hint--error {
    color: var(--fw-error-text);
  }

  .fw-input--invalid {
    border-color: var(--fw-error-text) !important;
  }

  .fw-input--invalid:focus {
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.2) !important;
  }

  /* ---- Status area with retry ---- */

  .fw-status-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .fw-status-message {
    flex: 1;
  }

  .fw-retry-btn {
    flex-shrink: 0;
    padding: 4px 12px;
    font-size: 12px;
    font-weight: 600;
    font-family: inherit;
    line-height: 1.5;
    color: var(--fw-error-text);
    background: transparent;
    border: 1px solid var(--fw-error-text);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
    outline: none;
    white-space: nowrap;
  }

  .fw-retry-btn:hover {
    background: var(--fw-error-text);
    color: var(--fw-error-bg);
  }

  .fw-retry-btn:focus-visible {
    outline: 2px solid var(--fw-error-text);
    outline-offset: 2px;
  }

  /* ---- Responsive: mobile ---- */

  @media (max-width: 639px) {
    .fw-trigger {
      width: 48px;
      height: 48px;
    }

    .fw-trigger svg {
      width: 20px;
      height: 20px;
    }

    .fw-modal {
      width: 100%;
      max-width: 100%;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      top: auto !important;
      border-radius: 16px 16px 0 0;
      max-height: 85vh;
      transform-origin: bottom center;
    }
  }
`;

// ---------------------------------------------------------------------------
// Public: build the full stylesheet string
// ---------------------------------------------------------------------------

/**
 * Generates the complete CSS string for the widget given the active config.
 *
 * @param position - Where the button/modal sit on screen.
 * @param theme    - Which colour scheme to apply.
 * @returns A full CSS string ready to be inserted as `<style>` text content.
 */
export const buildStylesheet = (
  position: WidgetPosition = 'bottom-right',
  theme: WidgetTheme = 'auto',
): string => {
  let themeBlock: string;

  if (theme === 'light') {
    themeBlock = `#feedback-widget-root { ${lightTokens} }`;
  } else if (theme === 'dark') {
    themeBlock = `#feedback-widget-root { ${darkTokens} }`;
  } else {
    // auto: follow prefers-color-scheme
    themeBlock = `
      #feedback-widget-root { ${lightTokens} }
      @media (prefers-color-scheme: dark) {
        #feedback-widget-root { ${darkTokens} }
      }
    `;
  }

  const positionBlock = positionMap[position] ?? positionMap['bottom-right'];

  return `${themeBlock}\n${coreStyles}\n${positionBlock}`;
};
