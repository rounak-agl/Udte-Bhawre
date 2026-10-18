/**
 * Runtime state shared by the main-process modules. `characters` is mutated in place
 * (push/splice), never reassigned, so every module sees the same list.
 */
module.exports = {
  /** Running bots (Character instances), one per launched agent */
  characters: [],
  /** Set on 'before-quit' so windows that normally hide on close really close */
  isQuitting: false,
  /** True when the 3D crew is the UI (the default) instead of the classic Control Centre */
  crewUI: false
};
