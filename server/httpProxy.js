// International APIs (Anthropic, Gemini) are geo-blocked in mainland China and
// must go through a local proxy (Clash). Node's BUILT-IN global fetch cannot
// accept the `undici` package's dispatcher (different undici instances →
// UND_ERR_INVALID_ARG), so for proxied calls we use undici's OWN fetch.
// Domestic APIs (Seedance/Ark, Doubao) must NOT be proxied — they use the
// plain built-in fetch (direct).
const undici = require('undici');

const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
const dispatcher = PROXY ? new undici.ProxyAgent(PROXY) : null;

// Fetch through the proxy when configured, else direct (built-in fetch).
function proxiedFetch(url, opts = {}) {
  if (dispatcher) return undici.fetch(url, { ...opts, dispatcher });
  return fetch(url, opts);
}

module.exports = { proxiedFetch, PROXY_ENABLED: !!PROXY, PROXY };
