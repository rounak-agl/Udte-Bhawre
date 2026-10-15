// renderer/control-centre/pages/tasks/tasks-page.js

function TasksPage() {
  const container = pfCreateElement('div', 'pf-page-tasks');
  let tasksList = [];
  
  // Header
  const header = pfCreateElement('div', 'pf-tasks-header');
  header.appendChild(pfCreateElement('h1', 'pf-tasks-title', { textContent: 'Tasks' }));
  
  const addBtn = window.PFButton({ label: 'Add Task', icon: window.PFIcons.plus, variant: 'secondary' });
  addBtn.onclick = () => showCreateTaskModal();
  header.appendChild(addBtn);
  container.appendChild(header);

  // Tasks done by an orchestrator's sub-agents vs. the ones you added
  let filter = 'all';
  const filters = pfCreateElement('div', 'pf-task-filters', { role: 'tablist', 'aria-label': 'Show' });
  [['all', 'All tasks'], ['subagent', 'Sub-agent tasks'], ['manual', 'My tasks']].forEach(([id, label]) => {
    const chip = pfCreateElement('button', `pf-task-filter${id === filter ? ' active' : ''}`, { type: 'button', role: 'tab', textContent: label });
    chip.setAttribute('aria-selected', String(id === filter));
    chip.onclick = () => {
      filter = id;
      filters.querySelectorAll('.pf-task-filter').forEach(c => {
        c.classList.toggle('active', c === chip);
        c.setAttribute('aria-selected', String(c === chip));
      });
      renderBoard();
    };
    filters.appendChild(chip);
  });
  container.appendChild(filters);

  const board = pfCreateElement('div', 'pf-kanban-board');
  container.appendChild(board);

  // Sub-agent progress updates arrive from the main process; one listener for the app,
  // pointed at whichever Tasks page is showing
  let reloadTimer = null;
  window.__pfTasksReload = () => {
    if (!container.isConnected) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadTasks, 400);
  };
  if (!window.__pfTasksHooked && window.ccBridge?.onTasksUpdated) {
    window.__pfTasksHooked = true;
    window.ccBridge.onTasksUpdated(() => window.__pfTasksReload && window.__pfTasksReload());
  }

  const isSubagentTask = (t) => !!t.orchestratorRunId;
  function formatDuration(task) {
    if (!task.startedAt) return '';
    const ms = new Date(task.finishedAt || Date.now()) - new Date(task.startedAt);
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  }

  async function loadTasks() {
    if (window.ccBridge) {
      try {
        tasksList = await window.ccBridge.getTasks();
        renderBoard();
      } catch (e) {
        tasksList = [];
        renderBoard();
      }
    }
  }

  function renderBoard() {
    board.innerHTML = '';
    const columnsData = [
      { id: 'todo', title: 'To Do' },
      { id: 'in-progress', title: 'In Progress' },
      { id: 'done', title: 'Done' },
      { id: 'failed', title: 'Failed' }
    ];
    const visible = tasksList.filter(t => filter === 'all' || (filter === 'subagent') === isSubagentTask(t));

    columnsData.forEach(col => {
      const colTasks = visible.filter(t => t.status === col.id);
      // The Failed column only appears when something failed
      if (col.id === 'failed' && !colTasks.length) return;
      
      const colEl = pfCreateElement('div', 'pf-kanban-column');
      colEl.dataset.status = col.id;
      
      const colHd = pfCreateElement('div', 'pf-kanban-col-header');
      colHd.appendChild(pfCreateElement('div', 'pf-kanban-col-title', { textContent: col.title }));
      colHd.appendChild(pfCreateElement('div', 'pf-kanban-col-count', { textContent: colTasks.length.toString() }));
      colEl.appendChild(colHd);
      
      const itemsEl = pfCreateElement('div', 'pf-kanban-items');
      
      if (colTasks.length === 0) {
        itemsEl.appendChild(pfCreateElement('div', 'pf-kanban-empty', { textContent: 'No tasks' }));
      } else {
        colTasks.forEach(task => {
          const card = pfCreateElement('div', 'pf-task-card');
          card.classList.add(`priority-${task.priority || 'medium'}`);
          
          card.appendChild(pfCreateElement('div', 'pf-task-title', { textContent: task.title }));
          if (task.description) {
            card.appendChild(pfCreateElement('div', 'pf-task-desc', { textContent: task.description }));
          }
          if (isSubagentTask(task)) {
            card.classList.add('pf-task-card--subagent');
            const meta = pfCreateElement('div', 'pf-task-subagent-meta');
            meta.appendChild(PFBadge({ label: `🧩 ${task.provider || 'sub-agent'}`, variant: 'secondary' }));
            const via = task.agentId?.name ? `via ${task.agentId.name}` : 'sub-agent';
            meta.appendChild(pfCreateElement('span', '', { textContent: [via, formatDuration(task)].filter(Boolean).join(' · ') }));
            card.appendChild(meta);
            if (task.error) card.appendChild(pfCreateElement('div', 'pf-task-error', { textContent: task.error }));
            if (task.result) {
              // Model output: text only
              const result = pfCreateElement('details', 'pf-task-result');
              result.appendChild(pfCreateElement('summary', '', { textContent: 'Result' }));
              result.appendChild(pfCreateElement('div', 'pf-task-result-text', { textContent: task.result }));
              result.addEventListener('click', (e) => e.stopPropagation());
              card.appendChild(result);
            }
          }

          const cardFooter = pfCreateElement('div', 'pf-task-footer');
          if (task.agentId) {
             cardFooter.appendChild(PFAvatar({ initials: task.agentId.name?.charAt(0) || '?', size: 'xs' }));
          }
          
          const actions = pfCreateElement('div', 'pf-task-actions');
          const delBtn = PFButton({ icon: '×', variant: 'ghost', size: 'sm' });
          delBtn.onclick = async (e) => {
            e.stopPropagation();
            if (window.ccBridge) {
              await window.ccBridge.deleteTask(task._id);
              loadTasks();
            }
          };
          actions.appendChild(delBtn);
          cardFooter.appendChild(actions);
          card.appendChild(cardFooter);

          // Sub-agent tasks are a record of what ran; your own tasks open for editing
          if (!isSubagentTask(task)) card.onclick = () => showCreateTaskModal(task);
          else card.style.cursor = 'default';
          itemsEl.appendChild(card);
        });
      }
      
      colEl.appendChild(itemsEl);
      board.appendChild(colEl);
    });
  }

  function showCreateTaskModal(existingTask = null) {
    const modal = pfCreateElement('div', 'pf-modal-overlay');
    const box = pfCreateElement('div', 'pf-modal-box');
    
    box.appendChild(pfCreateElement('h2', '', { textContent: existingTask ? 'Edit Task' : 'New Task' }));
    
    const titleIn = window.PFInput({ label: 'Title', value: existingTask?.title || '' });
    box.appendChild(titleIn);
    
    const descIn = pfCreateElement('div', 'pf-input-wrapper');
    descIn.appendChild(pfCreateElement('label', 'pf-input-label', { textContent: 'Description' }));
    const textarea = pfCreateElement('textarea', 'pf-input', { style: 'min-height:80px; width:100%; border-radius:12px; padding:12px;' });
    textarea.value = existingTask?.description || '';
    descIn.appendChild(textarea);
    box.appendChild(descIn);

    const statusIn = window.pfCreateElement('div', 'pf-form-group');
    statusIn.appendChild(window.pfCreateElement('label', 'pf-input-label', { textContent: 'Status' }));
    const statusSelect = pfCreateElement('select', 'pf-input', { style: 'width:100%; border-radius:12px; height:44px; padding:0 12px;' });
    ['todo', 'in-progress', 'done'].forEach(s => {
      const opt = pfCreateElement('option', '', { value: s, textContent: PFUtils.capitalize(s) });
      if (existingTask?.status === s) opt.selected = true;
      statusSelect.appendChild(opt);
    });
    statusIn.appendChild(statusSelect);
    box.appendChild(statusIn);

    const prioIn = window.pfCreateElement('div', 'pf-form-group');
    prioIn.appendChild(window.pfCreateElement('label', 'pf-input-label', { textContent: 'Priority' }));
    const prioSelect = pfCreateElement('select', 'pf-input', { style: 'width:100%; border-radius:12px; height:44px; padding:0 12px;' });
    ['low', 'medium', 'high'].forEach(p => {
      const opt = pfCreateElement('option', '', { value: p, textContent: PFUtils.capitalize(p) });
      if (existingTask?.priority === p) opt.selected = true;
      prioSelect.appendChild(opt);
    });
    prioIn.appendChild(prioSelect);
    box.appendChild(prioIn);

    const footer = pfCreateElement('div', 'pf-modal-footer', { style: 'display:flex; justify-content:flex-end; gap:12px; margin-top:24px;' });
    const cancelBtn = PFButton({ label: 'Cancel', variant: 'ghost' });
    cancelBtn.onclick = () => modal.remove();
    
    const saveBtn = PFButton({ label: existingTask ? 'Update' : 'Save', variant: 'primary' });
    saveBtn.onclick = async () => {
      const taskData = {
        title: titleIn.querySelector('input').value,
        description: textarea.value,
        status: statusSelect.value,
        priority: prioSelect.value
      };
      if (existingTask) taskData._id = existingTask._id;
      
      if (window.ccBridge) {
        await window.ccBridge.saveTask(taskData);
        modal.remove();
        loadTasks();
      }
    };

    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    box.appendChild(footer);
    modal.appendChild(box);
    document.body.appendChild(modal);
  }

  loadTasks();
  return container;
}

window.TasksPage = TasksPage;
