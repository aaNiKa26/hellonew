const $ = id => document.getElementById(id);
let tasks = [];
let activeFilter = 'all';

async function request(url, options = {}) {
  const res = await fetch(url, {headers: {'Content-Type': 'application/json'}, ...options});
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function taskElement(task) {
  const item = document.createElement('article');
  item.className = 'task';
  const body = document.createElement('div');
  body.className = 'task-body';
  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = task.title;
  const description = document.createElement('div');
  description.className = 'task-desc';
  description.textContent = task.description || 'No description added';
  const date = document.createElement('div');
  date.className = 'task-date';
  date.textContent = `Created ${new Date(task.created_at).toLocaleDateString()}`;
  body.append(title, description, date);

  const status = document.createElement('select');
  status.setAttribute('aria-label', `Status of ${task.title}`);
  for (const [value, label] of [['todo', 'To do'], ['in_progress', 'In progress'], ['done', 'Done']]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    status.appendChild(option);
  }
  status.value = task.status;
  status.addEventListener('change', async () => {
    status.disabled = true;
    try { await request(`/api/tasks/${task.id}`, {method: 'PATCH', body: JSON.stringify({status: status.value})}); await load(); }
    catch (err) { showError(err); status.value = task.status; status.disabled = false; }
  });
  const remove = document.createElement('button');
  remove.className = 'delete';
  remove.textContent = 'Delete';
  remove.setAttribute('aria-label', `Delete ${task.title}`);
  remove.addEventListener('click', async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    remove.disabled = true;
    try { await request(`/api/tasks/${task.id}`, {method: 'DELETE'}); await load(); }
    catch (err) { showError(err); remove.disabled = false; }
  });
  item.append(body, status, remove);
  return item;
}
function showError(err) { $('message').textContent = err.message; }
function render() {
  $('stat-total').textContent = tasks.length;
  for (const status of ['todo', 'in_progress', 'done']) {
    $('stat-' + ({todo: 'todo', in_progress: 'progress', done: 'done'}[status])).textContent = tasks.filter(t => t.status === status).length;
  }
  $('task-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
  const visible = tasks.filter(t => activeFilter === 'all' || t.status === activeFilter);
  $('task-list').replaceChildren(...(visible.length ? visible.map(taskElement) : [Object.assign(document.createElement('div'), {className: 'empty', textContent: 'Nothing here yet. Add a task to get started.'})]));
}
async function load() {
  const data = await request('/api/tasks');
  tasks = data.tasks;
  $('message').textContent = '';
  render();
}
$('task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('add-button');
  button.disabled = true;
  try {
    await request('/api/tasks', {method: 'POST', body: JSON.stringify({title: $('title').value, description: $('description').value})});
    $('task-form').reset();
    await load();
  } catch (err) { showError(err); }
  finally { button.disabled = false; }
});
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  activeFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('active', b === button));
  render();
}));
async function boot() {
  try {
    const health = await request('/api/health');
    $('db-status').textContent = health.database === 'connected' ? 'Database connected' : 'Database issue';
  } catch { $('db-status').textContent = 'Database offline'; }
  try { await load(); } catch (err) { showError(err); $('task-list').textContent = 'Could not load tasks. Check your database setup.'; }
}
boot();
