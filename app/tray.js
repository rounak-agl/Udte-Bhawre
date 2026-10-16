const { app, Tray, Menu, nativeImage } = require('electron');
const state = require('./state');
const appEvents = require('./events');
const { assetFile } = require('./paths');
const { openControlCentre } = require('./control-centre');
const { setAgentProvider } = require('./agents');
const { defaultProviderKey, providerFor } = require('./provider-choice');
const { isSoundsEnabled, toggleSounds } = require('../utils/sounds');
const { setCurrentProvider, getCurrentTheme, setCurrentTheme } = require('../sessions/agent-session');
const { listProviders } = require('../sessions/providers');

/** The tray icon and its menu. The menu rebuilds itself whenever bots or settings change. */
let tray = null;

function setupTray() {
  const icon = nativeImage.createFromPath(assetFile('q.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('Desktop Assistant');
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  // Agents are restored from the DB before the tray exists; setupTray() builds the
  // menu once it does.
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

appEvents.on('agents-changed', rebuildTrayMenu);
appEvents.on('settings-changed', rebuildTrayMenu);

const providerMenuLabel = (p) => (p.kind === 'ollama' ? `${p.name} (local)` : p.name);

/** The tray menu. Each bot has its own submenu: visibility and its own provider. */
function trayMenuTemplate() {
  if (process.env.CREW_UI === '1') return require('./crew-ui').trayTemplate();
  const { characters } = state;
  const allProviders = listProviders();
  const defaultKey = defaultProviderKey();
  const currentThemeName = getCurrentTheme();
  const themes = ['Peach', 'Midnight', 'Cloud', 'Moss'];

  return [
    ...characters.map((char, index) => {
      const own = providerFor(char);
      return {
        label: `${char.name || `Agent ${index + 1}`} — ${allProviders.find(p => p.key === own)?.name || own}`,
        submenu: [
          {
            label: 'Show on desktop',
            type: 'checkbox',
            checked: char.manuallyVisible ?? true,
            click: () => {
              char.setManuallyVisible(!char.manuallyVisible);
              rebuildTrayMenu();
            }
          },
          { type: 'separator' },
          { label: 'Provider', enabled: false },
          ...allProviders.map(p => ({
            label: providerMenuLabel(p),
            type: 'radio',
            checked: p.key === own,
            click: () => {
              if (char.agentId) setAgentProvider(char.agentId, p.key);
            }
          }))
        ]
      };
    }),
    { type: 'separator' },
    {
      label: 'Sounds',
      type: 'checkbox',
      checked: isSoundsEnabled(),
      click: () => { toggleSounds(); rebuildTrayMenu(); }
    },
    {
      // Only pre-selects the provider for new agents; each bot keeps its own
      label: 'Default provider for new agents',
      submenu: allProviders.map(p => ({
        label: providerMenuLabel(p),
        type: 'radio',
        checked: p.key === defaultKey,
        click: () => {
          setCurrentProvider(p.key);
          rebuildTrayMenu();
        }
      }))
    },
    {
      label: 'Style',
      submenu: themes.map(t => ({
        label: t,
        type: 'radio',
        checked: t === currentThemeName,
        click: () => {
          setCurrentTheme(t);
          characters.forEach(c => c.sendToChat('theme-change', t));
          rebuildTrayMenu();
        }
      }))
    },
    { type: 'separator' },
    { label: 'Manage MCP Servers...', click: () => openControlCentre('connectors') },
    { label: 'Set ElevenLabs API Key...', click: () => openControlCentre('settings') },
    { label: 'Set MongoDB URI...', click: () => openControlCentre('settings') },
    { type: 'separator' },
    { label: 'Open Dashboard', click: () => openControlCentre('dashboard') },
    { label: 'Settings', click: () => openControlCentre('settings') },
    { label: 'Control Centre', click: () => openControlCentre('dashboard') },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        characters.forEach(c => c.destroy());
        app.quit();
      }
    }
  ];
}

module.exports = { setupTray, trayMenuTemplate };
