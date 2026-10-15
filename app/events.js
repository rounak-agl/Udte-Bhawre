const { EventEmitter } = require('events');

/**
 * App-wide change notifications, so modules don't have to call each other directly
 * (the tray menu listens and rebuilds itself):
 *   'agents-changed'   — a bot was launched/removed, or a bot's provider changed
 *   'settings-changed' — theme, default provider or the provider list changed
 */
module.exports = new EventEmitter();
