// Helpers are injected on each page; only the worker starts actions.
(() => {
  if (globalThis.__coPage?.version === 3) return;
  globalThis.__coPage?.restoreCapture();
  const clean = text => (text || "").replace(/\s+/g, " ").trim();
  const label = el => clean(el.innerText || el.textContent).toLowerCase();
  const visible = el => el.isConnected && el.getClientRects().length > 0 &&
    getComputedStyle(el).visibility !== "hidden" && getComputedStyle(el).display !== "none";
  const enabled = el => visible(el) && !el.disabled && !el.closest('[disabled], [aria-disabled="true"], [inert], .disabled');
  const controls = () => [...document.querySelectorAll('button, a, [role="button"]')];
  function emails() {
    const found = new Set();
    for (const el of document.querySelectorAll('button, a, [role="button"], span, div')) {
      if (label(el) !== "view email" || !enabled(el) || [...el.children].some(c => label(c) === "view email")) continue;
      const control = el.closest('button, a, [role="button"]') || el;
      if (enabled(control) && label(control) === "view email") found.add(control);
    }
    return [...found].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top ||
      a.getBoundingClientRect().left - b.getBoundingClientRect().left);
  }
  function range() {
    const matches = [...document.querySelectorAll('span, p, div')].filter(el => visible(el) &&
      /^\d[\d,]*\s*[-–—]\s*\d[\d,]*\s+of\s+[\d,]+\s+(profiles|contacts|results)\b/i.test(clean(el.textContent)) && clean(el.textContent).length < 100);
    return matches.find(el => !matches.some(other => other !== el && el.contains(other)));
  }
  function nextControl() {
    const explicit = controls().filter(el => visible(el) &&
      /^(next|next page|go to next page|next results|›|»|→)$/i.test(clean(el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent)));
    const rel = document.querySelector('a[rel="next"]');
    if (rel && visible(rel)) explicit.push(rel);
    if (explicit.length) return [...new Set(explicit)].find(enabled) || explicit[0];
    // Match the two icon arrows beside ContactOut's result-count marker.
    const marker = range();
    if (!marker) return null;
    const rect = marker.getBoundingClientRect();
    const arrows = controls().filter(el => {
      const box = el.getBoundingClientRect();
      return visible(el) && el.querySelector('svg') && !label(el) &&
        box.left >= rect.right - 5 && box.left < rect.right + 350 &&
        Math.abs((box.top + box.height / 2) - (rect.top + rect.height / 2)) < 25 && box.width < 70;
    }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);
    return arrows.length === 2 ? arrows[1] : null;
  }
  function identity() {
    const marker = range();
    const links = [...document.querySelectorAll('a[href*="linkedin.com/in/"], a[href*="/profile/"]')].map(el => el.href).sort();
    return { range: marker ? clean(marker.textContent) : "", links: [...new Set(links)].join("|") };
  }
  let attempted = new WeakSet();
  let countBeforeClick = 0;
  let restore = [];
  let captureState = null;
  function restoreCapture() { for (const undo of restore.reverse()) undo(); restore = []; captureState = null; }
  function setStyle(el, property, value) {
    const old = el.style.getPropertyValue(property), priority = el.style.getPropertyPriority(property);
    restore.push(() => old ? el.style.setProperty(property, old, priority) : el.style.removeProperty(property));
    el.style.setProperty(property, value, 'important');
  }
  function capturePosition() {
    if (!captureState) throw new Error("Screenshot session is not active.");
    const { scroller, documentScroll, maxScroll } = captureState;
    const rect = scroller.getBoundingClientRect();
    return { documentScroll, x: documentScroll ? 0 : rect.left + scroller.clientLeft,
      y: documentScroll ? 0 : rect.top + scroller.clientTop,
      width: documentScroll ? innerWidth : scroller.clientWidth,
      height: documentScroll ? Math.min(innerHeight, scroller.clientHeight) : scroller.clientHeight,
      total: maxScroll + (documentScroll ? Math.min(innerHeight, scroller.clientHeight) : scroller.clientHeight),
      contentHeight: scroller.scrollHeight, maxScroll, top: scroller.scrollTop,
      viewportWidth: innerWidth, viewportHeight: innerHeight, dpr: devicePixelRatio };
  }
  globalThis.__coPage = {
    version: 3,
    reset() { attempted = new WeakSet(); return this.info(); },
    info() {
      return { ...identity(), ready: document.readyState !== "loading", count: emails().length,
        busy: [...document.querySelectorAll('[aria-busy="true"], [role="progressbar"]')].some(visible) };
    },
    clickEmail() {
      if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')].some(visible))
        throw new Error("ContactOut opened a dialog. Close it before starting again.");
      const remaining = emails();
      const el = remaining.find(el => !attempted.has(el));
      if (!el) return false;
      countBeforeClick = remaining.length;
      attempted.add(el);
      el.click();
      return true;
    },
    emailSettled() {
      if ([...document.querySelectorAll('[role="dialog"], [aria-modal="true"], dialog[open]')].some(visible))
        throw new Error("ContactOut opened a dialog. Close it before starting again.");
      return emails().length < countBeforeClick && !this.info().busy;
    },
    next() {
      const el = nextControl();
      if (!el) throw new Error("Could not identify the Next page button. Stopped to avoid clicking the wrong control.");
      if (!enabled(el)) return false;
      el.click();
      return true;
    },
    prepareCapture() {
      restoreCapture();
      const x = scrollX, y = scrollY;
      restore.push(() => scrollTo(x, y));
      const root = document.scrollingElement;
      const anchors = [...document.querySelectorAll('button, a, span, div, [role="button"]')].filter(el =>
        visible(el) && ((/^view (email|phone)$/.test(label(el)) && ![...el.children].some(c => label(c) === label(el))) || el.href?.includes('linkedin.com/in/')));
      const candidates = new Map();
      for (const anchor of anchors) for (let el = anchor.parentElement; el && el !== root; el = el.parentElement) {
        if (el.clientHeight > 100 && el.clientWidth > 300 && el.scrollHeight > el.clientHeight + 2 && /auto|scroll|hidden/.test(getComputedStyle(el).overflowY))
          candidates.set(el, (candidates.get(el) || 0) + 1);
      }
      // Revealed rows may no longer contain View email or View phone labels.
      // Consider large scroll panels too, then prove that each candidate moves.
      for (const el of document.querySelectorAll('body *')) {
        if (!candidates.has(el) && visible(el) && el.clientHeight > 150 && el.clientWidth > innerWidth * .45 &&
          el.scrollHeight > el.clientHeight + 2 && /auto|scroll|hidden/.test(getComputedStyle(el).overflowY)) candidates.set(el, 0);
      }
      const ranked = [...candidates].sort((a, b) => b[1] - a[1] || b[0].clientWidth - a[0].clientWidth).map(([el]) => el);
      if (!ranked.includes(root)) ranked.push(root);
      let scroller = null, maxScroll = 0;
      for (const candidate of ranked) {
        const before = candidate.scrollTop;
        const oldBehavior = candidate.style.getPropertyValue('scroll-behavior');
        const oldPriority = candidate.style.getPropertyPriority('scroll-behavior');
        const oldSnap = candidate.style.getPropertyValue('scroll-snap-type');
        const snapPriority = candidate.style.getPropertyPriority('scroll-snap-type');
        try {
          candidate.style.setProperty('scroll-behavior', 'auto', 'important');
          candidate.style.setProperty('scroll-snap-type', 'none', 'important');
          candidate.scrollTop = candidate.scrollHeight;
          const reached = candidate.scrollTop;
          const expected = Math.max(0, candidate.scrollHeight - candidate.clientHeight);
          if ((reached > 1 || (candidate === root && candidates.size === 0 && expected <= 1)) && Math.abs(reached - expected) <= 2) {
            scroller = candidate;
            maxScroll = reached;
          }
        } finally {
          candidate.scrollTop = before;
          oldBehavior ? candidate.style.setProperty('scroll-behavior', oldBehavior, oldPriority) : candidate.style.removeProperty('scroll-behavior');
          oldSnap ? candidate.style.setProperty('scroll-snap-type', oldSnap, snapPriority) : candidate.style.removeProperty('scroll-snap-type');
        }
        if (scroller) break;
      }
      if (!scroller) throw new Error("Could not find a results panel that scrolls. Use GoFullPage manually for this layout.");
      const top = scroller.scrollTop, left = scroller.scrollLeft;
      restore.push(() => { scroller.scrollTop = top; scroller.scrollLeft = left; });
      setStyle(root, 'scroll-behavior', 'auto');
      setStyle(scroller, 'scroll-behavior', 'auto');
      setStyle(scroller, 'scroll-snap-type', 'none');
      setStyle(scroller, 'overflow-anchor', 'none');
      const animationStyle = document.createElement('style');
      animationStyle.textContent = '* { animation-play-state: paused !important; caret-color: transparent !important; }';
      document.documentElement.append(animationStyle);
      restore.push(() => animationStyle.remove());
      scrollTo(0, 0);
      scroller.scrollTop = 0;
      scroller.scrollLeft = 0;
      captureState = { scroller, documentScroll: scroller === root, hidden: false, maxScroll };
      const geometry = capturePosition();
      if (geometry.y < 0 || geometry.x < 0 || geometry.y + geometry.height > innerHeight + 1 || geometry.x + geometry.width > innerWidth + 1)
        throw new Error("The results panel is partly outside the viewport. Maximize the browser and try again.");
      return geometry;
    },
    scrollCapture({ top, subsequent }) {
      if (!captureState) throw new Error("Screenshot session is not active.");
      if (subsequent && !captureState.hidden) {
        const { scroller, documentScroll } = captureState;
        for (const el of document.querySelectorAll('body *')) {
          const position = getComputedStyle(el).position;
          // Hide sticky/floating overlays in captured content after the first tile.
          // Never hide a wrapper containing the entire results scroller.
          if ((position === 'fixed' || position === 'sticky') && !el.contains(scroller) &&
            (documentScroll || scroller.contains(el) || position === 'fixed')) setStyle(el, 'visibility', 'hidden');
        }
        captureState.hidden = true;
      }
      captureState.scroller.scrollTo({ top: Math.min(top, captureState.maxScroll), left: 0, behavior: 'instant' });
      return capturePosition();
    },
    capturePosition,
    restoreCapture
  };
})();
