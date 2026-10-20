(() => {
  const clean = value => (value || '').replace(/\s+/g, ' ').trim();
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const nameSelector = '[data-testid="contact-name"], [data-testid="profile-name"], [class*="contact-name"], [class*="contactName"], [class*="profile-name"], [class*="profileName"], a[href*="/profile/"], h2, h3, h4, strong, b';
  function nameElement(card) {
    return [...card.querySelectorAll('*')].find(el =>
      (el.matches(nameSelector) || (el.matches('a, span, div') && Number(getComputedStyle(el).fontWeight) >= 600 && !el.children.length)) &&
      visible(el) && clean(el.textContent).length > 1 && clean(el.textContent).length < 120 &&
      !/^(view |show |search|select|current company)|@|\bat\b.*\b(?:present|current)\b/i.test(clean(el.textContent)));
  }
  function addresses(card) {
    const found = [];
    // Leaf text and mailto links preserve the displayed order and full addresses.
    for (const el of card.querySelectorAll('*')) {
      if (!visible(el)) continue;
      const text = el.matches('a[href^="mailto:"]') ? el.getAttribute('href').slice(7).split('?')[0] :
        [...el.childNodes].filter(node => node.nodeType === 3).map(node => node.textContent).join(' ');
      for (const match of text.matchAll(/[^\s<>(),;:"\[\]]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) {
        const email = match[0].replace(/[.!?]+$/, '');
        if (!/[*•…]/.test(email) && !found.some(value => value.toLowerCase() === email.toLowerCase())) found.push(email);
      }
    }
    return found.slice(0, 2);
  }
  function company(card) {
    const explicit = card.querySelector('[data-testid="current-company"], [data-field="current-company"], [class*="current-company"], [class*="currentCompany"]');
    if (explicit && visible(explicit)) return clean(explicit.textContent);
    // ContactOut shows current employment as "Title at Company in YYYY - Present".
    const lines = (card.innerText || '').split('\n').map(clean).filter(Boolean);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/\bat\s+(.+?)\s+(?:in\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:present|current|now)\b/i);
      if (match) return clean(match[1]).replace(/\s+in$/, '');
      if (/\b(?:present|current)\b/i.test(line)) {
        const block = lines.slice(Math.max(0, i - 3), i + 1).join(' ');
        const joined = block.match(/\bat\s+(.+?)\s+(?:in\s+)?(?:19|20)\d{2}\s*[-–—]\s*(?:present|current)/i);
        if (joined) return clean(joined[1]).replace(/\s+in$/, '');
      }
    }
    return ''; // Never substitute a previous employer for an unknown current one.
  }
  function httpUrl(value) {
    try {
      const url = new URL(value);
      return /^https?:$/.test(url.protocol) ? url : null;
    } catch { return null; }
  }
  function personalLinkedin(card) {
    for (const link of card.querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      const url = httpUrl(link.href);
      if (url && /(^|\.)linkedin\.com$/i.test(url.hostname) && /^\/in\/[^/]+/i.test(url.pathname)) {
        url.search = ''; url.hash = '';
        return url.href;
      }
    }
    return '';
  }
  function companyWebsite(card, companyName) {
    const blocked = /(^|\.)(linkedin\.com|contactout\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com)$/i;
    for (const link of card.querySelectorAll('a[href]')) {
      if (!visible(link)) continue;
      const url = httpUrl(link.href);
      if (!url || blocked.test(url.hostname)) continue;
      const description = clean([link.textContent, link.getAttribute('aria-label'), link.getAttribute('title')].join(' '));
      const explicit = link.matches('[data-testid="company-website"], [data-field="company-website"], [class*="company-website"], [class*="companyWebsite"]') ||
        link.closest('[data-testid="company-website"], [data-field="company-website"]');
      const companyLink = companyName && clean(link.textContent).toLowerCase() === companyName.toLowerCase();
      // Only use links identified as company websites. Never derive a website
      // from an email domain, or substitute a personal/social profile URL.
      if (explicit || companyLink || /\bcompany\s+(?:website|site)\b/i.test(description)) {
        url.hash = '';
        return url.href;
      }
    }
    const field = card.querySelector('[data-testid="company-website"], [data-field="company-website"]');
    if (field && visible(field)) {
      const text = clean(field.textContent);
      const url = httpUrl(/^https?:\/\//i.test(text) ? text : `https://${text}`);
      if (url && url.hostname.includes('.') && !blocked.test(url.hostname)) return url.href;
    }
    return '';
  }
  globalThis.extractContactRows = () => {
    const cards = new Set();
    const seeds = [...document.querySelectorAll('input[type="checkbox"], a[href^="mailto:"], button, [role="button"], a[href*="linkedin.com/in/"], div, span')]
      .filter(el => visible(el) && (el.matches('input,a') || /^view (email|phone)$/i.test(clean(el.textContent))));
    for (const seed of seeds) {
      for (let card = seed.parentElement; card && card !== document.body; card = card.parentElement) {
        const name = nameElement(card);
        if (!name) continue;
        if (card.querySelectorAll('input[type="checkbox"]').length > 1) break;
        const text = card.innerText || '';
        if (!/@|view email|view phone/i.test(text) && !card.querySelector('a[href^="mailto:"]')) continue;
        // A repeated card must not contain several independent profile names.
        const profileNames = [...card.querySelectorAll('a[href*="/profile/"]')].filter(el => clean(el.textContent));
        if (new Set(profileNames.map(el => el.href)).size > 1) break;
        cards.add(card); break;
      }
    }
    const outerCards = [...cards].filter(card => ![...cards].some(other => other !== card && other.contains(card)));
    const result = outerCards.sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map(card => {
      const companyName = company(card), linkedin = personalLinkedin(card);
      return {
        name: clean(nameElement(card).textContent), company: companyName,
        website: companyWebsite(card, companyName), linkedin, emails: addresses(card),
        profile: linkedin || card.querySelector('a[href*="/profile/"]')?.href || ''
      };
    });
    if (!result.length) throw new Error('Could not identify contact rows on this layout. No page was skipped.');
    if (result.length > 25) throw new Error('Found more than 25 contact rows; stopped to avoid mixing results.');
    return result;
  };
})();
