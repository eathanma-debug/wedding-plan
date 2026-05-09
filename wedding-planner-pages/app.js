const baseConfig = {
  supabaseUrl: "",
  supabaseAnonKey: "",
  allowedEmails: ["eathanma@gmail.com", "673112447@qq.com"],
  engagementDate: "2026-08-22",
  weddingDate: "2027-06-01"
};

const config = {
  ...baseConfig,
  ...(window.WORKBUDDY_CONFIG || {})
};

const PHASES = ["订婚前", "订婚中", "婚前准备", "婚前1月", "婚礼当天"];
const INCOME_CATEGORIES = ["存款", "每月存款", "工资", "奖金", "自己出资", "爸妈出资", "理财", "基金", "股票", "彩礼", "嫁妆", "其他"];
const EXPENSE_CATEGORIES = ["场地预订", "婚纱摄影", "婚宴", "珠宝首饰", "礼服西装", "婚庆策划", "请帖喜糖", "蜜月旅行", "其他"];
const allowedEmails = new Set((config.allowedEmails || []).map((email) => email.toLowerCase()));
const supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);

let store;
let toastTimer;
let categoryListenerBound = false;
let isLocalMode = false; // 标记是否降级到本地模式
const state = {
  user: null,
  settings: {
    engagementDate: toISODate(config.engagementDate),
    weddingDate: toISODate(config.weddingDate)
  },
  tasks: [],
  transactions: [],
  loading: false
};

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toISODate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value).trim();
  const match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  return text.slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function money(value) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

function numberValue(value) {
  const cleaned = String(value || "").replaceAll(",", "").trim();
  const next = Number(cleaned || 0);
  return Number.isFinite(next) ? next : 0;
}

