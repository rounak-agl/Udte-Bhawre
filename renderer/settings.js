// renderer/settings.js

let currentServers = {};

async function loadServers() {
  const container = document.getElementById('server-list');
  container.innerHTML = '<span style="color:#aaa;font-size:12px;">Loading...</span>';

  // Fetch the latest config via IPC bridge
  currentServers = await window.assistant.getMcpServers() || {};
  
  container.innerHTML = ''; // Clear loading text

  const serverNames = Object.keys(currentServers);
  if (serverNames.length === 0) {
    container.innerHTML = '<span style="color:#aaa;font-size:12px;">No external servers connected.</span>';
    return;
  }

  // Render a card for each server
  serverNames.forEach(name => {
    const config = currentServers[name];
    const argsString = (config.args || []).join(' ');

    const card = document.createElement('div');
    card.className = 'server-card';
    card.innerHTML = `
      <div class="server-info">
        <h4>${name}</h4>
        <code>${config.command} ${argsString}</code>
      </div>
      <button class="delete-btn" onclick="removeServer('${name}')">Remove</button>
    `;
    container.appendChild(card);
  });
}

// Handle Form Submission
document.getElementById('add-server-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const name = document.getElementById('input-name').value.trim();
  const command = document.getElementById('input-command').value.trim();
  const argsInput = document.getElementById('input-args').value;
  const envInput = document.getElementById('input-env').value.trim();
  
  // Convert comma-separated string into an array of strings
  const args = argsInput.split(',').map(arg => arg.trim()).filter(arg => arg.length > 0);

  // Parse environment variables JSON
  let env = {};
  if (envInput) {
    try {
      env = JSON.parse(envInput);
    } catch (e) {
      alert('Invalid JSON format for Environment Variables.');
      return;
    }
  }

  // Update the global object
  currentServers[name] = { command, args, env};

  // Send to main process to save to JSON file and reboot the AI session
  await window.assistant.setMcpServers(currentServers);

  // Clear form and reload list
  document.getElementById('input-name').value = '';
  document.getElementById('input-command').value = 'npx';
  document.getElementById('input-args').value = '';
  if (document.getElementById('input-env')) document.getElementById('input-env').value = '';
  loadServers();
});

// Expose remove function to the global window so the inline onclick works
window.removeServer = async (name) => {
  if (confirm(`Are you sure you want to remove the ${name} server?`)) {
    delete currentServers[name];
    await window.assistant.setMcpServers(currentServers);
    loadServers();
  }
};

// Initial load
loadServers();