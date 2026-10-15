/**
 * Curated MCP server catalog — the "Featured" servers in Control Centre → Connectors →
 * Marketplace. Each package / URL here was checked against npm, PyPI or the live
 * endpoint (deprecated packages, e.g. the old @modelcontextprotocol/server-github, were
 * replaced by their maintained successors).
 *
 * Entry:
 *   { id, name, publisher, description, category, icon, homepage,
 *     install: { type: 'stdio', runtime: 'node'|'python', command, args[], env{} }
 *            | { type: 'http', url, headers{} },
 *     fields: [{ key, label, placeholder?, secret?, required?, helpUrl?, default?, path? }] }
 *
 * `{key}` placeholders in args / env values / header values are filled from `fields`
 * by buildConfig(). An args element may be a group (array) that is dropped as a whole
 * when one of its placeholders is empty — e.g. ['--repository', '{repo}'].
 * Secrets always go in env or headers (encrypted at rest), never in args.
 */

const os = require('os');

const CATEGORIES = ['Developer', 'Data', 'Productivity', 'Web & Search', 'Design', 'Files & System', 'Cloud & Payments'];

const npx = (pkg, ...rest) => ({ type: 'stdio', runtime: 'node', command: 'npx', args: ['-y', pkg, ...rest] });
const uvx = (pkg, ...rest) => ({ type: 'stdio', runtime: 'python', command: 'uvx', args: [pkg, ...rest] });
const token = (label, extra = {}) => ({ key: 'token', label, secret: true, required: true, ...extra });

