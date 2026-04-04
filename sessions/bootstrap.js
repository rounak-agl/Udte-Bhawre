const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function runBootstrap() {
  const configDir = path.join(os.homedir(), '.openclaw');
  const openclawConfigPath = path.join(configDir, 'openclaw.json');
  const policyPath = path.join(configDir, 'antigravity.policy.json');

  // Ensure directory exists
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 1. Write defaults if openclaw.json is missing
  if (!fs.existsSync(openclawConfigPath)) {
    const defaultOpenclaw = {
      plugins: {
        entries: {
          armorclaw: {
            config: {
              apiKey: '',
              agentId: 'antigravity-agent-001',
              policyStorePath: policyPath
            }
          }
        }
      }
    };
    fs.writeFileSync(openclawConfigPath, JSON.stringify(defaultOpenclaw, null, 2), 'utf8');
    console.log('[Bootstrap] Wrote default openclaw.json');
  }

  // 2. Write defaults if policy file is missing
  if (!fs.existsSync(policyPath)) {
    const defaultPolicy = {
      agentId: "antigravity-agent-001",
      allow: ["read_file", "write_file", "web_search", "get_weather"],
      deny: ["bash_execute", "delete_file", "upload_external"]
    };
    fs.writeFileSync(policyPath, JSON.stringify(defaultPolicy, null, 2), 'utf8');
    console.log('[Bootstrap] Wrote default antigravity.policy.json');
  }

  // 3. Immediately read back and validate JSON and keys (boot-time validation)
  try {
    const loadedConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
    const armorclawConfig = loadedConfig.plugins?.entries?.armorclaw?.config;
    assert(armorclawConfig, 'armorclaw plugin configuration missing from openclaw.json');
    assert(armorclawConfig.policyStorePath, 'policyStorePath missing from openclaw.json config');
    assert(armorclawConfig.agentId, 'agentId missing from openclaw.json config');

    const loadedPolicy = JSON.parse(fs.readFileSync(armorclawConfig.policyStorePath, 'utf8'));
    assert(loadedPolicy.agentId, 'agentId missing from policy file');
    assert(Array.isArray(loadedPolicy.allow), 'allow list must be an array');
    assert(Array.isArray(loadedPolicy.deny), 'deny list must be an array');

    console.log('[Bootstrap] ✅ Configuration and policy file verified.');
  } catch (err) {
    console.error(`[Bootstrap] ❌ CRITICAL: Configuration verification failed! ${err.message}`);
    // Hard halt - do not silently fallback
    throw err;
  }
}

module.exports = { runBootstrap };
