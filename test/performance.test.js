// Idle cost: a bot that's standing still must not touch its window every walk tick.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { REPO, useTempHome } = require('./helpers');
const { createHarness } = require('./main-harness');

useTempHome();
const h = createHarness();

test('walk loop: no window moves or IPC for a bot standing still', async () => {
  await h.load();
  const win = await h.launch({ _id: 'perf1', name: 'Perf', theme: 'Midnight' });
  const char = require(path.join(REPO, 'app/state.js')).characters.find(c => c.agentId === 'perf1');
  const { walkZone } = require(path.join(REPO, 'utils/taskbar.js')).getTaskbarGeometry();
  let moves = 0;
  const setBounds = win.setBounds.bind(win);
  win.setBounds = (b) => { moves++; setBounds(b); };
  const poses = () => h.sentTo(win, 'position-update').length;

  // Standing still (paused for a long time): 30 ticks ≈ 1 s
  char.isWalking = false;
  char.isPaused = true;
  char.pauseEndTime = Date.now() + 60000;
  char.update(walkZone);
  const [movesAfterFirst, posesAfterFirst] = [moves, poses()];
  for (let i = 0; i < 30; i++) char.update(walkZone);
  assert.strictEqual(moves, movesAfterFirst, 'no setBounds while standing still');
  assert.strictEqual(poses(), posesAfterFirst, 'no position-update IPC while standing still');

  // Walking: moves every tick, but the pose (walking + direction) is sent once
  char.isPaused = false;
  char.isWalking = true;
  char.direction = 1;
  char.positionProgress = 0.2;
  char.walkTarget = 0.9;
  char.walkSpeed = 0.01;
  for (let i = 0; i < 10; i++) char.update(walkZone);
  assert.strictEqual(moves, movesAfterFirst + 10);
  assert.strictEqual(poses(), posesAfterFirst + 1);
});
