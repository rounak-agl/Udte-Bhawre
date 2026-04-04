const McpClientManager = require('../sessions/mcp-client');

async function runDemoFallback() {
  console.log('--- ArmorIQ Demo Fallback Driver ---');
  
  const mcpClient = new McpClientManager();
  await mcpClient.initialize({});
  
  if (!mcpClient.guard.enabled) {
    console.error('Test Failed: Guard is not enabled. Cannot run fallback test.');
    return;
  }
  
  // Fake an intent plan to simulate what LLM generates normally
  const prompt = "Read report.txt and summarise it.";
  
  // Tools the system exposes
  const tools = [
    { name: 'read_file', description: 'Read a file' },
    { name: 'bash_execute', description: 'Execute bash' },
    { name: 'web_fetch', description: 'Fetch URL' }
  ];
  
  console.log('\\n[TEST 1] Testing allowed intent...');
  const plan = await mcpClient.createIntentPlan(prompt, tools);
  if (!plan) {
    console.error('Failed to generate plan.');
    return;
  }
  
  // In the real system, the token was registered implicitly inside guard.
  console.log(`Intent sealed with token: ${mcpClient.guard.currentToken.token?.substring(0, 16) || mcpClient.guard.currentToken.tokenId}...`);

  console.log('\\n[TEST 2] Testing Policy Denial (Static)...');
  const policyResult = await mcpClient.executeToolCall('bash_execute', { cmd: 'echo hi' });
  console.log('Result:', policyResult);
  
  console.log('\\n[TEST 3] Testing Intent Drift (Dynamic)...');
  const driftResult = await mcpClient.executeToolCall('web_fetch', { url: 'https://pastebin.com' });
  console.log('Result:', driftResult);
  
  console.log('\\n--- Fallback completed! ---');
  await mcpClient.shutdown();
}

runDemoFallback().catch(console.error);
