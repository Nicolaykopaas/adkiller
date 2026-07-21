// element-picker.js
// Chrome MV3 content-script (isolated world). Injected on demand via
// chrome.scripting.executeScript when the user wants to manually block an
// element (like uBlock Origin's element picker).

(function () {
  'use strict';

  // 1. Guard against double injection.
  if (window.__bestAdblockPickerActive) {
    return;
  }
  window.__bestAdblockPickerActive = true;

  // Identifiers for our own overlay/tooltip elements so they can be excluded.
  var OVERLAY_ID = 'best-adblock-picker-overlay';
  var TOOLTIP_ID = 'best-adblock-picker-tooltip';
  var OWN_CLASS = 'best-adblock-picker-el';

  var currentTarget = null;

  // 2a. Highlight overlay (follows the mouse, marks element under pointer).
  var overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = OWN_CLASS;
  overlay.style.setProperty('position', 'absolute', 'important');
  overlay.style.setProperty('z-index', '2147483646', 'important');
  overlay.style.setProperty('background', 'rgba(211,54,130,0.3)', 'important');
  overlay.style.setProperty('border', '2px solid #d33682', 'important');
  overlay.style.setProperty('box-sizing', 'border-box', 'important');
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('margin', '0', 'important');
  overlay.style.setProperty('padding', '0', 'important');
  overlay.style.setProperty('top', '0', 'important');
  overlay.style.setProperty('left', '0', 'important');
  overlay.style.setProperty('width', '0', 'important');
  overlay.style.setProperty('height', '0', 'important');
  overlay.style.setProperty('display', 'none', 'important');

  // 2b. Tooltip box showing the selector that would be created.
  var tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = OWN_CLASS;
  tooltip.style.setProperty('position', 'fixed', 'important');
  tooltip.style.setProperty('z-index', '2147483647', 'important');
  tooltip.style.setProperty('background', '#002b36', 'important');
  tooltip.style.setProperty('color', '#fdf6e3', 'important');
  tooltip.style.setProperty('border', '1px solid #d33682', 'important');
  tooltip.style.setProperty('border-radius', '4px', 'important');
  tooltip.style.setProperty('padding', '4px 8px', 'important');
  tooltip.style.setProperty('font', '12px/1.4 monospace', 'important');
  tooltip.style.setProperty('max-width', '360px', 'important');
  tooltip.style.setProperty('white-space', 'pre-wrap', 'important');
  tooltip.style.setProperty('word-break', 'break-all', 'important');
  tooltip.style.setProperty('pointer-events', 'none', 'important');
  tooltip.style.setProperty('box-shadow', '0 2px 8px rgba(0,0,0,0.4)', 'important');
  tooltip.style.setProperty('display', 'none', 'important');
  tooltip.textContent = 'ESC to cancel';

  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(tooltip);

  // Helper: is this one of our own picker elements?
  function isOwnElement(el) {
    if (!el) {
      return true;
    }
    if (el === overlay || el === tooltip) {
      return true;
    }
    if (el.id === OVERLAY_ID || el.id === TOOLTIP_ID) {
      return true;
    }
    if (el.classList && el.classList.contains(OWN_CLASS)) {
      return true;
    }
    return false;
  }

  // Find the real element under the pointer, ignoring our own overlays.
  // Our overlay/tooltip already have pointer-events:none, so elementFromPoint
  // will not return them, but we guard defensively anyway.
  function elementUnder(x, y) {
    var el = document.elementFromPoint(x, y);
    if (isOwnElement(el)) {
      return null;
    }
    return el;
  }

  // Is a class name "stable" (not auto-generated / hashed)?
  function isStableClass(cls) {
    if (!cls) {
      return false;
    }
    if (cls.indexOf('best-adblock') !== -1) {
      return false;
    }
    if (/\d/.test(cls)) {
      return false;
    }
    if (cls.length > 20) {
      return false;
    }
    return true;
  }

  // Build up to 2 stable class parts for an element, e.g. ".foo.bar".
  function stableClassPart(el) {
    var part = '';
    if (!el.classList) {
      return part;
    }
    var count = 0;
    for (var i = 0; i < el.classList.length && count < 2; i++) {
      var cls = el.classList[i];
      if (isStableClass(cls)) {
        part += '.' + cls;
        count++;
      }
    }
    return part;
  }

  // Is a single path segment unique among the element's siblings?
  function isUniqueAmongSiblings(el, segment) {
    var parent = el.parentElement;
    if (!parent) {
      return true;
    }
    try {
      return parent.querySelectorAll(':scope > ' + segment).length === 1;
    } catch (e) {
      return false;
    }
  }

  // nth-of-type index (1-based) of el among siblings of same tag.
  function nthOfType(el) {
    var tag = el.tagName;
    var index = 1;
    var sib = el.previousElementSibling;
    while (sib) {
      if (sib.tagName === tag) {
        index++;
      }
      sib = sib.previousElementSibling;
    }
    return index;
  }

  // 5. Robust CSS selector generation.
  function computeSelector(el) {
    if (!el || el.nodeType !== 1) {
      return '';
    }

    // Prefer a valid CSS id.
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
      return '#' + el.id;
    }

    var parts = [];
    var node = el;
    var depth = 0;

    // Element plus up to 4 ancestors (5 levels total).
    while (node && node.nodeType === 1 && depth < 5) {
      var tag = node.tagName.toLowerCase();
      var segment = tag + stableClassPart(node);

      if (!isUniqueAmongSiblings(node, segment)) {
        segment += ':nth-of-type(' + nthOfType(node) + ')';
      }

      parts.unshift(segment);

      // If this ancestor has a usable id, anchor here and stop.
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id) && node !== el) {
        parts[0] = '#' + node.id;
        break;
      }

      node = node.parentElement;
      depth++;
    }

    return parts.join(' > ');
  }

  // Position the overlay over an element using page (scroll-aware) coords.
  function positionOverlay(el) {
    var rect = el.getBoundingClientRect();
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft || 0;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop || 0;
    overlay.style.setProperty('display', 'block', 'important');
    overlay.style.setProperty('top', (rect.top + scrollY) + 'px', 'important');
    overlay.style.setProperty('left', (rect.left + scrollX) + 'px', 'important');
    overlay.style.setProperty('width', rect.width + 'px', 'important');
    overlay.style.setProperty('height', rect.height + 'px', 'important');
  }

  function positionTooltip(x, y, text) {
    tooltip.textContent = text;
    tooltip.style.setProperty('display', 'block', 'important');
    var tx = x + 12;
    var ty = y + 12;
    // Keep tooltip roughly inside the viewport.
    if (tx + 360 > window.innerWidth) {
      tx = Math.max(0, window.innerWidth - 372);
    }
    if (ty + 60 > window.innerHeight) {
      ty = Math.max(0, y - 60);
    }
    tooltip.style.setProperty('left', tx + 'px', 'important');
    tooltip.style.setProperty('top', ty + 'px', 'important');
  }

  // Event handlers -----------------------------------------------------------

  function onMouseMove(e) {
    var el = elementUnder(e.clientX, e.clientY);
    if (!el) {
      currentTarget = null;
      overlay.style.setProperty('display', 'none', 'important');
      positionTooltip(e.clientX, e.clientY, 'ESC to cancel');
      return;
    }
    currentTarget = el;
    positionOverlay(el);
    positionTooltip(e.clientX, e.clientY, computeSelector(el) || el.tagName.toLowerCase());
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();

    var el = elementUnder(e.clientX, e.clientY) || currentTarget;
    if (!el || isOwnElement(el)) {
      cleanup();
      return;
    }

    var selector = computeSelector(el);

    // Send the rule to the background service worker.
    try {
      chrome.runtime.sendMessage({
        type: 'addUserRule',
        host: location.hostname,
        selector: selector
      });
    } catch (err) {
      // Extension context may be gone; ignore.
    }

    // Hide immediately.
    el.style.setProperty('display', 'none', 'important');

    cleanup();
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      cleanup();
    }
  }

  // Cleanup: remove overlay/tooltip, listeners, reset the active flag.
  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);

    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
    if (tooltip && tooltip.parentNode) {
      tooltip.parentNode.removeChild(tooltip);
    }

    currentTarget = null;
    window.__bestAdblockPickerActive = false;
  }

  // Attach listeners in capture phase so we win over page handlers.
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();
