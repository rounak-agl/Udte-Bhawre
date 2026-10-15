const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Boot-time setup for the ArmorIQ guard config. Never throws: a bad or foreign config
 * must not stop the app from starting — the guard just stays disabled (see
 * armoriq-guard.js initialize()), and the problem is logged.
 *
 * ~/.openclaw/openclaw.json may belong to a real OpenClaw install, so it is only
 * created when missing and never rewritten. The policy always comes from this app's
 * own armoriq.policy.json (loadArmorIQConfig ignores policyStorePath).
 */
function runBootstrap() {
  const projectRoot = path.join(__dirname, '..');
  const configDir = path.join(os.homedir(), '.openclaw');
  const openclawConfigPath = path.join(configDir, 'openclaw.json');
  const policyPath = path.join(projectRoot, 'armoriq.policy.json');

  // 1. Create a default openclaw.json (a place to put the ArmorIQ API key) if missing
  try {
    if (!fs.existsSync(openclawConfigPath)) {
      fs.mkdirSync(configDir, { recursive: true });
      const defaultOpenclaw = {
        plugins: {
          entries: {
            armorclaw: {
              config: {
                apiKey: '',
                agentId: 'antigravity-agent-001'
              }
            }
          }
        }
      };
      fs.writeFileSync(openclawConfigPath, JSON.stringify(defaultOpenclaw, null, 2), 'utf8');
      console.log('[Bootstrap] Wrote default openclaw.json');
    }
  } catch (err) {
    console.warn(`[Bootstrap] ⚠️  Could not create ${openclawConfigPath}: ${err.message}`);
  }

  // 2. Write the default policy file if missing (may fail in a read-only packaged app)
  try {
    if (!fs.existsSync(policyPath)) {
      const defaultPolicy = {
        agentId: 'antigravity-agent-001',
        allow: [],
        deny: ['upload_external']
      };
      fs.writeFileSync(policyPath, JSON.stringify(defaultPolicy, null, 2), 'utf8');
      console.log('[Bootstrap] Wrote default armoriq.policy.json');
    }
  } catch (err) {
    console.warn(`[Bootstrap] ⚠️  Could not write default policy file: ${err.message}`);
  }

  // 3. Validate (read-only) and report — warnings only
  const problems = [];
  try {
    const loadedConfig = JSON.parse(fs.readFileSync(openclawConfigPath, 'utf8'));
    if (!loadedConfig.plugins?.entries?.armorclaw?.config) {
      problems.push('openclaw.json has no armorclaw plugin section (ArmorIQ guard will stay disabled unless ARMORIQ_API_KEY is set)');
    }
  } catch (err) {
    problems.push(`openclaw.json unreadable: ${err.message}`);
  }
  try {
    const loadedPolicy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    if (!loadedPolicy.agentId) problems.push('agentId missing from policy file');
    if (!Array.isArray(loadedPolicy.allow)) problems.push('policy "allow" must be an array');
    if (!Array.isArray(loadedPolicy.deny)) problems.push('policy "deny" must be an array');
  } catch (err) {
    problems.push(`policy file unreadable: ${err.message}`);
  }

  if (problems.length === 0) {
    console.log('[Bootstrap] ✅ Configuration and policy file verified.');
  } else {
    problems.forEach(p => console.warn(`[Bootstrap] ⚠️  ${p}`));
  }
}

module.exports = { runBootstrap };
