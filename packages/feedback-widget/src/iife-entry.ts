// ---------------------------------------------------------------------------
// IIFE entry point
// ---------------------------------------------------------------------------
// This file is the entry for the `<script>` tag build.  It imports the full
// public API and assigns it to `window.FeedbackWidget` so consumers can use:
//
//   FeedbackWidget.init({ publicKey: '...' });
//   FeedbackWidget.open();
// ---------------------------------------------------------------------------

import FeedbackWidget from './index';

// Assign to the global scope for script-tag consumers.
(globalThis as Record<string, unknown>).FeedbackWidget = FeedbackWidget;
