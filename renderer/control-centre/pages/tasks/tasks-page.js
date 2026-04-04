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

  const board = pfCreateElement('div', 'pf-kanban-board');
  container.appendChild(board);

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
      { id: 'done', title: 'Done' }
    ];

    columnsData.forEach(col => {
      const colTasks = tasksList.filter(t => t.status === col.id);
      
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

          card.onclick = () => showCreateTaskModal(task);
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
