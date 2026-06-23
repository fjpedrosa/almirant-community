// ---------------------------------------------------------------------------
// Feedback Widget - UI Orchestrator
// ---------------------------------------------------------------------------
// Main module that ties together styles, DOM elements, event handling, and
// the widget's open/close lifecycle.  Exports three functions consumed by
// `src/index.ts`: `renderUI`, `showModal`, `hideModal`, `destroyUI`.
// ---------------------------------------------------------------------------

import { RateLimitError, NetworkError } from '../api';
import type { FeedbackWidgetConfig } from '../types';
import { buildStylesheet } from './styles';
import { createBackdrop, createModal, createTriggerButton } from './elements';

// ---------------------------------------------------------------------------
// Module state -- references to mounted DOM nodes
// ---------------------------------------------------------------------------

interface UiRefs {
  style: HTMLStyleElement;
  trigger: HTMLButtonElement;
  backdrop: HTMLDivElement;
  modal: HTMLDivElement;
  textarea: HTMLTextAreaElement;
  emailInput: HTMLInputElement;
  emailHintEl: HTMLDivElement;
  categorySelect: HTMLSelectElement | null;
  submitBtn: HTMLButtonElement;
  statusEl: HTMLDivElement;
  charCountEl: HTMLDivElement;
  form: HTMLFormElement;
  keydownHandler: (e: KeyboardEvent) => void;
}

let refs: UiRefs | null = null;

// ---------------------------------------------------------------------------
// Status message helpers
// ---------------------------------------------------------------------------

const showStatus = (
  el: HTMLDivElement,
  type: 'success' | 'error',
  message: string,
  onRetry?: () => void,
): void => {
  el.className = `fw-status fw-status--visible fw-status--${type}`;

  if (onRetry) {
    // Build a layout with the message + a retry button.
    el.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'fw-status-content';

    const msgSpan = document.createElement('span');
    msgSpan.className = 'fw-status-message';
    msgSpan.textContent = message;

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'fw-retry-btn';
    retryBtn.textContent = 'Try again';
    retryBtn.setAttribute('aria-label', 'Retry submission');
    retryBtn.addEventListener('click', onRetry);

    wrapper.appendChild(msgSpan);
    wrapper.appendChild(retryBtn);
    el.appendChild(wrapper);
  } else {
    el.textContent = message;
  }
};

const hideStatus = (el: HTMLDivElement): void => {
  el.className = 'fw-status';
  el.innerHTML = '';
};

// ---------------------------------------------------------------------------
// Form state helpers
// ---------------------------------------------------------------------------

const MIN_MESSAGE_LENGTH = 10;

const setSubmitting = (submitting: boolean): void => {
  if (!refs) return;
  refs.submitBtn.textContent = submitting ? 'Sending...' : 'Send Feedback';
  refs.textarea.disabled = submitting;
  refs.emailInput.disabled = submitting;
  if (refs.categorySelect) refs.categorySelect.disabled = submitting;

  if (submitting) {
    refs.submitBtn.disabled = true;
  } else {
    // Re-evaluate based on current message length so the button stays
    // disabled when the message is too short.
    const trimmedLen = refs.textarea.value.trim().length;
    refs.submitBtn.disabled = trimmedLen < MIN_MESSAGE_LENGTH;
  }
};

