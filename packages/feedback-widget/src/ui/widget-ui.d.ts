import type { FeedbackWidgetConfig } from '../types';
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
export declare const renderUI: (container: HTMLElement, config: FeedbackWidgetConfig, onOpen: () => void, onClose: () => void, onSubmit: (data: {
    message: string;
    category?: string;
    email?: string;
}) => Promise<void>) => void;
/**
 * Reveals the modal and hides the trigger button.
 * Manages focus by moving it into the modal textarea.
 */
export declare const showModal: () => void;
/**
 * Hides the modal and shows the trigger button.
 * Moves focus back to the trigger button.
 */
export declare const hideModal: () => void;
/**
 * Removes all widget UI elements from the DOM and cleans up event listeners.
 * Should be called **before** the container itself is removed.
 */
export declare const destroyUI: () => void;
