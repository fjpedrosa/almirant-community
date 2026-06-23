import type { FeedbackWidgetConfig } from '../types';
/**
 * Creates the floating trigger button.
 *
 * @param onClick - Handler invoked when the button is clicked.
 */
export declare const createTriggerButton: (onClick: () => void) => HTMLButtonElement;
/**
 * Creates the semi-transparent backdrop behind the modal.
 *
 * @param onClick - Handler invoked when the backdrop is clicked (typically
 *                  closes the modal).
 */
export declare const createBackdrop: (onClick: () => void) => HTMLDivElement;
/**
 * Creates the modal panel including header, form body, and footer.
 *
 * @param config   - Widget config (used to render categories).
 * @param onClose  - Handler for the close button.
 * @param onSubmit - Handler for form submission.  Receives the form data.
 * @returns An object with the modal root element and references to key
 *          inner nodes needed by the orchestrator.
 */
export declare const createModal: (config: FeedbackWidgetConfig, onClose: () => void, onSubmit: (data: {
    message: string;
    category?: string;
    email?: string;
}) => void) => {
    modal: HTMLDivElement;
    textarea: HTMLTextAreaElement;
    emailInput: HTMLInputElement;
    categorySelect: HTMLSelectElement | null;
    submitBtn: HTMLButtonElement;
    statusEl: HTMLDivElement;
    charCountEl: HTMLDivElement;
    form: HTMLFormElement;
};