const resetForm = (): void => {
  if (!refs) return;
  refs.form.reset();
  refs.charCountEl.textContent = `0 / 5000 (min ${MIN_MESSAGE_LENGTH})`;
  refs.charCountEl.classList.remove('fw-char-count--over', 'fw-char-count--warning');
  refs.emailHintEl.classList.remove('fw-validation-hint--visible');
  refs.emailInput.classList.remove('fw-input--invalid');
  refs.submitBtn.disabled = true; // Message is empty after reset.
  hideStatus(refs.statusEl);
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Renders all widget UI elements inside the given container.
 *
 * @param container  - The `#feedback-widget-root` element created by `init()`.
 * @param config     - Active widget configuration.
 * @param onOpen     - Callback to invoke when the user clicks the trigger
 *                     (should call `open()` from the public API).
 * @param onClose    - Callback to invoke when the user closes the modal
 *                     (should call `close()` from the public API).
 * @param onSubmit   - Callback to invoke when the form is submitted.
 */
export const renderUI = (
  container: HTMLElement,
  config: FeedbackWidgetConfig,
  onOpen: () => void,
  onClose: () => void,
  onSubmit: (data: {
    message: string;
    category?: string;
    email?: string;
  }) => Promise<void>,
): void => {
  if (refs) {
    // Already rendered; avoid duplicates.
    return;
  }

  // ---- Inject scoped styles ----
  const style = document.createElement('style');
  style.setAttribute('data-feedback-widget-styles', '');
  style.textContent = buildStylesheet(
    config.position ?? 'bottom-right',
    config.theme ?? 'auto',
  );
  container.appendChild(style);

  // ---- Create elements ----
  const trigger = createTriggerButton(() => {
    onOpen();
  });

  const backdrop = createBackdrop(() => {
    onClose();
  });

  const modalResult = createModal(
    config,
    () => {
      onClose();
    },
    async (data) => {
      // Extracted submission logic so it can be invoked by the retry button
      // with the same form data.
      const doSubmit = async (
        payload: { message: string; category?: string; email?: string },
      ): Promise<void> => {
        hideStatus(modalResult.statusEl);
        setSubmitting(true);

        try {
          await onSubmit(payload);
          showStatus(
            modalResult.statusEl,
            'success',
            'Thank you! Your feedback has been sent.',
          );
          // Reset form fields after short delay so user sees success message
          setTimeout(() => {
            resetForm();
            onClose();
          }, 1500);
        } catch (err) {
          let message: string;

          if (err instanceof RateLimitError) {
            message = err.message;
          } else if (err instanceof NetworkError) {
            message = err.message;
          } else {
            message =
              err instanceof Error
                ? err.message
                : 'Something went wrong. Please try again.';
          }

          // Show error with a retry button for all failure types.
          showStatus(modalResult.statusEl, 'error', message, () => {
            void doSubmit(payload);
          });
        } finally {
          setSubmitting(false);
        }
      };

      await doSubmit(data);
    },
  );

  // Clear error status when the user starts typing in the textarea
  // (indicates they are preparing a new attempt).
  modalResult.textarea.addEventListener('input', () => {
    const statusEl = modalResult.statusEl;
    if (statusEl.classList.contains('fw-status--error')) {
      hideStatus(statusEl);
    }
  });

  // ---- Keyboard handler (Escape to close) ----
  const keydownHandler = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // ---- Mount into container ----
  container.appendChild(trigger);
  container.appendChild(backdrop);
  container.appendChild(modalResult.modal);

  // ---- Store refs ----
  refs = {
    style,
    trigger,
    backdrop,
    modal: modalResult.modal,
    textarea: modalResult.textarea,
    emailInput: modalResult.emailInput,
    emailHintEl: modalResult.emailHintEl,
    categorySelect: modalResult.categorySelect,
    submitBtn: modalResult.submitBtn,
    statusEl: modalResult.statusEl,
    charCountEl: modalResult.charCountEl,
    form: modalResult.form,
    keydownHandler,
  };
};

/**
 * Reveals the modal and hides the trigger button.
 * Manages focus by moving it into the modal textarea.
 */
export const showModal = (): void => {
  if (!refs) return;

  refs.trigger.classList.add('fw-trigger--hidden');
  refs.trigger.setAttribute('aria-expanded', 'true');
  refs.backdrop.classList.add('fw-backdrop--visible');
  refs.modal.classList.add('fw-modal--open');

  // Add keyboard listener
  document.addEventListener('keydown', refs.keydownHandler);

  // Focus the textarea after the transition completes
  requestAnimationFrame(() => {
    refs?.textarea.focus();
  });
};

/**
 * Hides the modal and shows the trigger button.
 * Moves focus back to the trigger button.
 */
export const hideModal = (): void => {
  if (!refs) return;

  refs.modal.classList.remove('fw-modal--open');
  refs.backdrop.classList.remove('fw-backdrop--visible');
  refs.trigger.classList.remove('fw-trigger--hidden');
  refs.trigger.setAttribute('aria-expanded', 'false');

  // Remove keyboard listener
  document.removeEventListener('keydown', refs.keydownHandler);

  // Reset status messages (but not form data -- user may reopen)
  hideStatus(refs.statusEl);

  // Return focus to trigger after transition
  requestAnimationFrame(() => {
    refs?.trigger.focus();
  });
};

/**
 * Removes all widget UI elements from the DOM and cleans up event listeners.
 * Should be called **before** the container itself is removed.
 */
export const destroyUI = (): void => {
  if (!refs) return;

  // Remove keyboard listener
  document.removeEventListener('keydown', refs.keydownHandler);

  // Remove DOM nodes from their parent (the container)
  refs.style.remove();
  refs.trigger.remove();
  refs.backdrop.remove();
  refs.modal.remove();

  refs = null;
};
