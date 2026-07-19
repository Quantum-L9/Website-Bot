(function () {
  const params = new URLSearchParams(window.location.search);
  const keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
  const existing = JSON.parse(window.localStorage.getItem('sip_attribution') || '{}');
  const next = { ...existing };
  for (const key of keys) {
    const value = params.get(key);
    if (value) next[key] = value;
  }
  next.landing_page = existing.landing_page || window.location.pathname;
  next.last_seen_page = window.location.pathname;
  next.updated_at = new Date().toISOString();
  window.localStorage.setItem('sip_attribution', JSON.stringify(next));
  window.sipTrackConversion = function sipTrackConversion(eventName, payload) {
    window.dispatchEvent(new CustomEvent('sip:conversion', { detail: { eventName, payload, attribution: next } }));
  };
})();
