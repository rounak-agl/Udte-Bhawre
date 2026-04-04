const { ArmorIQGuard } = require('../sessions/armoriq-guard');
const fs = require('fs');
const path = require('path');
const os = require('os');

const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.openclaw/openclaw.json'))).plugins.entries.armorclaw.config;
const guard = new ArmorIQGuard(config);

async function run() {
  await guard.initialize();
  
  console.log('--- Intent Plan phase ---');
  const tools = [{name: 'read_file'}, {name: 'web_fetch'}, {name: 'bash_execute'}];
  await guard.hooks.onLlmInput({ prompt: 'Read report.txt and summarize', tools });
  
  console.log('Allowed Actions extracted:', Array.from(guard.allowedActions));
  
  console.log('\\n--- Tool Execution phase ---');
  try {
    const res = await guard.hooks.onToolExecution('list_files', {path: '/'});
    console.log('Result list_files:', res);
  } catch (err) {
    console.log('Caught Error list_files:', err.code, err.message);
  }

  try {
    const res = await guard.hooks.onToolExecution('read_file', {path: 'report.txt'});
    console.log('Result read_file:', res);
  } catch (err) {
    console.log('Caught Error read_file:', err.code, err.message);
  }
}
run();