function daysUntil(dateString) {
  if (!dateString) return null;
  const target = new Date(`${toISODate(dateString)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target - today) / 86400000);
}

function countdownText(dateString) {
  const days = daysUntil(dateString);
  if (days === null) return "未定";
  if (days === 0) return "今天";
  if (days > 0) return `${days} 天`;
  return `已过 ${Math.abs(days)} 天`;
}

function formatDate(dateString) {
  const iso = toISODate(dateString);
  if (!iso) return "未定";
  const [year, month, day] = iso.split("-");
  return `${year}.${month}.${day}`;
}

// DOM element cache
const els = {
  authScreen: document.getElementById("authScreen"),
  appShell: document.getElementById("appShell"),
  modePill: document.getElementById("modePill"),
  userEmail: document.getElementById("userEmail"),
  authForm: document.getElementById("authForm"),
  emailInput: document.getElementById("emailInput"),
  authModeNote: document.getElementById("authModeNote"),
  authError: document.getElementById("authError"),
  settingsForm: document.getElementById("settingsForm"),
  taskForm: document.getElementById("taskForm"),
  taskPhase: document.getElementById("taskPhase"),
  taskExpenseCategory: document.getElementById("taskExpenseCategory"),
  transactionForm: document.getElementById("transactionForm"),
  transactionType: document.getElementById("transactionType"),
  transactionCategory: document.getElementById("transactionCategory"),
  transactionTask: document.getElementById("transactionTask"),
  transactionRows: document.getElementById("transactionRows"),
  transactionCards: document.getElementById("transactionCards"),
  taskBoard: document.getElementById("taskBoard"),
  categoryBreakdown: document.getElementById("categoryBreakdown"),
  upcomingList: document.getElementById("upcomingList"),
  heroTodo: document.getElementById("heroTodo"),
  heroWeddingDays: document.getElementById("heroWeddingDays"),
  heroWeddingDate: document.getElementById("heroWeddingDate"),
  heroEngagementDays: document.getElementById("heroEngagementDays"),
  heroEngagementDate: document.getElementById("heroEngagementDate"),
  heroBalance: document.getElementById("heroBalance"),
  heroTaskSummary: document.getElementById("heroTaskSummary"),
  heroExpense: document.getElementById("heroExpense"),
  toast: document.getElementById("toast"),
  editDialog: document.getElementById("editDialog"),
  modalBody: document.getElementById("modalBody")
};

function notify(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("is-visible");
  toastTimer = setTimeout(() => els.toast.classList.remove("is-visible"), 2600);
}

function setBusy(button, busyText = "处理中") {
  if (!button) return () => {};
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  return () => {
    button.disabled = false;
    button.textContent = oldText;
  };
}

function readForm(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function fillSelect(select, options, selected = "") {
  select.innerHTML = options
    .map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function normalizeSettings(row = {}) {
  return {
    engagementDate: toISODate(row.engagement_date || row.engagementDate || config.engagementDate),
    weddingDate: toISODate(row.wedding_date || row.weddingDate || config.weddingDate)
  };
}

function normalizeTask(row) {
  return {
    id: row.id,
    name: row.name,
    phase: row.phase || PHASES[0],
    dueDate: toISODate(row.due_date || row.dueDate),
    plannedAmount: numberValue(row.planned_amount ?? row.plannedAmount),
    completed: Boolean(row.completed),
    notes: row.notes || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function normalizeTransaction(row) {
  return {
    id: row.id,
    date: toISODate(row.tx_date || row.date),
    amount: numberValue(row.amount),
    category: row.category || "其他",
    remarks: row.remarks || "",
    isIncome: Boolean(row.is_income ?? row.isIncome),
    taskId: row.task_id || row.taskId || "",
    createdAt: row.created_at || row.createdAt || "",
    updatedAt: row.updated_at || row.updatedAt || ""
  };
}

function taskToDb(input) {
  return {
    name: input.name,
    phase: input.phase,
    due_date: input.dueDate || null,
    planned_amount: numberValue(input.plannedAmount),
    completed: Boolean(input.completed),
    notes: input.notes || ""
  };
}

function transactionToDb(input) {
  return {
    tx_date: input.date,
    amount: numberValue(input.amount),
    category: input.category,
    remarks: input.remarks || "",
    is_income: Boolean(input.isIncome),
    task_id: input.taskId || null
  };
}

function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const phaseDiff = PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase);
    if (phaseDiff !== 0) return phaseDiff;
    return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
  });
}

function sortTransactions(transactions) {
  return [...transactions].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function getTaskName(taskId) {
  if (!taskId) return "";
  return state.tasks.find((task) => task.id === taskId)?.name || "已删掉的小事";
}

class LocalStore {
  constructor() {
    this.key = "workbuddy.wedding.local.v2";
    this.authKey = "workbuddy.wedding.local.user";
  }

  readDb() {
    const fallback = {
      settings: normalizeSettings(),
      tasks: [],
      transactions: []
    };
    try {
      const saved = JSON.parse(localStorage.getItem(this.key) || "{}");
      return {
        ...fallback,
        ...saved,
        settings: normalizeSettings(saved.settings || fallback.settings)
      };
    } catch {
      return fallback;
    }
  }

  writeDb(db) {
    localStorage.setItem(this.key, JSON.stringify(db));
  }

  getUser() {
    const email = localStorage.getItem(this.authKey);
    return email ? { id: `local-${email}`, email } : null;
  }

  async signIn(email) {
    localStorage.setItem(this.authKey, email);
    return { sent: false };
  }

  async signOut() {
    localStorage.removeItem(this.authKey);
  }

  onAuth() {}

  async fetchAll() {
    const db = this.readDb();
    return {
      settings: normalizeSettings(db.settings),
      tasks: (db.tasks || []).map(normalizeTask),
      transactions: (db.transactions || []).map(normalizeTransaction)
    };
  }

  async updateSettings(input) {
    const db = this.readDb();
    db.settings = normalizeSettings(input);
    this.writeDb(db);
  }

  async createTask(input) {
    const db = this.readDb();
    const task = normalizeTask({ ...input, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    db.tasks.push(task);
    this.writeDb(db);
    return task;
  }

  async updateTask(id, patch) {
    const db = this.readDb();
    db.tasks = db.tasks.map((task) => task.id === id ? { ...task, ...patch, updatedAt: new Date().toISOString() } : task);
    this.writeDb(db);
  }

  async deleteTask(id) {
    const db = this.readDb();
    db.tasks = db.tasks.filter((task) => task.id !== id);
    db.transactions = db.transactions.map((tx) => tx.taskId === id ? { ...tx, taskId: "" } : tx);
    this.writeDb(db);
  }

  async createTransaction(input) {
    const db = this.readDb();
    const tx = normalizeTransaction({ ...input, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    db.transactions.push(tx);
    this.writeDb(db);
    return tx;
  }

  async updateTransaction(id, patch) {
    const db = this.readDb();
    db.transactions = db.transactions.map((tx) => tx.id === id ? { ...tx, ...patch, updatedAt: new Date().toISOString() } : tx);
    this.writeDb(db);
  }

  async deleteTransaction(id) {
    const db = this.readDb();
    db.transactions = db.transactions.filter((tx) => tx.id !== id);
    this.writeDb(db);
  }
}

class SupabaseStore {
  constructor(client) {
    this.client = client;
  }

  async getUser() {
    const { data, error } = await this.client.auth.getSession();
    if (error) throw error;
    return data.session?.user ? { id: data.session.user.id, email: data.session.user.email } : null;
  }

  async signIn(email) {
    const { error } = await this.client.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: window.location.href,
        shouldCreateUser: true
      }
    });
    if (error) throw error;
    return { sent: true };
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  onAuth(callback) {
    this.client.auth.onAuthStateChange(async () => callback(await this.getUser()));
  }

  async ensureSettings() {
    const { data, error } = await this.client.from("wedding_settings").select("*").eq("id", "main").maybeSingle();
    if (error) throw error;
    if (data) return normalizeSettings(data);

    const inserted = await this.client.from("wedding_settings").insert({
      id: "main",
      engagement_date: config.engagementDate,
      wedding_date: config.weddingDate
    }).select().single();
    if (inserted.error) throw inserted.error;
    return normalizeSettings(inserted.data);
  }

  async fetchAll() {
    const [settings, tasks, transactions] = await Promise.all([
      this.ensureSettings(),
      this.client.from("tasks").select("*").order("due_date", { ascending: true }),
      this.client.from("transactions").select("*").order("tx_date", { ascending: false })
    ]);
    for (const result of [tasks, transactions]) {
      if (result.error) throw result.error;
    }
    return {
      settings,
      tasks: tasks.data.map(normalizeTask),
      transactions: transactions.data.map(normalizeTransaction)
    };
  }

  async updateSettings(input) {
    const { error } = await this.client.from("wedding_settings").upsert({
      id: "main",
      engagement_date: input.engagementDate,
      wedding_date: input.weddingDate
    });
    if (error) throw error;
  }

  async createTask(input) {
    const { data, error } = await this.client.from("tasks").insert(taskToDb(input)).select().single();
    if (error) throw error;
    return normalizeTask(data);
  }

  async updateTask(id, patch) {
    const { error } = await this.client.from("tasks").update(taskToDb(patch)).eq("id", id);
    if (error) throw error;
  }

  async deleteTask(id) {
    const { error } = await this.client.from("tasks").delete().eq("id", id);
    if (error) throw error;
  }

  async createTransaction(input) {
    const { data, error } = await this.client.from("transactions").insert(transactionToDb(input)).select().single();
    if (error) throw error;
    return normalizeTransaction(data);
  }

  async updateTransaction(id, patch) {
    const { error } = await this.client.from("transactions").update(transactionToDb(patch)).eq("id", id);
    if (error) throw error;
  }

  async deleteTransaction(id) {
    const { error } = await this.client.from("transactions").delete().eq("id", id);
    if (error) throw error;
  }
}

async function createStore() {
  // 如果没有配置 Supabase，直接使用本地模式
  if (!supabaseConfigured) {
    isLocalMode = true;
    return new LocalStore();
  }
  
  try {
    const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
    const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });
    
    // 测试 Supabase 连接
    const { error } = await client.auth.getSession();
    if (error) throw error;
    
    isLocalMode = false;
    return new SupabaseStore(client);
  } catch (error) {
    console.warn("⚠️ Supabase 连接失败，已自动切换到本地模式：", error.message);
    isLocalMode = true;
    return new LocalStore();
  }
}

function seedStaticOptions() {
  fillSelect(els.taskPhase, PHASES);
  fillSelect(els.taskExpenseCategory, EXPENSE_CATEGORIES);
  fillSelect(els.transactionCategory, INCOME_CATEGORIES);
  els.taskForm.elements.dueDate.value = todayISO();
  els.transactionForm.elements.date.value = todayISO();
  if (!categoryListenerBound) {
    els.transactionType.addEventListener("change", () => {
      fillSelect(
        els.transactionCategory,
        els.transactionType.value === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES
      );
    });
    categoryListenerBound = true;
  }
}

function showAuth() {
  els.authScreen.classList.remove("is-hidden");
  els.appShell.classList.add("is-hidden");
  
  // 根据是否本地模式显示不同提示
  if (isLocalMode && supabaseConfigured) {
    els.modePill.textContent = "本地模式";
    els.authModeNote.textContent = "⚠️ Supabase 连接失败，已自动切换到本地模式。记录只保存在当前浏览器。";
  } else if (isLocalMode) {
    els.modePill.textContent = "本机小屋";
    els.authModeNote.textContent = "现在是本机小屋，记录只留在这台电脑。";
  } else {
    els.modePill.textContent = "云端小屋";
    els.authModeNote.textContent = "输入被邀请的邮箱，会收到一封进入小屋的链接。";
  }
}

function showApp() {
  els.authScreen.classList.add("is-hidden");
  els.appShell.classList.remove("is-hidden");
  els.modePill.textContent = isLocalMode ? "本地模式" : "云端同步";
  els.userEmail.textContent = state.user?.email || "";
  
  // 如果是本地模式但配置了 Supabase，显示提示
  if (isLocalMode && supabaseConfigured) {
    notify("⚠️ Supabase 连接失败，当前使用本地模式。数据仅保存在浏览器中。");
  }
}

async function boot() {
  seedStaticOptions();
  store = await createStore();
  store.onAuth(async (user) => {
    state.user = user;
    if (state.user && !allowedEmails.has(state.user.email.toLowerCase())) {
      await store.signOut();
      state.user = null;
      notify("这个邮箱还没被邀请进小屋。");
    }
    await renderRoute();
  });

  state.user = await store.getUser();
  if (state.user && !allowedEmails.has(state.user.email.toLowerCase())) {
    await store.signOut();
    state.user = null;
  }
  await renderRoute();
}

async function renderRoute() {
  if (!state.user) {
    showAuth();
    return;
  }
  showApp();
  await loadData();
}

async function loadData() {
  state.loading = true;
  try {
    const data = await store.fetchAll();
    state.settings = normalizeSettings(data.settings);
    state.tasks = sortTasks(data.tasks);
    state.transactions = sortTransactions(data.transactions);
    renderAll();
  } catch (error) {
    notify(error.message || "读取小屋失败");
  } finally {
    state.loading = false;
  }
}

function renderAll() {
  renderSettingsForm();
  renderMetrics();
  renderUpcoming();
  renderTaskSelects();
  renderTaskBoard();
  renderFinance();
}

function renderSettingsForm() {
  els.settingsForm.elements.engagementDate.value = state.settings.engagementDate;
  els.settingsForm.elements.weddingDate.value = state.settings.weddingDate;
}

function renderMetrics() {
  const totalTasks = state.tasks.length;
  const doneTasks = state.tasks.filter((task) => task.completed).length;
  const pendingTasks = totalTasks - doneTasks;
  const income = state.transactions.filter((tx) => tx.isIncome).reduce((sum, tx) => sum + tx.amount, 0);
  const expense = state.transactions.filter((tx) => !tx.isIncome).reduce((sum, tx) => sum + tx.amount, 0);
  const balance = income - expense;

  els.heroTodo.textContent = `${pendingTasks} 项`;
  els.heroWeddingDays.textContent = countdownText(state.settings.weddingDate);
  els.heroWeddingDate.textContent = formatDate(state.settings.weddingDate);
  els.heroEngagementDays.textContent = countdownText(state.settings.engagementDate);
  els.heroBalance.textContent = money(balance);
  els.heroEngagementDate.textContent = formatDate(state.settings.engagementDate);
  els.heroTaskSummary.textContent = `${doneTasks}/${totalTasks} 做好了`;
  els.heroExpense.textContent = money(expense);
}

function renderUpcoming() {
  const upcoming = state.tasks
    .filter((task) => !task.completed)
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 8);

  if (!upcoming.length) {
    els.upcomingList.innerHTML = `<div class="empty-state">暂时没有要惦记的事。添一件小事后，这里会出现修改和删除。</div>`;
    return;
  }

  els.upcomingList.innerHTML = `<div class="upcoming-list">${
    upcoming.map((task) => `
      <div class="upcoming-row">
        <div class="upcoming-info">
          <span>${escapeHtml(task.name)}</span>
          <strong>${countdownText(task.dueDate)}</strong>
        </div>
        <div class="inline-actions">
          <button class="icon-button action-button" type="button" title="修改这件小事" data-action="edit-task" data-id="${task.id}">修改</button>
          <button class="icon-button action-button danger-action" type="button" title="删除这件小事" data-action="delete-task" data-id="${task.id}">删除</button>
        </div>
      </div>
    `).join("")
  }</div>`;
}

function renderTaskSelects() {
  const taskOptions = [{ value: "", label: "无" }].concat(
    state.tasks.map((task) => ({ value: task.id, label: `${task.name} · ${formatDate(task.dueDate)}` }))
  );
  fillSelect(els.transactionTask, taskOptions);
}

function actualSpentForTask(taskId) {
  return state.transactions
    .filter((tx) => !tx.isIncome && tx.taskId === taskId)
    .reduce((sum, tx) => sum + tx.amount, 0);
}

function renderTaskBoard() {
  els.taskBoard.innerHTML = PHASES.map((phase) => {
    const tasks = state.tasks.filter((task) => task.phase === phase);
    const done = tasks.filter((task) => task.completed).length;
    const cards = tasks.length ? tasks.map((task) => {
      const actual = actualSpentForTask(task.id);
      return `
        <article class="task-card ${task.completed ? "is-done" : ""}">
          <p class="task-name">${escapeHtml(task.name)}</p>
          <div class="task-meta">
            <span class="chip">${formatDate(task.dueDate)}</span>
            <span class="chip">预计 ${money(task.plannedAmount)}</span>
            <span class="chip">已花 ${money(actual)}</span>
          </div>
          ${task.notes ? `<div class="row-meta">${escapeHtml(task.notes)}</div>` : ""}
          <div class="task-actions">
            <button class="icon-button action-button" type="button" title="切换完成状态" data-action="toggle-task" data-id="${task.id}">${task.completed ? "再等等" : "做好了"}</button>
            <button class="icon-button action-button" type="button" title="修改这件小事" data-action="edit-task" data-id="${task.id}">修改</button>
            <button class="icon-button action-button danger-action" type="button" title="删除这件小事" data-action="delete-task" data-id="${task.id}">删除</button>
          </div>
        </article>
      `;
    }).join("") : `<div class="empty-state">这里还空着。添一件小事后，可以在卡片上修改或删除。</div>`;
    return `
      <section class="phase-lane">
        <div class="phase-title"><span>${escapeHtml(phase)}</span><span>${done}/${tasks.length}</span></div>
        ${cards}
      </section>
    `;
  }).join("");
}

function renderFinance() {
  renderCategoryBreakdown();
  renderTransactionRows();
}

function renderCategoryBreakdown() {
  const expenses = state.transactions.filter((tx) => !tx.isIncome);
  const total = expenses.reduce((sum, tx) => sum + tx.amount, 0);
  const grouped = expenses.reduce((acc, tx) => {
    acc[tx.category] = (acc[tx.category] || 0) + tx.amount;
    return acc;
  }, {});

  const rows = Object.entries(grouped)
    .sort((a, b) => b[1] - a[1])
    .map(([category, amount]) => {
      const percent = total ? Math.round((amount / total) * 100) : 0;
      return `
        <div class="breakdown-row">
          <div class="breakdown-label">
            <span>${escapeHtml(category)}</span>
            <strong>${money(amount)}</strong>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>
        </div>
      `;
    }).join("");

  els.categoryBreakdown.innerHTML = rows
    ? `<div class="breakdown-list">${rows}</div>`
    : `<div class="empty-state">还没有花费记录</div>`;
}

function renderTransactionRows() {
  if (!state.transactions.length) {
    els.transactionRows.innerHTML = `<tr><td colspan="7"><div class="empty-state">还没有小记录。存一笔收入或支出后，每一行都会有修改和删除。</div></td></tr>`;
    els.transactionCards.innerHTML = `<div class="empty-state">还没有小记录。存一笔收入或支出后，每张卡片底部都会有修改和删除。</div>`;
    return;
  }

  els.transactionRows.innerHTML = state.transactions.map((tx) => `
    <tr>
      <td>
        <div class="row-actions">
          <button class="icon-button action-button" type="button" title="修改这笔收支" data-action="edit-transaction" data-id="${tx.id}">修改</button>
          <button class="icon-button action-button danger-action" type="button" title="删除这笔收支" data-action="delete-transaction" data-id="${tx.id}">删除</button>
        </div>
      </td>
      <td>${formatDate(tx.date)}</td>
      <td>${tx.isIncome ? "收入" : "支出"}</td>
      <td class="${tx.isIncome ? "amount-income" : "amount-expense"}">${money(tx.amount)}</td>
      <td>${escapeHtml(tx.category)}</td>
      <td>${escapeHtml(getTaskName(tx.taskId) || "-")}</td>
      <td>${escapeHtml(tx.remarks || "-")}</td>
    </tr>
  `).join("");

  els.transactionCards.innerHTML = state.transactions.map((tx) => `
    <article class="transaction-card ${tx.isIncome ? "is-income" : "is-expense"}">
      <div class="transaction-card-head">
        <span class="transaction-type">${tx.isIncome ? "收入" : "支出"}</span>
        <strong class="${tx.isIncome ? "amount-income" : "amount-expense"}">${money(tx.amount)}</strong>
      </div>
      <div class="transaction-card-grid">
        <span>哪天</span><strong>${formatDate(tx.date)}</strong>
        <span>类目</span><strong>${escapeHtml(tx.category)}</strong>
        <span>关联</span><strong>${escapeHtml(getTaskName(tx.taskId) || "-")}</strong>
        <span>小备注</span><strong>${escapeHtml(tx.remarks || "-")}</strong>
      </div>
      <div class="card-actions">
        <button class="icon-button action-button" type="button" title="修改这笔收支" data-action="edit-transaction" data-id="${tx.id}">修改</button>
        <button class="icon-button action-button danger-action" type="button" title="删除这笔收支" data-action="delete-transaction" data-id="${tx.id}">删除</button>
      </div>
    </article>
  `).join("");
}

function closeDialog() {
  els.editDialog.close();
  els.modalBody.innerHTML = "";
}

function openTaskDialog(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    notify("未找到该任务，可能已被删除");
    return;
  }
  els.modalBody.innerHTML = `
    <form id="editTaskForm">
      <h3>修改这件小事</h3>
      <div class="modal-grid">
        <label>要准备的事<input name="name" type="text" value="${escapeHtml(task.name)}" required /></label>
        <label>现在在哪一步<select name="phase">${PHASES.map((phase) => `<option value="${phase}" ${phase === task.phase ? "selected" : ""}>${phase}</option>`).join("")}</select></label>
        <label>想在什么时候完成<input name="dueDate" type="date" value="${escapeHtml(task.dueDate)}" /></label>
        <label>预计花多少<input name="plannedAmount" type="text" inputmode="decimal" value="${task.plannedAmount}" /></label>
        <label class="span-2">小备注<input name="notes" type="text" value="${escapeHtml(task.notes)}" /></label>
      </div>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-action="close-dialog">取消</button>
        <button class="primary-button" type="submit">存好</button>
      </div>
    </form>
  `;
  const form = els.modalBody.querySelector("#editTaskForm");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = setBusy(event.submitter, "存好中");
    const input = readForm(form);
    try {
      await store.updateTask(id, {
        name: input.name.trim(),
        phase: input.phase,
        dueDate: input.dueDate,
        plannedAmount: numberValue(input.plannedAmount),
        notes: input.notes.trim(),
        completed: task.completed
      });
      closeDialog();
      await loadData();
      notify("这件事已存好");
    } catch (error) {
      notify(error.message || "保存失败");
    } finally {
      done();
    }
  });
  els.editDialog.showModal();
}

function openTransactionDialog(id) {
  const tx = state.transactions.find((item) => item.id === id);
  if (!tx) {
    notify("未找到该记录，可能已被删除");
    return;
  }
  const categoryOptions = (tx.isIncome ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)
    .map((category) => `<option value="${category}" ${category === tx.category ? "selected" : ""}>${category}</option>`)
    .join("");
  const taskOptions = [{ value: "", label: "无" }].concat(
    state.tasks.map((task) => ({ value: task.id, label: task.name }))
  ).map((option) => `<option value="${option.value}" ${option.value === tx.taskId ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("");

  els.modalBody.innerHTML = `
    <form id="editTransactionForm">
      <h3>修改这笔小记录</h3>
      <div class="modal-grid">
        <label>哪一天<input name="date" type="date" value="${escapeHtml(tx.date)}" required /></label>
        <label>记一笔<select name="type"><option value="income" ${tx.isIncome ? "selected" : ""}>收入</option><option value="expense" ${!tx.isIncome ? "selected" : ""}>支出</option></select></label>
        <label>多少钱<input name="amount" type="text" inputmode="decimal" value="${tx.amount}" required /></label>
        <label>放在哪一类<select name="category">${categoryOptions}</select></label>
        <label>关联的小事<select name="taskId">${taskOptions}</select></label>
        <label>小备注<input name="remarks" type="text" value="${escapeHtml(tx.remarks)}" /></label>
      </div>
      <div class="modal-actions">
        <button class="ghost-button" type="button" data-action="close-dialog">取消</button>
        <button class="primary-button" type="submit">存好</button>
      </div>
    </form>
  `;
  const form = els.modalBody.querySelector("#editTransactionForm");
  form.elements.type.addEventListener("change", () => {
    fillSelect(form.elements.category, form.elements.type.value === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES);
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = setBusy(event.submitter, "存好中");
    const input = readForm(form);
    try {
      await store.updateTransaction(id, {
        date: input.date,
        amount: numberValue(input.amount),
        category: input.category,
        remarks: input.remarks.trim(),
        isIncome: input.type === "income",
        taskId: input.taskId
      });
      closeDialog();
      await loadData();
      notify("这笔记录已存好");
    } catch (error) {
      notify(error.message || "保存失败");
    } finally {
      done();
    }
  });
  els.editDialog.showModal();
}

async function handleDocumentAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;

  if (action === "close-dialog") {
    closeDialog();
  }

  if (action === "sign-out") {
    await store.signOut();
    state.user = null;
    state.tasks = [];
    state.transactions = [];
    showAuth();
  }

  if (action === "refresh") {
    await loadData();
    notify("小屋已同步");
  }

  if (action === "toggle-task") {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) {
      notify("未找到该任务");
      return;
    }
    try {
      await store.updateTask(id, {
        ...task,
        completed: !task.completed
      });
      await loadData();
    } catch (error) {
      notify(error.message || "切换状态失败");
    }
  }

  if (action === "edit-task") openTaskDialog(id);

  if (action === "delete-task") {
    const task = state.tasks.find((item) => item.id === id);
    if (!task) {
      notify("未找到该任务");
      return;
    }
    if (!confirm(`确定要删除「${task.name}」吗？相关小金库记录会保留。`)) return;
    try {
      await store.deleteTask(id);
      await loadData();
      notify("这件事已删掉");
    } catch (error) {
      notify(error.message || "删除失败");
    }
  }

  if (action === "edit-transaction") openTransactionDialog(id);

  if (action === "delete-transaction") {
    const tx = state.transactions.find((item) => item.id === id);
    if (!tx) {
      notify("未找到该记录");
      return;
    }
    const amountText = `${tx.isIncome ? "收入" : "支出"} ${money(tx.amount)}`;
    if (!confirm(`确定要删除这笔${amountText}吗？`)) return;
    try {
      await store.deleteTransaction(id);
      await loadData();
      notify("这笔记录已删掉");
    } catch (error) {
      notify(error.message || "删除失败");
    }
  }
}