const CATALOG = [
  // ── Developer ──
  {
    id: 'github', name: 'GitHub', publisher: 'GitHub', category: 'Developer', icon: '🐙',
    description: 'Repositories, issues, pull requests and code search (GitHub\'s hosted server).',
    homepage: 'https://github.com/github/github-mcp-server',
    install: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer {token}' } },
    fields: [token('Personal access token', { placeholder: 'github_pat_…', helpUrl: 'https://github.com/settings/personal-access-tokens/new' })]
  },
  {
    id: 'gitlab', name: 'GitLab', publisher: 'zereight (community)', category: 'Developer', icon: '🦊',
    description: 'Projects, merge requests, issues and pipelines on GitLab.com or your own instance.',
    homepage: 'https://github.com/zereight/gitlab-mcp',
    install: { ...npx('@zereight/mcp-gitlab'), env: { GITLAB_PERSONAL_ACCESS_TOKEN: '{token}', GITLAB_API_URL: '{apiUrl}' } },
    fields: [
      token('Personal access token', { placeholder: 'glpat-…', helpUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens' }),
      { key: 'apiUrl', label: 'API URL', default: 'https://gitlab.com/api/v4', required: true }
    ]
  },
  {
    id: 'git', name: 'Git', publisher: 'MCP reference servers', category: 'Developer', icon: '🌿',
    description: 'Read, search and change local Git repositories: status, diff, log, commit, branches.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/git',
    install: uvx('mcp-server-git', ['--repository', '{repo}']),
    fields: [{ key: 'repo', label: 'Repository folder (optional)', placeholder: '/path/to/repo', path: true }]
  },
  {
    id: 'sentry', name: 'Sentry', publisher: 'Sentry', category: 'Developer', icon: '🛰️',
    description: 'Look up errors, issues and releases in Sentry, with Seer root-cause analysis.',
    homepage: 'https://github.com/getsentry/sentry-mcp',
    install: { ...npx('@sentry/mcp-server'), env: { SENTRY_ACCESS_TOKEN: '{token}', SENTRY_HOST: '{host}' } },
    fields: [
      token('User auth token', { placeholder: 'sntryu_…', helpUrl: 'https://sentry.io/settings/account/api/auth-tokens/' }),
      { key: 'host', label: 'Self-hosted host (optional)', placeholder: 'sentry.example.com' }
    ]
  },
  {
    id: 'context7', name: 'Context7', publisher: 'Upstash', category: 'Developer', icon: '📚',
    description: 'Up-to-date library documentation and code examples for thousands of packages.',
    homepage: 'https://context7.com',
    install: { type: 'http', url: 'https://mcp.context7.com/mcp', headers: { CONTEXT7_API_KEY: '{apiKey}' } },
    fields: [{ key: 'apiKey', label: 'API key (optional, for higher limits)', secret: true, helpUrl: 'https://context7.com/dashboard' }]
  },
  {
    id: 'deepwiki', name: 'DeepWiki', publisher: 'Cognition', category: 'Developer', icon: '📖',
    description: 'Ask questions about any public GitHub repository using its generated wiki.',
    homepage: 'https://docs.devin.ai/work-with-devin/deepwiki-mcp',
    install: { type: 'http', url: 'https://mcp.deepwiki.com/mcp', headers: {} },
    fields: []
  },
  {
    id: 'playwright', name: 'Playwright', publisher: 'Microsoft', category: 'Developer', icon: '🎭',
    description: 'Drive a real browser: open pages, click, type, take snapshots and screenshots.',
    homepage: 'https://github.com/microsoft/playwright-mcp',
    install: npx('@playwright/mcp@latest'),
    fields: []
  },

  // ── Data ──
  {
    id: 'postgres', name: 'PostgreSQL', publisher: 'HenkDz (community)', category: 'Data', icon: '🐘',
    description: 'Inspect schemas, run queries and analyse performance of a PostgreSQL database.',
    homepage: 'https://github.com/HenkDz/postgresql-mcp-server',
    install: { ...npx('@henkey/postgres-mcp-server'), env: { POSTGRES_CONNECTION_STRING: '{url}' } },
    fields: [{ key: 'url', label: 'Connection string', placeholder: 'postgresql://user:pass@localhost:5432/db', secret: true, required: true }]
  },
  {
    id: 'mongodb', name: 'MongoDB', publisher: 'MongoDB', category: 'Data', icon: '🍃',
    description: 'Query collections and inspect schemas in MongoDB (installed read-only).',
    homepage: 'https://github.com/mongodb-js/mongodb-mcp-server',
    install: { ...npx('mongodb-mcp-server', '--readOnly'), env: { MDB_MCP_CONNECTION_STRING: '{url}' } },
    fields: [{ key: 'url', label: 'Connection string', placeholder: 'mongodb://localhost:27017/mydb', secret: true, required: true }]
  },
  {
    id: 'airtable', name: 'Airtable', publisher: 'domdomegg (community)', category: 'Data', icon: '🗂️',
    description: 'Read and write records, tables and bases in Airtable.',
    homepage: 'https://github.com/domdomegg/airtable-mcp-server',
    install: { ...npx('airtable-mcp-server'), env: { AIRTABLE_API_KEY: '{token}' } },
    fields: [token('Personal access token', { placeholder: 'pat…', helpUrl: 'https://airtable.com/create/tokens/new' })]
  },

  // ── Productivity ──
  {
    id: 'notion', name: 'Notion', publisher: 'Notion', category: 'Productivity', icon: '📝',
    description: 'Search, read and edit pages and databases in your Notion workspace.',
    homepage: 'https://github.com/makenotion/notion-mcp-server',
    install: { ...npx('@notionhq/notion-mcp-server'), env: { NOTION_TOKEN: '{token}' } },
    fields: [token('Integration secret', { placeholder: 'ntn_…', helpUrl: 'https://www.notion.so/profile/integrations' })]
  },
  {
    id: 'slack', name: 'Slack', publisher: 'Zencoder', category: 'Productivity', icon: '💬',
    description: 'Read channels and threads, post messages and add reactions in Slack.',
    homepage: 'https://github.com/zencoderai/slack-mcp-server',
    install: { ...npx('@zencoderai/slack-mcp-server'), env: { SLACK_BOT_TOKEN: '{token}', SLACK_TEAM_ID: '{teamId}' } },
    fields: [
      token('Bot token', { placeholder: 'xoxb-…', helpUrl: 'https://api.slack.com/apps' }),
      { key: 'teamId', label: 'Workspace (team) ID', placeholder: 'T01234567', required: true }
    ]
  },
  {
    id: 'todoist', name: 'Todoist', publisher: 'community', category: 'Productivity', icon: '✅',
    description: 'Create, update and complete Todoist tasks and projects.',
    homepage: 'https://www.npmjs.com/package/todoist-mcp',
    install: { ...npx('todoist-mcp'), env: { API_KEY: '{token}' } },
    fields: [token('API token', { helpUrl: 'https://app.todoist.com/app/settings/integrations/developer' })]
  },
  {
    id: 'hubspot', name: 'HubSpot', publisher: 'HubSpot', category: 'Productivity', icon: '🧲',
    description: 'Contacts, companies, deals and other CRM objects in HubSpot.',
    homepage: 'https://www.npmjs.com/package/@hubspot/mcp-server',
    install: { ...npx('@hubspot/mcp-server'), env: { PRIVATE_APP_ACCESS_TOKEN: '{token}' } },
    fields: [token('Private app access token', { placeholder: 'pat-…', helpUrl: 'https://developers.hubspot.com/docs/api/private-apps' })]
  },

  // ── Web & Search ──
  {
    id: 'fetch', name: 'Fetch', publisher: 'MCP reference servers', category: 'Web & Search', icon: '🌐',
    description: 'Fetch any web page and convert it to Markdown for the assistant to read.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    install: uvx('mcp-server-fetch'),
    fields: []
  },
  {
    id: 'brave-search', name: 'Brave Search', publisher: 'Brave', category: 'Web & Search', icon: '🦁',
    description: 'Web, news, image and local search with the Brave Search API.',
    homepage: 'https://github.com/brave/brave-search-mcp-server',
    install: { ...npx('@brave/brave-search-mcp-server'), env: { BRAVE_API_KEY: '{token}' } },
    fields: [token('API key', { helpUrl: 'https://brave.com/search/api/' })]
  },
  {
    id: 'exa', name: 'Exa', publisher: 'Exa', category: 'Web & Search', icon: '🔎',
    description: 'AI-native web search and code search (Exa\'s hosted server).',
    homepage: 'https://github.com/exa-labs/exa-mcp-server',
    install: { type: 'http', url: 'https://mcp.exa.ai/mcp', headers: {} },
    fields: []
  },
  {
    id: 'tavily', name: 'Tavily', publisher: 'Tavily', category: 'Web & Search', icon: '🧭',
    description: 'Real-time web search, extraction and crawling built for AI agents.',
    homepage: 'https://github.com/tavily-ai/tavily-mcp',
    install: { ...npx('tavily-mcp'), env: { TAVILY_API_KEY: '{token}' } },
    fields: [token('API key', { placeholder: 'tvly-…', helpUrl: 'https://app.tavily.com' })]
  },
  {
    id: 'firecrawl', name: 'Firecrawl', publisher: 'Firecrawl', category: 'Web & Search', icon: '🔥',
    description: 'Scrape, crawl and extract structured data from websites.',
    homepage: 'https://github.com/firecrawl/firecrawl-mcp-server',
    install: { ...npx('firecrawl-mcp'), env: { FIRECRAWL_API_KEY: '{token}' } },
    fields: [token('API key', { placeholder: 'fc-…', helpUrl: 'https://www.firecrawl.dev/app/api-keys' })]
  },
  {
    id: 'apify', name: 'Apify', publisher: 'Apify', category: 'Web & Search', icon: '🕷️',
    description: 'Thousands of ready-made scrapers for social media, maps, e-commerce and more.',
    homepage: 'https://mcp.apify.com',
    install: { type: 'http', url: 'https://mcp.apify.com', headers: { Authorization: 'Bearer {token}' } },
    fields: [token('API token', { placeholder: 'apify_api_…', helpUrl: 'https://console.apify.com/settings/integrations' })]
  },
  {
    id: 'huggingface', name: 'Hugging Face', publisher: 'Hugging Face', category: 'Web & Search', icon: '🤗',
    description: 'Search models, datasets, Spaces and papers on the Hugging Face Hub.',
    homepage: 'https://huggingface.co/settings/mcp',
    install: { type: 'http', url: 'https://huggingface.co/mcp', headers: { Authorization: 'Bearer {token}' } },
    fields: [{ key: 'token', label: 'Access token (optional)', placeholder: 'hf_…', secret: true, helpUrl: 'https://huggingface.co/settings/tokens' }]
  },

  // ── Design ──
  {
    id: 'figma', name: 'Figma', publisher: 'GLips (Framelink)', category: 'Design', icon: '◆',
    description: 'Read Figma files and frames so the assistant can turn designs into code.',
    homepage: 'https://github.com/GLips/Figma-Context-MCP',
    install: { ...npx('figma-developer-mcp', '--stdio'), env: { FIGMA_API_KEY: '{token}' } },
    fields: [token('Personal access token', { placeholder: 'figd_…', helpUrl: 'https://help.figma.com/hc/en-us/articles/8085703771159' })]
  },
  {
    id: 'photoshop', name: 'Photoshop', publisher: 'alisaitteke (community)', category: 'Design', icon: '🎨',
    description: 'Control Adobe Photoshop: layers, documents, filters and exports.',
    homepage: 'https://www.npmjs.com/package/@alisaitteke/photoshop-mcp',
    install: npx('@alisaitteke/photoshop-mcp'),
    fields: []
  },

  // ── Files & System ──
  {
    id: 'filesystem', name: 'Filesystem', publisher: 'MCP reference servers', category: 'Files & System', icon: '📁',
    description: 'Read, write, move and search files — limited to the folder you choose.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    install: npx('@modelcontextprotocol/server-filesystem', '{folder}'),
    fields: [{ key: 'folder', label: 'Allowed folder', default: '{home}', required: true, path: true }]
  },
  {
    id: 'memory', name: 'Memory', publisher: 'MCP reference servers', category: 'Files & System', icon: '🧠',
    description: 'A local knowledge graph the assistant can use to remember facts between chats.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    install: npx('@modelcontextprotocol/server-memory'),
    fields: []
  },
  {
    id: 'sequential-thinking', name: 'Sequential Thinking', publisher: 'MCP reference servers', category: 'Files & System', icon: '🪜',
    description: 'Helps the assistant break hard problems into steps and revise its thinking.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    install: npx('@modelcontextprotocol/server-sequential-thinking'),
    fields: []
  },
  {
    id: 'time', name: 'Time', publisher: 'MCP reference servers', category: 'Files & System', icon: '⏰',
    description: 'Current time and time-zone conversions.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/time',
    install: uvx('mcp-server-time'),
    fields: []
  },

  // ── Cloud & Payments ──
  {
    id: 'stripe', name: 'Stripe', publisher: 'Stripe', category: 'Cloud & Payments', icon: '💳',
    description: 'Customers, payments, invoices and products in your Stripe account.',
    homepage: 'https://github.com/stripe/agent-toolkit',
    install: { ...npx('@stripe/mcp'), env: { STRIPE_SECRET_KEY: '{token}' } },
    fields: [token('Secret or restricted key', { placeholder: 'rk_test_…', helpUrl: 'https://dashboard.stripe.com/apikeys' })]
  },
  {
    id: 'cloudflare-docs', name: 'Cloudflare Docs', publisher: 'Cloudflare', category: 'Cloud & Payments', icon: '☁️',
    description: 'Search Cloudflare\'s developer documentation (Workers, Pages, R2, …).',
    homepage: 'https://github.com/cloudflare/mcp-server-cloudflare',
    install: { type: 'http', url: 'https://docs.mcp.cloudflare.com/mcp', headers: {} },
    fields: []
  },
  {
    id: 'aws-docs', name: 'AWS Documentation', publisher: 'AWS Labs', category: 'Cloud & Payments', icon: '🟧',
    description: 'Search and read AWS documentation and get service recommendations.',
    homepage: 'https://github.com/awslabs/mcp',
    install: uvx('awslabs.aws-documentation-mcp-server@latest'),
    fields: []
  }
];

const RUNTIMES = {
  node: { binary: 'npx', label: 'Node.js', installUrl: 'https://nodejs.org' },
  python: { binary: 'uvx', label: 'uv (Python)', installUrl: 'https://docs.astral.sh/uv/getting-started/installation/' }
};

function getCatalogEntry(id) {
  return CATALOG.find(e => e.id === id) || null;
}

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/**
 * Fill a template: returns null when a referenced field is empty (the caller then drops
 * the arg / env var / header) — e.g. an optional token leaves no "Bearer " header behind.
 */
function fill(template, values) {
  let empty = false;
  const out = template.replace(PLACEHOLDER, (_, key) => {
    const v = values[key];
    if (v === undefined || v === '') { empty = true; return ''; }
    return v;
  });
  return empty ? null : out;
}

/**
 * Turn a catalog (or mapped registry) entry plus the user's field values into a stored
 * MCP server config. Throws with a user-facing message if a required field is missing.
 * This is the only place catalog data becomes a command line.
 */
function buildConfig(entry, rawValues = {}) {
  const values = {};
  for (const f of entry.fields || []) {
    let v = typeof rawValues[f.key] === 'string' ? rawValues[f.key].trim() : '';
    if (!v && typeof f.default === 'string') v = f.default.replace('{home}', os.homedir());
    // Folder fields: expand ~ (servers get the path as-is, no shell does it for them)
    if (f.path && /^~(?=$|[\\/])/.test(v)) v = os.homedir() + v.slice(1);
    if (/[\r\n\0]/.test(v) || v.length > 4096) throw new Error(`${f.label} isn't a valid value`);
    if (!v && f.required) throw new Error(`${f.label} is required`);
    values[f.key] = v;
  }
  const install = entry.install;
  const mapTemplates = (obj) => {
    const out = {};
    for (const [k, t] of Object.entries(obj || {})) {
      const v = fill(t, values);
      if (v !== null) out[k] = v;
    }
    return out;
  };
  if (install.type === 'http') {
    return { type: 'http', url: install.url, headers: mapTemplates(install.headers) };
  }
  const args = [];
  for (const a of install.args || []) {
    const group = Array.isArray(a) ? a : [a];
    const filled = group.map(t => fill(t, values));
    if (filled.every(v => v !== null)) args.push(...filled);
  }
  return { command: install.command, args, env: mapTemplates(install.env) };
}

module.exports = { CATALOG, CATEGORIES, RUNTIMES, getCatalogEntry, buildConfig };
