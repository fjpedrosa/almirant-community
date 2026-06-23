/**
 * JavaScript overlay scripts for walkthrough video recordings.
 *
 * Playwright's built-in video recording captures the page viewport but does NOT
 * render a cursor, because interactions are dispatched via CDP (Chrome DevTools
 * Protocol) and bypass the OS-level pointer. These scripts inject lightweight
 * visual indicators so that viewers can follow along.
 *
 * Usage:
 *   - Inject via `page.addInitScript(getOverlayScript(viewport))` so the
 *     overlay survives navigations, or re-inject with `page.evaluate()` after
 *     each `browser_navigate` call.
 *   - The scripts are self-contained IIFE strings with no external dependencies.
 */

/**
 * Desktop cursor overlay.
 *
 * Renders a translucent red dot that tracks `mousemove` events and pulses on
 * click. The element is `pointer-events: none` and uses a very high z-index so
 * it never interferes with page interactions.
 */
export const CURSOR_OVERLAY_SCRIPT = `
(function() {
  if (document.getElementById('__walkthrough-cursor')) return;

  var cursor = document.createElement('div');
  cursor.id = '__walkthrough-cursor';
  cursor.style.cssText =
    'position:fixed;' +
    'width:20px;height:20px;' +
    'border-radius:50%;' +
    'background:rgba(255,68,68,0.6);' +
    'border:2px solid rgba(255,68,68,0.9);' +
    'pointer-events:none;' +
    'z-index:999999;' +
    'transform:translate(-50%,-50%);' +
    'transition:width 0.15s,height 0.15s,background 0.15s;' +
    'box-shadow:0 0 10px rgba(255,68,68,0.3);' +
    'left:-40px;top:-40px;';
  document.documentElement.appendChild(cursor);

  document.addEventListener('mousemove', function(e) {
    cursor.style.left = e.clientX + 'px';
    cursor.style.top = e.clientY + 'px';
  }, { passive: true });

  document.addEventListener('mousedown', function() {
    cursor.style.width = '30px';
    cursor.style.height = '30px';
    cursor.style.background = 'rgba(255,68,68,0.9)';
  });

  document.addEventListener('mouseup', function() {
    cursor.style.width = '20px';
    cursor.style.height = '20px';
    cursor.style.background = 'rgba(255,68,68,0.6)';
  });
})();
`;

/**
 * Mobile touch overlay.
 *
 * Creates an expanding ripple circle at each touch point (or emulated click).
 * The ripple animates from 0 to 60 px and fades out over 600 ms, then removes
 * itself from the DOM to avoid element accumulation.
 */
export const TOUCH_OVERLAY_SCRIPT = `
(function() {
  if (window.__walkthroughTouchOverlay) return;
  window.__walkthroughTouchOverlay = true;

  function createRipple(x, y) {
    var ripple = document.createElement('div');
    ripple.style.cssText =
      'position:fixed;' +
      'left:' + x + 'px;' +
      'top:' + y + 'px;' +
      'width:0;height:0;' +
      'border-radius:50%;' +
      'background:rgba(33,150,243,0.4);' +
      'border:2px solid rgba(33,150,243,0.7);' +
      'pointer-events:none;' +
      'z-index:999999;' +
      'transform:translate(-50%,-50%);';
    document.documentElement.appendChild(ripple);

    ripple.animate([
      { width: '0px', height: '0px', opacity: 1 },
      { width: '60px', height: '60px', opacity: 0 }
    ], { duration: 600, easing: 'ease-out' });

    setTimeout(function() { ripple.remove(); }, 600);
  }

  document.addEventListener('touchstart', function(e) {
    for (var i = 0; i < e.touches.length; i++) {
      createRipple(e.touches[i].clientX, e.touches[i].clientY);
    }
  }, { passive: true });

  document.addEventListener('click', function(e) {
    createRipple(e.clientX, e.clientY);
  });
})();
`;

/**
 * Returns the appropriate overlay script for the given viewport mode.
 *
 * @param viewport - `"desktop"` for the cursor-tracking dot, `"mobile"` for
 *   the touch ripple effect.
 */
export function getOverlayScript(viewport: "desktop" | "mobile"): string {
  return viewport === "mobile" ? TOUCH_OVERLAY_SCRIPT : CURSOR_OVERLAY_SCRIPT;
}