els.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  els.authError.textContent = "";
  const email = els.emailInput.value.trim().toLowerCase();
  if (!allowedEmails.has(email)) {
    els.authError.textContent = "这个邮箱还没被邀请进小屋。";
    return;
  }
  const done = setBusy(event.submitter, supabaseConfigured ? "发送中" : "进入中");
  try {
    const result = await store.signIn(email);
    if (result.sent) {
      els.authModeNote.textContent = "入口链接已发到邮箱啦，点一下就能回来。";
    } else {
      state.user = await store.getUser();
      await renderRoute();
    }
  } catch (error) {
    els.authError.textContent = error.message || "进入小屋失败";
  } finally {
    done();
  }
});

els.settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const done = setBusy(event.submitter, "存好中");
  const input = readForm(form);
  try {
    await store.updateSettings({
      engagementDate: input.engagementDate,
      weddingDate: input.weddingDate
    });
    await loadData();
    notify("日子已记好");
  } catch (error) {
    notify(error.message || "保存失败");
  } finally {
    done();
  }
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const done = setBusy(event.submitter, "添加中");
  const input = readForm(form);
  const plannedAmount = numberValue(input.plannedAmount);
  try {
    const task = await store.createTask({
      name: input.name.trim(),
      phase: input.phase,
      dueDate: input.dueDate,
      plannedAmount,
      notes: input.notes.trim(),
      completed: false
    });

    state.tasks = sortTasks([...state.tasks, task]);

    if (input.recordExpense && plannedAmount > 0) {
      const tx = await store.createTransaction({
        date: todayISO(),
        amount: plannedAmount,
        category: input.expenseCategory,
        remarks: input.name.trim(),
        isIncome: false,
        taskId: task.id
      });
      state.transactions = sortTransactions([...state.transactions, tx]);
    }

    form.reset();
    seedStaticOptions();
    renderAll();
    notify("小事已加入清单");
  } catch (error) {
    notify(error.message || "添加失败");
  } finally {
    done();
  }
});

els.transactionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const done = setBusy(event.submitter, "存入中");
  const input = readForm(form);
  try {
    const tx = await store.createTransaction({
      date: input.date,
      amount: numberValue(input.amount),
      category: input.category,
      remarks: input.remarks.trim(),
      isIncome: input.type === "income",
      taskId: input.taskId
    });
    state.transactions = sortTransactions([...state.transactions, tx]);
    form.reset();
    els.transactionForm.elements.date.value = todayISO();
    fillSelect(els.transactionCategory, INCOME_CATEGORIES);
    renderAll();
    notify("小金库已记好");
  } catch (error) {
    notify(error.message || "记录失败");
  } finally {
    done();
  }
});

document.addEventListener("click", handleDocumentAction);

boot().catch((error) => {
  els.authError.textContent = error.message || "小屋打开失败";
});
