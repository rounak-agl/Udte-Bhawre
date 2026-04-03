const { shell, clipboard, Notification, dialog } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

/**
 * Built-in tools that run in-process — no external MCP server needed.
 * Each tool has: name, description, parameters (Gemini schema), and an execute() function.
 */

const builtinTools = [
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Time & System
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'get_current_time',
    description: 'Returns the current date, time, day of week, and timezone. Use this when the user asks about the current time or date.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    requiresApproval: false,
    async execute() {
      const now = new Date();
      return {
        dateTime: now.toLocaleString(),
        iso: now.toISOString(),
        dayOfWeek: now.toLocaleDateString('en-US', { weekday: 'long' }),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestamp: now.getTime()
      };
    }
  },

  {
    name: 'get_system_info',
    description: 'Returns system information including OS, CPU, memory, and uptime. Use when the user asks about their computer specs or system status.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    requiresApproval: false,
    async execute() {
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      return {
        platform: os.platform(),
        osType: os.type(),
        osRelease: os.release(),
        arch: os.arch(),
        hostname: os.hostname(),
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        cpuCores: os.cpus().length,
        totalMemoryGB: (totalMem / (1024 ** 3)).toFixed(2),
        freeMemoryGB: (freeMem / (1024 ** 3)).toFixed(2),
        usedMemoryPercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
        uptimeHours: (os.uptime() / 3600).toFixed(1),
        homeDir: os.homedir(),
        username: os.userInfo().username
      };
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Browser & URLs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'open_url',
    description: 'Opens a URL in the user\'s default web browser. Use this when the user asks to open a website or navigate to a link.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: 'The URL to open (must start with http:// or https://)'
        }
      },
      required: ['url']
    },
    requiresApproval: false,
    async execute({ url }) {
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
      }
      await shell.openExternal(url);
      return { success: true, url, message: `Opened ${url} in default browser` };
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Clipboard
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'get_clipboard',
    description: 'Reads the current text content from the system clipboard. Use when the user asks what\'s on their clipboard or wants to work with copied text.',
    parameters: {
      type: 'OBJECT',
      properties: {},
      required: []
    },
    requiresApproval: false,
    async execute() {
      const text = clipboard.readText();
      return {
        content: text || '(clipboard is empty)',
        length: text.length,
        hasContent: text.length > 0
      };
    }
  },

  {
    name: 'set_clipboard',
    description: 'Writes text to the system clipboard. Use when the user asks to copy something to clipboard or save something for pasting.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: {
          type: 'STRING',
          description: 'The text to write to the clipboard'
        }
      },
      required: ['text']
    },
    requiresApproval: false,
    async execute({ text }) {
      clipboard.writeText(text);
      return { success: true, message: `Copied ${text.length} characters to clipboard` };
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Email (via mailto: — zero config)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'compose_email',
    description: 'Opens Gmail in the browser with a pre-filled drafted email. Use when the user asks to send, compose, or draft an email. The Gmail tab will open with fields filled in — the user can review and click Send. This does NOT send the email automatically.',
    parameters: {
      type: 'OBJECT',
      properties: {
        to: {
          type: 'STRING',
          description: 'Recipient email address (e.g. "user@example.com")'
        },
        subject: {
          type: 'STRING',
          description: 'Email subject line'
        },
        body: {
          type: 'STRING',
          description: 'Email body text'
        },
        cc: {
          type: 'STRING',
          description: 'CC email address (optional)'
        },
        bcc: {
          type: 'STRING',
          description: 'BCC email address (optional)'
        }
      },
      required: ['to', 'subject', 'body']
    },
    requiresApproval: false,
    async execute({ to, subject, body, cc, bcc }) {
      let gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      if (cc) gmailUrl += `&cc=${encodeURIComponent(cc)}`;
      if (bcc) gmailUrl += `&bcc=${encodeURIComponent(bcc)}`;

      await shell.openExternal(gmailUrl);
      return {
        success: true,
        message: `Opened Gmail draft to ${to}`,
        to,
        subject
      };
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Calendar (via .ics file — zero config)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'create_calendar_event',
    description: 'Opens Google Calendar in the browser with a pre-filled event form. Use when the user asks to schedule a meeting, create a reminder, or add an event to their calendar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Event title/name'
        },
        date: {
          type: 'STRING',
          description: 'Event date in YYYY-MM-DD format (e.g. "2026-04-05")'
        },
        startTime: {
          type: 'STRING',
          description: 'Start time in HH:MM 24-hour format (e.g. "14:30" for 2:30 PM)'
        },
        durationMinutes: {
          type: 'NUMBER',
          description: 'Duration in minutes (default: 60)'
        },
        description: {
          type: 'STRING',
          description: 'Event description or notes (optional)'
        },
        location: {
          type: 'STRING',
          description: 'Event location (optional)'
        }
      },
      required: ['title', 'date', 'startTime']
    },
    requiresApproval: false,
    async execute({ title, date, startTime, durationMinutes = 60, description = '', location = '' }) {
      try {
        // Parse date and time
        const [year, month, day] = date.split('-').map(Number);
        const [hour, minute] = startTime.split(':').map(Number);

        // Create Date objects (this uses local timezone)
        const start = new Date(year, month - 1, day, hour, minute);
        const end = new Date(start.getTime() + durationMinutes * 60000);

        // Format to YYYYMMDDTHHMMSSZ (UTC representation for Google Calendar URL)
        const formatGoogleDate = (d) => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

        const googleStart = formatGoogleDate(start);
        const googleEnd = formatGoogleDate(end);

        const calendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${googleStart}/${googleEnd}&details=${encodeURIComponent(description)}&location=${encodeURIComponent(location)}`;

        await shell.openExternal(calendarUrl);
        
        return {
          success: true,
          message: `Opened Google Calendar with event "${title}" on ${date} at ${startTime}`,
          title,
          date,
          startTime
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Notifications
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'show_notification',
    description: 'Shows a native OS notification on the user\'s desktop. Use when the user asks for a reminder or wants to be notified about something.',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Notification title'
        },
        body: {
          type: 'STRING',
          description: 'Notification body text'
        }
      },
      required: ['title', 'body']
    },
    requiresApproval: false,
    async execute({ title, body }) {
      const notif = new Notification({ title, body });
      notif.show();
      return { success: true, message: `Notification shown: "${title}"` };
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  File System
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'list_files',
    description: 'Lists files and directories at a given path. Use when the user asks to see files in a directory or explore their file system.',
    parameters: {
      type: 'OBJECT',
      properties: {
        directoryPath: {
          type: 'STRING',
          description: 'Absolute path to the directory to list (e.g. "C:\\\\Users\\\\User\\\\Documents")'
        }
      },
      required: ['directoryPath']
    },
    requiresApproval: false,
    async execute({ directoryPath }) {
      try {
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
        const files = entries.map(e => ({
          name: e.name,
          type: e.isDirectory() ? 'directory' : 'file',
          size: e.isFile() ? fs.statSync(path.join(directoryPath, e.name)).size : undefined
        }));
        return {
          success: true,
          path: directoryPath,
          count: files.length,
          entries: files.slice(0, 50) // Limit to 50 entries
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  },

  {
    name: 'read_file',
    description: 'Reads the text content of a file. Use when the user asks to read, view, or open a file\'s contents.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: {
          type: 'STRING',
          description: 'Absolute path to the file to read'
        }
      },
      required: ['filePath']
    },
    requiresApproval: false,
    async execute({ filePath }) {
      try {
        const stat = fs.statSync(filePath);
        if (stat.size > 100 * 1024) {
          return { success: false, error: 'File too large (>100KB). Cannot read.' };
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return {
          success: true,
          path: filePath,
          sizeBytes: stat.size,
          content: content
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  },

  {
    name: 'write_file',
    description: 'Writes text content to a file. Use when the user asks to create, save, or write a file. IMPORTANT: This will show a confirmation dialog to the user before writing.',
    parameters: {
      type: 'OBJECT',
      properties: {
        filePath: {
          type: 'STRING',
          description: 'Absolute path where the file should be written'
        },
        content: {
          type: 'STRING',
          description: 'The text content to write to the file'
        }
      },
      required: ['filePath', 'content']
    },
    requiresApproval: true,
    async execute({ filePath, content }, approvalFn) {
      if (approvalFn) {
        const approved = await approvalFn(`Write file: ${filePath}\n(${content.length} characters)`);
        if (!approved) {
          return { success: false, error: 'User declined the file write.' };
        }
      }
      try {
        const dir = path.dirname(filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(filePath, content, 'utf8');
        return {
          success: true,
          path: filePath,
          bytesWritten: Buffer.byteLength(content, 'utf8'),
          message: `File written: ${filePath}`
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    }
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  //  Shell Commands (requires approval)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  {
    name: 'run_shell_command',
    description: 'Executes a shell command on the user\'s system. IMPORTANT: This will show a confirmation dialog to the user before running. Use for tasks like checking installed programs, running scripts, or system operations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'The shell command to execute (e.g. "dir", "whoami", "ipconfig")'
        }
      },
      required: ['command']
    },
    requiresApproval: true,
    async execute({ command }, approvalFn) {
      if (approvalFn) {
        const approved = await approvalFn(`Run command:\n${command}`);
        if (!approved) {
          return { success: false, error: 'User declined the command.' };
        }
      }
      return new Promise((resolve) => {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['-Command', command] : ['-c', command];

        const { spawn } = require('child_process');
        const proc = spawn(shell, shellArgs, { timeout: 15000 });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });

        proc.on('close', (code) => {
          resolve({
            success: code === 0,
            exitCode: code,
            stdout: stdout.substring(0, 2000), // Limit output
            stderr: stderr.substring(0, 500),
            command
          });
        });

        proc.on('error', (err) => {
          resolve({ success: false, error: err.message, command });
        });
      });
    }
  }
];

/**
 * Get all tool declarations in Gemini-compatible format.
 */
function getToolDeclarations() {
  return builtinTools.map(t => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters
  }));
}

/**
 * Execute a tool by name.
 * @param {string} name - Tool name
 * @param {object} args - Tool arguments
 * @param {function} approvalFn - Async function for user approval dialogs
 * @returns {Promise<object>} Tool result
 */
async function executeTool(name, args, approvalFn) {
  const tool = builtinTools.find(t => t.name === name);
  if (!tool) {
    return { success: false, error: `Unknown tool: ${name}` };
  }

  try {
    if (tool.requiresApproval) {
      return await tool.execute(args, approvalFn);
    }
    return await tool.execute(args);
  } catch (err) {
    return { success: false, error: `Tool execution failed: ${err.message}` };
  }
}

/**
 * Check if a tool name is a built-in tool.
 */
function isBuiltinTool(name) {
  return builtinTools.some(t => t.name === name);
}

module.exports = {
  builtinTools,
  getToolDeclarations,
  executeTool,
  isBuiltinTool
};
