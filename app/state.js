const ScreenCapture = require('../utils/screen-capture');

/**
 * Runtime state shared by the main-process modules. `characters` is mutated in place
 * (push/splice), never reassigned, so every module sees the same list.
 */
module.exports = {
  /** Running bots (Character instances), one per launched agent */
  characters: [],
  /** Screenshot service (used by Gemini Vision when screenshots are enabled) */
  screenCapture: new ScreenCapture({ maxBuffer: 3 }),
  /** Set on 'before-quit' so windows that normally hide on close really close */
  isQuitting: false
};
