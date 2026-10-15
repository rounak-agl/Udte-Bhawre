const { getCurrentProvider } = require('../sessions/agent-session');
const { DEFAULT_PROVIDER, resolveProviderKey, isKnownProvider } = require('../sessions/providers');

/** The default provider for agents without their own (falls back if it was removed). */
function defaultProviderKey() {
  const stored = resolveProviderKey(getCurrentProvider());
  return isKnownProvider(stored) ? stored : DEFAULT_PROVIDER;
}

/** The provider an agent actually uses: its own, else the default. */
function providerFor(char) {
  return char.provider ? resolveProviderKey(char.provider) : defaultProviderKey();
}

module.exports = { defaultProviderKey, providerFor };
