import type { WidgetPosition, WidgetTheme } from '../types';
/**
 * Generates the complete CSS string for the widget given the active config.
 *
 * @param position - Where the button/modal sit on screen.
 * @param theme    - Which colour scheme to apply.
 * @returns A full CSS string ready to be inserted as `<style>` text content.
 */
export declare const buildStylesheet: (position?: WidgetPosition, theme?: WidgetTheme) => string;
