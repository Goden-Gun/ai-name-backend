const sections = [
  { id: "users", title: "用户管理", eyebrow: "Users" },
  { id: "codes", title: "激活码管理", eyebrow: "Activation Codes" },
  { id: "questions", title: "题目管理", eyebrow: "Question Bank" },
  { id: "skills", title: "Skill 管理", eyebrow: "Skills" },
  { id: "knowledge", title: "知识库管理", eyebrow: "Knowledge" },
];

const skillOrder = ["naming", "brand_intro", "slogan"];
const skillFileOrder = ["system.md", "user.md", "manifest.yaml"];
const adminSessionKey = "ai-name.admin.access";
const adminTokenSessionKey = "ai-name.admin.token";

const state = {
  section: "users",
  apiBase: localStorage.getItem("admin.apiBase") || "/api/v1",
  token: sessionStorage.getItem(adminTokenSessionKey) || "",
  categories: [],
  activeCategoryId: 0,
  activeGroupId: 0,
  activeQuestionId: 0,
  questionTree: null,
  skills: [],
  activeSkill: "naming",
  activeSkillFile: "system.md",
  knowledgeSources: [],
  activeKnowledgeId: 0,
  sortClickSuppressUntil: 0,
};

const $ = (selector) => document.querySelector(selector);

function setStatus(text, isError = false) {
  const node = $("#statusText");
  node.textContent = text;
  node.style.color = isError ? "#a13232" : "#526274";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function bySortThenId(a, b) {
  const sortA = Number(a?.sort_order ?? 0);
  const sortB = Number(b?.sort_order ?? 0);
  if (sortA !== sortB) return sortA - sortB;
  return Number(a?.id ?? 0) - Number(b?.id ?? 0);
}

function sortSkills(skills) {
  return [...(skills || [])].sort((a, b) => {
    const indexA = skillOrder.indexOf(a.key);
    const indexB = skillOrder.indexOf(b.key);
    const safeA = indexA === -1 ? 999 : indexA;
    const safeB = indexB === -1 ? 999 : indexB;
    if (safeA !== safeB) return safeA - safeB;
    return String(a.key).localeCompare(String(b.key));
  });
}

function sortSkillFiles(files) {
  return [...(files || [])].sort((a, b) => {
    const nameA = typeof a === "string" ? a : a.name;
    const nameB = typeof b === "string" ? b : b.name;
    const indexA = skillFileOrder.indexOf(nameA);
    const indexB = skillFileOrder.indexOf(nameB);
    const safeA = indexA === -1 ? 999 : indexA;
    const safeB = indexB === -1 ? 999 : indexB;
    if (safeA !== safeB) return safeA - safeB;
    return String(nameA).localeCompare(String(nameB));
  });
}

function questionModeValue(question = {}) {
  if (question.answer_mode === "choice" && question.choice_mode === "single") return "single";
  if (question.answer_mode === "choice" && question.choice_mode === "multiple") return "multiple";
  return "subjective";
}

function questionModeLabel(question = {}) {
  const mode = questionModeValue(question);
  const map = { subjective: "主观", single: "单选", multiple: "多选" };
  return map[mode] || "主观";
}

function questionTypeForMode(mode) {
  if (mode === "single") return "single-select";
  if (mode === "multiple") return "multi-select";
  return "text";
}

function currentCategory() {
  return state.categories.find((item) => item.id === state.activeCategoryId);
}

function currentGroup() {
  return (state.questionTree?.groups || []).find((item) => item.id === state.activeGroupId);
}

function currentQuestion() {
  return (currentGroup()?.questions || []).find((item) => item.id === state.activeQuestionId);
}

function checked(value) {
  return value ? "checked" : "";
}

function selected(value, target) {
  return String(value ?? "") === String(target ?? "") ? "selected" : "";
}

function isAdminUnlocked() {
  return sessionStorage.getItem(adminSessionKey) === "1" && Boolean(sessionStorage.getItem(adminTokenSessionKey));
}

function showLogin() {
  $("#adminLogin").hidden = false;
  $("#appShell").hidden = true;
  $("#adminKeyInput").focus();
}

function showAdminApp() {
  $("#adminLogin").hidden = true;
  $("#appShell").hidden = false;
  render();
}

function initAdminLogin() {
  $("#adminKeySubmit").onclick = async () => {
    const submitButton = $("#adminKeySubmit");
    const value = $("#adminKeyInput").value.trim();
    $("#adminKeyError").textContent = "";
    if (!value) {
      $("#adminKeyError").textContent = "请输入管理员密钥";
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = "登录中...";
    try {
      const token = await requestAdminToken(value);
      state.token = token;
      sessionStorage.setItem(adminSessionKey, "1");
      sessionStorage.setItem(adminTokenSessionKey, token);
      localStorage.removeItem("admin.token");
      $("#adminKeyInput").value = "";
      showAdminApp();
    } catch (error) {
      $("#adminKeyError").textContent = error.message || "管理员密钥不正确";
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "登录后台";
    }
  };
  $("#adminKeyInput").onkeydown = (event) => {
    if (event.key === "Enter") $("#adminKeySubmit").click();
  };
  if (isAdminUnlocked()) showAdminApp();
  else showLogin();
}

async function requestAdminToken(accessKey) {
  let response;
  try {
    response = await fetch(`${state.apiBase}/admin/login`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: accessKey }),
    });
  } catch {
    throw new Error("无法连接服务端");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0 || !payload.data?.token) {
    throw new Error(payload?.message || payload?.detail || "管理员密钥不正确");
  }
  return payload.data.token;
}

function sortOrderForIndex(index) {
  return (index + 1) * 10;
}

function hasSameOrder(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function attachDragSort(container, itemSelector, dataKey, onReorder) {
  if (!container) return;
  let draggedItem = null;
  let originalIds = [];
  let moved = false;
  const getIds = () => [...container.querySelectorAll(itemSelector)].map((item) => Number(item.dataset[dataKey]));

  container.querySelectorAll(itemSelector).forEach((item) => {
    item.addEventListener("dragstart", (event) => {
      draggedItem = item;
      moved = false;
      originalIds = getIds();
      item.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.dataset[dataKey]);
    });
    item.addEventListener("dragend", async () => {
      if (!draggedItem) return;
      const nextIds = getIds();
      const shouldSave = moved && !hasSameOrder(originalIds, nextIds);
      draggedItem.classList.remove("dragging");
      draggedItem = null;
      moved = false;
      originalIds = [];
      state.sortClickSuppressUntil = Date.now() + 350;
      if (shouldSave) await onReorder(nextIds);
    });
  });

  container.addEventListener("dragover", (event) => {
    if (!draggedItem) return;
    const target = event.target instanceof Element ? event.target.closest(itemSelector) : null;
    if (!target || !container.contains(target) || target === draggedItem) return;
    event.preventDefault();
    const rect = target.getBoundingClientRect();
    const shouldInsertBefore = event.clientY < rect.top + rect.height / 2;
    container.insertBefore(draggedItem, shouldInsertBefore ? target : target.nextSibling);
    moved = true;
  });

  container.addEventListener("drop", (event) => {
    if (draggedItem) event.preventDefault();
  });
}

function questionRequirementValue(question = {}) {
  return question.skippable ? "skippable" : "required";
}

async function api(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
  };
  const response = await fetch(`${state.apiBase}${path}`, { ...options, headers });
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/csv")) return response.text();
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.code !== 0) {
    throw new Error(payload?.message || payload?.detail || `HTTP ${response.status}`);
  }
  return payload.data;
}

function renderShell() {
  $("#apiBase").value = state.apiBase;
  $("#nav").innerHTML = sections.map((item) => `
    <button class="${state.section === item.id ? "active" : ""}" data-section="${item.id}">${item.title}</button>
  `).join("");
  $("#nav").querySelectorAll("button").forEach((button) => {
    button.addEventListener("click", () => {
      state.section = button.dataset.section;
      render();
    });
  });
  $("#saveAuth").onclick = () => {
    state.apiBase = $("#apiBase").value.trim().replace(/\/$/, "");
    localStorage.setItem("admin.apiBase", state.apiBase);
    setStatus("API Base 已保存");
  };
  $("#logoutAdmin").onclick = () => {
    sessionStorage.removeItem(adminSessionKey);
    sessionStorage.removeItem(adminTokenSessionKey);
    state.token = "";
    showLogin();
  };
}

async function render() {
  renderShell();
  const section = sections.find((item) => item.id === state.section);
  $("#sectionTitle").textContent = section.title;
  $("#sectionEyebrow").textContent = section.eyebrow;
  $("#view").innerHTML = "<div class='empty'>加载中...</div>";
  try {
    if (state.section === "users") await renderUsers();
    if (state.section === "codes") await renderCodes();
    if (state.section === "questions") await renderQuestions();
    if (state.section === "skills") await renderSkills();
    if (state.section === "knowledge") await renderKnowledge();
    setStatus("已连接");
  } catch (error) {
    $("#view").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, true);
  }
}

async function renderUsers() {
  $("#view").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">用户查询</h3></div>
      <div class="panel-body filters">
        <div><label>手机号</label><input id="userMobile"></div>
        <div><label>User ID</label><input id="userId"></div>
        <div><label>激活码</label><input id="userCode"></div>
        <div><label>页码</label><input id="userPage" value="1"></div>
        <button class="primary" id="loadUsers">查询</button>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">用户列表</h3></div>
      <div class="table-wrap" id="usersTable"></div>
    </section>
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">用户详情</h3></div>
      <div class="panel-body"><pre class="json-preview" id="userDetail">选择用户查看详情</pre></div>
    </section>
  `;
  $("#loadUsers").onclick = loadUsers;
  await loadUsers();
}

async function loadUsers() {
  const params = new URLSearchParams({
    page: $("#userPage")?.value || "1",
    page_size: "20",
  });
  if ($("#userMobile")?.value) params.set("mobile", $("#userMobile").value.trim());
  if ($("#userId")?.value) params.set("user_id", $("#userId").value.trim());
  if ($("#userCode")?.value) params.set("activation_code", $("#userCode").value.trim());
  const data = await api(`/admin/users?${params}`);
  const items = data.items || [];
  $("#usersTable").innerHTML = table(["手机号", "User ID", "激活码", "套餐", "任务数", "最近结果", "操作"], items.map((item) => [
    item.mobile,
    `<span class="mono">${item.user_id}</span>`,
    (item.activation_codes || []).map((code) => `<span class="pill">${escapeHtml(code.code)}</span>`).join(" "),
    item.highest_tier || "-",
    item.task_count || 0,
    item.latest_result_summary || "-",
    `<button data-user="${item.user_id}">详情</button>`,
  ]));
  $("#usersTable").querySelectorAll("button[data-user]").forEach((button) => {
    button.onclick = async () => {
      const detail = await api(`/admin/users/${button.dataset.user}`);
      $("#userDetail").textContent = JSON.stringify(detail, null, 2);
    };
  });
}

async function renderCodes() {
  $("#view").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">批量生成</h3></div>
      <div class="panel-body form-grid">
        <div><label>数量</label><input id="codeCount" value="20"></div>
        <div><label>套餐</label><select id="codeTier"><option value="1">Lite</option><option value="2">Plus</option><option value="3">Ultra</option></select></div>
        <div><label>前缀</label><input id="codePrefix" value="AI"></div>
        <div><label>备注</label><input id="codeNote"></div>
        <button class="primary" id="createCodes">生成</button>
      </div>
      <div class="panel-body code-list mono" id="newCodes"></div>
    </section>
    <section class="panel">
      <div class="panel-header"><h3 class="panel-title">激活码查询</h3><button id="exportCodes">导出 CSV</button></div>
      <div class="panel-body filters">
        <div><label>状态</label><select id="filterStatus"><option value="">全部</option><option value="1">可用</option><option value="2">已用</option><option value="3">禁用</option></select></div>
        <div><label>套餐</label><select id="filterTier"><option value="">全部</option><option value="1">Lite</option><option value="2">Plus</option><option value="3">Ultra</option></select></div>
        <div><label>手机号</label><input id="filterMobile"></div>
        <div><label>Code</label><input id="filterCode"></div>
        <button class="primary" id="loadCodes">查询</button>
      </div>
      <div class="table-wrap" id="codesTable"></div>
    </section>
  `;
  $("#createCodes").onclick = async () => {
    const data = await api("/admin/activation-code-batches", {
      method: "POST",
      body: JSON.stringify({
        count: Number($("#codeCount").value),
        tier: Number($("#codeTier").value),
        prefix: $("#codePrefix").value.trim(),
        note: $("#codeNote").value.trim(),
      }),
    });
    $("#newCodes").textContent = (data.codes || []).map((item) => item.code).join("\n");
    await loadCodes();
  };
  $("#loadCodes").onclick = loadCodes;
  $("#exportCodes").onclick = exportCodes;
  await loadCodes();
}

function codeParams() {
  const params = new URLSearchParams({ page: "1", page_size: "100" });
  if ($("#filterStatus")?.value) params.set("status", $("#filterStatus").value);
  if ($("#filterTier")?.value) params.set("tier", $("#filterTier").value);
  if ($("#filterMobile")?.value) params.set("mobile", $("#filterMobile").value.trim());
  if ($("#filterCode")?.value) params.set("code", $("#filterCode").value.trim());
  return params;
}

async function loadCodes() {
  const data = await api(`/admin/activation-codes?${codeParams()}`);
  const items = data.items || [];
  $("#codesTable").innerHTML = table(["Code", "套餐", "状态", "批次", "用户", "使用时间", "操作"], items.map((item) => [
    `<span class="mono">${escapeHtml(item.code)}</span>`,
    item.tier,
    statusLabel(item.status),
    item.batch_id || "-",
    item.user_id || "-",
    item.used_at || "-",
    item.status === 1 ? `<button class="danger" data-disable="${item.code}">禁用</button>` : "",
  ]));
  $("#codesTable").querySelectorAll("button[data-disable]").forEach((button) => {
    button.onclick = async () => {
      await api(`/admin/activation-codes/${encodeURIComponent(button.dataset.disable)}/disable`, { method: "PATCH", body: JSON.stringify({ reason: "manual" }) });
      await loadCodes();
    };
  });
}

async function exportCodes() {
  const csv = await api(`/admin/activation-codes/export?${codeParams()}`);
  downloadText("activation_codes.csv", csv, "text/csv;charset=utf-8");
}

async function renderQuestions() {
  const data = await api("/admin/question-categories");
  state.categories = (data || []).sort(bySortThenId);
  if (!state.activeCategoryId || !state.categories.some((cat) => cat.id === state.activeCategoryId)) {
    state.activeCategoryId = state.categories[0]?.id || 0;
  }
  $("#view").innerHTML = `
    <div class="question-workbench">
      <section class="panel question-nav-panel">
        <div class="panel-header">
          <h3 class="panel-title">题库结构</h3>
          <div class="row-actions">
            <button class="primary" id="newCategory">新建类别</button>
            <button id="reloadQuestions">刷新</button>
          </div>
        </div>
        <div class="panel-body question-tree" id="questionTreeNav"></div>
      </section>
      <section class="panel question-list-panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title" id="questionGroupTitle">题组</h3>
            <p class="panel-subtitle" id="questionGroupMeta"></p>
          </div>
          <div class="row-actions">
            <button class="primary" id="newQuestion">新建题目</button>
            <button id="newGroup">新建题组</button>
          </div>
        </div>
        <div class="panel-body" id="groupEditor"></div>
        <div class="question-list" id="questionList"></div>
      </section>
      <section class="panel question-detail-panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title" id="questionFormTitle">题目详情</h3>
            <p class="panel-subtitle" id="questionFormMeta"></p>
          </div>
        </div>
        <div class="panel-body" id="questionForm"></div>
      </section>
    </div>
  `;
  $("#reloadQuestions").onclick = async () => {
    if (!state.activeCategoryId) {
      await renderQuestions();
      setStatus("题库已刷新");
      return;
    }
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus("题库已刷新");
  };
  $("#newCategory").onclick = () => {
    openCategoryModal();
  };
  $("#newGroup").onclick = () => {
    openGroupModal();
  };
  $("#newQuestion").onclick = () => {
    openQuestionModal();
  };
  if (!state.activeCategoryId) {
    $("#questionTreeNav").innerHTML = "<div class='empty'>暂无类别</div>";
    $("#groupEditor").innerHTML = "<div class='empty'>请先创建类别</div>";
    $("#questionList").innerHTML = "";
    $("#questionForm").innerHTML = "";
    return;
  }
  await loadQuestionTree();
  paintQuestionWorkbench();
}

async function loadQuestionTree() {
  const [tree, groups] = await Promise.all([
    api(`/admin/categories/${state.activeCategoryId}/tree`),
    api(`/admin/question-groups?category_id=${state.activeCategoryId}`),
  ]);
  const questionsByGroup = new Map((tree.groups || []).map((group) => [group.id, group.questions || []]));
  state.questionTree = {
    ...tree,
    groups: (groups || []).sort(bySortThenId).map((group) => ({
      ...group,
      questions: [...(questionsByGroup.get(group.id) || [])].sort(bySortThenId),
    })),
  };
  if (!state.activeGroupId || !state.questionTree.groups.some((group) => group.id === state.activeGroupId)) {
    state.activeGroupId = state.questionTree.groups[0]?.id || 0;
  }
  if (!currentQuestion()) state.activeQuestionId = 0;
}

function paintQuestionWorkbench() {
  paintQuestionTree();
  paintGroupEditor();
  paintQuestionList();
  paintQuestionForm();
}

function paintQuestionTree() {
  $("#questionTreeNav").innerHTML = state.categories.map((category) => {
    const isActiveCategory = category.id === state.activeCategoryId;
    const isEnabled = category.status !== "disabled";
    const groups = isActiveCategory ? (state.questionTree?.groups || []) : [];
    return `
      <div class="tree-block">
        <button class="tree-node category-node ${isActiveCategory ? "active" : ""}" data-cat="${category.id}">
          <span>
            <strong>${escapeHtml(category.label || category.name || category.key)}</strong>
            <small>${escapeHtml(category.key)}</small>
          </span>
          ${statusLabel(category.status)}
        </button>
        <div class="category-actions">
          <button type="button" data-toggle-category="${category.id}" data-next-status="${isEnabled ? "disabled" : "enabled"}">${isEnabled ? "禁用" : "启用"}</button>
          <button type="button" class="danger" data-delete-category="${category.id}">删除</button>
        </div>
        ${isActiveCategory ? `<div class="tree-children">
          ${groups.length ? groups.map((group) => `
            <button class="tree-node group-node ${group.id === state.activeGroupId ? "active" : ""}" data-group="${group.id}" draggable="true">
              <span>
                <strong>${escapeHtml(group.title)}</strong>
                <small>${group.questions?.length || 0} 题</small>
              </span>
              ${Number(group.random_pick_count || 0) > 0 ? `<em>随机 ${group.random_pick_count}</em>` : "<em>全出</em>"}
            </button>
          `).join("") : "<div class='tree-empty'>暂无题组</div>"}
        </div>` : ""}
      </div>
    `;
  }).join("");
  $("#questionTreeNav").querySelectorAll("button[data-cat]").forEach((button) => {
    button.onclick = async () => {
      state.activeCategoryId = Number(button.dataset.cat);
      state.activeGroupId = 0;
      state.activeQuestionId = 0;
      await loadQuestionTree();
      paintQuestionWorkbench();
    };
  });
  $("#questionTreeNav").querySelectorAll("button[data-toggle-category]").forEach((button) => {
    button.onclick = async () => {
      const category = state.categories.find((item) => item.id === Number(button.dataset.toggleCategory));
      if (!category) return;
      await toggleCategoryStatus(category, button.dataset.nextStatus);
    };
  });
  $("#questionTreeNav").querySelectorAll("button[data-delete-category]").forEach((button) => {
    button.onclick = async () => {
      const category = state.categories.find((item) => item.id === Number(button.dataset.deleteCategory));
      if (!category) return;
      await deleteCategory(category);
    };
  });
  $("#questionTreeNav").querySelectorAll("button[data-group]").forEach((button) => {
    button.onclick = () => {
      if (Date.now() < state.sortClickSuppressUntil) return;
      state.activeGroupId = Number(button.dataset.group);
      state.activeQuestionId = 0;
      paintQuestionWorkbench();
    };
  });
  attachDragSort($("#questionTreeNav").querySelector(".tree-children"), ".group-node[data-group]", "group", reorderGroups);
}

function nextCategoryOrder() {
  const maxOrder = Math.max(0, ...state.categories.map((item) => Number(item.sort_order || 0)));
  return maxOrder + 10;
}

function renderCategoryFields(prefix, category = {}, submitLabel = "保存类别") {
  return `
    <div class="form-grid">
      <div class="span-5"><label>类别名称</label><textarea class="title-textarea" id="${prefix}CategoryLabel" rows="2">${escapeHtml(category?.label || category?.name || "")}</textarea></div>
      <div class="span-3"><label>类别标识</label><input id="${prefix}CategoryKey" value="${escapeHtml(category?.key || "")}" placeholder="brand"></div>
      <div><label>状态</label><select id="${prefix}CategoryStatus">
        <option value="enabled" ${selected(category?.status || "enabled", "enabled")}>启用</option>
        <option value="disabled" ${selected(category?.status, "disabled")}>禁用</option>
      </select></div>
      <div class="span-5"><label>说明</label><input id="${prefix}CategoryDescription" value="${escapeHtml(category?.description || "")}"></div>
      <div class="span-5 form-error" id="${prefix}CategoryFormError"></div>
      <div class="span-5 row-actions">
        <button class="primary" id="${prefix}SaveCategory">${submitLabel}</button>
      </div>
    </div>
  `;
}

function attachCategoryForm(prefix, onSave) {
  $(`#${prefix}SaveCategory`).onclick = onSave;
}

function readCategoryPayload(prefix, category) {
  const label = $(`#${prefix}CategoryLabel`).value.trim();
  const key = $(`#${prefix}CategoryKey`).value.trim();
  return {
    key,
    name: label,
    label,
    description: $(`#${prefix}CategoryDescription`).value.trim(),
    status: $(`#${prefix}CategoryStatus`).value,
    sort_order: Number(category?.sort_order ?? nextCategoryOrder()),
  };
}

async function saveCategory(prefix, category) {
  const payload = readCategoryPayload(prefix, category);
  if (!payload.label) {
    $(`#${prefix}CategoryFormError`).textContent = "类别名称不能为空";
    return;
  }
  if (!payload.key) {
    $(`#${prefix}CategoryFormError`).textContent = "类别标识不能为空";
    return;
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(payload.key)) {
    $(`#${prefix}CategoryFormError`).textContent = "类别标识只能包含英文、数字、下划线或中划线";
    return;
  }
  const saved = category
    ? await api(`/admin/question-categories/${category.id}`, { method: "PATCH", body: JSON.stringify({ ...category, ...payload }) })
    : await api("/admin/question-categories", { method: "POST", body: JSON.stringify(payload) });
  state.activeCategoryId = saved.id;
  state.activeGroupId = 0;
  state.activeQuestionId = 0;
  closeModal();
  await renderQuestions();
  setStatus("类别已保存");
}

function openCategoryModal() {
  closeModal();
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "modalRoot";
  modal.innerHTML = `
    <section class="modal-panel modal-panel-narrow">
      <div class="modal-header">
        <div>
          <h3 class="panel-title">新建类别</h3>
          <p class="panel-subtitle">题库结构第一层</p>
        </div>
        <button type="button" id="closeModal">关闭</button>
      </div>
      <div class="modal-body">
        ${renderCategoryFields("newCategory", {}, "创建类别")}
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  $("#closeModal").onclick = closeModal;
  modal.onclick = (event) => {
    if (event.target === modal) closeModal();
  };
  attachCategoryForm("newCategory", () => saveCategory("newCategory", null));
}

async function toggleCategoryStatus(category, status) {
  const updated = await api(`/admin/question-categories/${category.id}`, {
    method: "PATCH",
    body: JSON.stringify({ ...category, status }),
  });
  state.categories = state.categories.map((item) => (item.id === updated.id ? updated : item));
  await loadQuestionTree();
  paintQuestionWorkbench();
  setStatus(status === "disabled" ? "类别已禁用" : "类别已启用");
}

async function deleteCategory(category) {
  if (!category) return;
  if (!confirm(`确定删除类别「${category.label || category.name || category.key}」吗？该类别下的题组和题目也会一起删除。`)) return;
  await api(`/admin/question-categories/${category.id}`, { method: "DELETE" });
  if (state.activeCategoryId === category.id) {
    state.activeCategoryId = 0;
    state.activeGroupId = 0;
    state.activeQuestionId = 0;
  }
  await renderQuestions();
  setStatus("类别已删除");
}

function paintGroupEditor() {
  const category = currentCategory();
  const group = currentGroup();
  $("#questionGroupTitle").textContent = group ? group.title : "题组";
  $("#questionGroupMeta").textContent = category ? `${category.label || category.name} / ${category.key}` : "";
  if (!group) {
    $("#groupEditor").innerHTML = "<div class='empty'>当前类别暂无题组，点击「新建题组」创建</div>";
    return;
  }
  $("#groupEditor").innerHTML = renderGroupFields("editGroup", group, "保存题组", true);
  attachGroupForm("editGroup", () => saveGroup("editGroup", group));
  $("#editGroupDeleteGroup").onclick = () => deleteGroup(group);
}

function renderGroupFields(prefix, group = {}, submitLabel = "保存题组", showDelete = false) {
  return `
    <div class="form-grid group-form">
      <div class="span-5"><label>题组标题</label><textarea class="title-textarea" id="${prefix}Title" rows="2">${escapeHtml(group?.title || "")}</textarea></div>
      <div><label>状态</label><select id="${prefix}Status">
        <option value="enabled" ${selected(group?.status || "enabled", "enabled")}>启用</option>
        <option value="disabled" ${selected(group?.status, "disabled")}>禁用</option>
      </select></div>
      <div><label>随机出题数</label><input id="${prefix}Random" type="number" min="0" value="${Number(group?.random_pick_count || 0)}"></div>
      <div class="span-5"><label>说明</label><input id="${prefix}Description" value="${escapeHtml(group?.description || "")}"></div>
      <div class="span-5 form-error" id="${prefix}GroupFormError"></div>
      <div class="span-5 row-actions">
        <button class="primary" id="${prefix}SaveGroup">${submitLabel}</button>
        ${showDelete ? `<button class="danger" id="${prefix}DeleteGroup">删除题组</button>` : ""}
      </div>
    </div>
  `;
}

function nextGroupOrder() {
  const maxOrder = Math.max(0, ...(state.questionTree?.groups || []).map((item) => Number(item.sort_order || 0)));
  return maxOrder + 10;
}

function attachGroupForm(prefix, onSave) {
  $(`#${prefix}SaveGroup`).onclick = onSave;
}

function readGroupPayload(prefix, group) {
  const title = $(`#${prefix}Title`).value.trim();
  return {
    category_id: state.activeCategoryId,
    key: title,
    title,
    description: $(`#${prefix}Description`).value.trim(),
    status: $(`#${prefix}Status`).value,
    random_pick_count: Number($(`#${prefix}Random`).value || 0),
    sort_order: Number(group?.sort_order ?? nextGroupOrder()),
  };
}

async function saveGroup(prefix, group) {
  const payload = readGroupPayload(prefix, group);
  if (!payload.title) {
    $(`#${prefix}GroupFormError`).textContent = "题组标题不能为空";
    return;
  }
  const saved = group
    ? await api(`/admin/question-groups/${group.id}`, { method: "PATCH", body: JSON.stringify({ ...group, ...payload }) })
    : await api("/admin/question-groups", { method: "POST", body: JSON.stringify(payload) });
  state.activeGroupId = saved.id;
  state.activeQuestionId = 0;
  closeModal();
  await loadQuestionTree();
  paintQuestionWorkbench();
  setStatus("题组已保存");
}

async function reorderGroups(groupIds) {
  const groups = state.questionTree?.groups || [];
  const byId = new Map(groups.map((group) => [Number(group.id), group]));
  const reordered = groupIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== groups.length) {
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus("题组排序失败，请重试", true);
    return;
  }
  const updated = reordered.map((group, index) => ({ ...group, sort_order: sortOrderForIndex(index) }));
  state.questionTree.groups = updated;
  setStatus("正在保存题组排序...");
  try {
    await Promise.all(updated.map((group) => (
      api(`/admin/question-groups/${group.id}`, { method: "PATCH", body: JSON.stringify(group) })
    )));
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus("题组排序已保存");
  } catch (error) {
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus(error.message, true);
  }
}

function openGroupModal() {
  const category = currentCategory();
  if (!category) {
    setStatus("请先选择类别", true);
    return;
  }
  closeModal();
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "modalRoot";
  modal.innerHTML = `
    <section class="modal-panel modal-panel-narrow">
      <div class="modal-header">
        <div>
          <h3 class="panel-title">新建题组</h3>
          <p class="panel-subtitle">${escapeHtml(category.label || category.name)} · ${escapeHtml(category.key)}</p>
        </div>
        <button type="button" id="closeModal">关闭</button>
      </div>
      <div class="modal-body">
        ${renderGroupFields("newGroup", {}, "创建题组")}
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  $("#closeModal").onclick = closeModal;
  modal.onclick = (event) => {
    if (event.target === modal) closeModal();
  };
  attachGroupForm("newGroup", () => saveGroup("newGroup", null));
}

async function deleteGroup(group) {
  if (!group) return;
  const count = group.questions?.length || 0;
  if (!confirm(`确定删除题组「${group.title}」吗？${count ? `该组内 ${count} 道题也会一起删除。` : ""}`)) return;
  await api(`/admin/question-groups/${group.id}`, { method: "DELETE" });
  state.activeGroupId = 0;
  state.activeQuestionId = 0;
  await loadQuestionTree();
  paintQuestionWorkbench();
  setStatus("题组已删除");
}

function paintQuestionList() {
  const group = currentGroup();
  if (!group) {
    $("#questionList").innerHTML = "<div class='empty'>选择或新建一个题组后管理题目</div>";
    return;
  }
  const questions = group.questions || [];
  if (!questions.length) {
    $("#questionList").innerHTML = "<div class='empty'>暂无题目</div>";
    return;
  }
  $("#questionList").innerHTML = `
    <div class="question-card-list">
      ${questions.map((question, index) => {
        const rules = [
          question.random_must_include ? "必出" : "",
          question.skippable ? "可跳过" : "",
          question.max_length ? `${question.max_length}字` : "",
        ].filter(Boolean);
        return `
          <button class="question-card ${question.id === state.activeQuestionId ? "active" : ""}" data-q="${question.id}" draggable="true">
            <span class="question-order">${index + 1}</span>
            <span class="question-main">
              <strong>${escapeHtml(question.title)}</strong>
            </span>
            <span class="question-meta">
              ${statusLabel(question.status)}
              <span class="pill">${escapeHtml(questionModeLabel(question))}</span>
              ${rules.map((rule) => `<span class="pill">${escapeHtml(rule)}</span>`).join("")}
            </span>
          </button>
        `;
      }).join("")}
    </div>
  `;
  $("#questionList").querySelectorAll(".question-card[data-q]").forEach((button) => {
    button.onclick = () => {
      if (Date.now() < state.sortClickSuppressUntil) return;
      state.activeQuestionId = Number(button.dataset.q);
      paintQuestionList();
      paintQuestionForm();
    };
  });
  attachDragSort($("#questionList").querySelector(".question-card-list"), ".question-card[data-q]", "q", reorderQuestions);
}

function paintQuestionForm() {
  const group = currentGroup();
  const question = currentQuestion();
  $("#questionFormTitle").textContent = question ? "编辑题目" : "题目详情";
  $("#questionFormMeta").textContent = group ? `${group.title} · ${group.questions?.length || 0} 题` : "";
  if (!group) {
    $("#questionForm").innerHTML = "<div class='empty'>先选择一个题组</div>";
    return;
  }
  if (!question) {
    $("#questionForm").innerHTML = "<div class='empty'>从题目列表选择一题进行编辑</div>";
    return;
  }
  $("#questionForm").innerHTML = renderQuestionFields("edit", question, group, "保存题目");
  attachQuestionForm("edit", () => saveQuestion("edit", question));
  $("#editDeleteQuestion").onclick = () => deleteQuestion(question);
}

function nextQuestionOrder(group) {
  const maxOrder = Math.max(0, ...(group.questions || []).map((item) => Number(item.sort_order || 0)));
  return maxOrder + 10;
}

function renderQuestionFields(prefix, question, group, submitLabel) {
  const mode = questionModeValue(question);
  const requirement = questionRequirementValue(question);
  return `
    <div class="form-grid question-form-grid">
      <div class="span-2"><label>题目文案</label><textarea class="title-textarea" id="${prefix}QTitle" rows="3">${escapeHtml(question?.title || "")}</textarea></div>
      <div><label>题型</label><select id="${prefix}QMode">
        <option value="subjective" ${selected(mode, "subjective")}>主观</option>
        <option value="single" ${selected(mode, "single")}>单选</option>
        <option value="multiple" ${selected(mode, "multiple")}>多选</option>
      </select></div>
      <div><label>状态</label><select id="${prefix}QStatus">
        <option value="enabled" ${selected(question?.status || "enabled", "enabled")}>启用</option>
        <option value="draft" ${selected(question?.status, "draft")}>草稿</option>
        <option value="disabled" ${selected(question?.status, "disabled")}>禁用</option>
      </select></div>
      <div><label>字数限制</label><input id="${prefix}QMax" type="number" min="0" value="${Number(question?.max_length || 0)}"></div>
      <div class="radio-row span-2">
        <label><input name="${prefix}Requirement" type="radio" value="required" ${checked(requirement === "required")}> 必答</label>
        <label><input name="${prefix}Requirement" type="radio" value="skippable" ${checked(requirement === "skippable")}> 可跳过</label>
      </div>
      <div class="toggle-row span-2">
        <label><input id="${prefix}QMust" type="checkbox" ${checked(question?.random_must_include)}> 随机必出</label>
        <label id="${prefix}QAllowOtherWrap"><input id="${prefix}QAllowOther" type="checkbox" ${checked(question?.allow_other)}> 允许填写其他</label>
      </div>
      <div class="span-2"><label>提示说明</label><input id="${prefix}QHelper" value="${escapeHtml(question?.helper_text || "")}"></div>
      <div class="span-2"><label>内部说明</label><input id="${prefix}QDescription" value="${escapeHtml(question?.description || "")}"></div>
      <div class="span-2 option-editor" id="${prefix}OptionBlock">
        <label>选项</label>
        <div class="option-list" id="${prefix}OptionList">
          ${renderOptionRows(question?.options?.items || [])}
        </div>
        <button type="button" id="${prefix}AddOption">添加选项</button>
      </div>
      <div class="span-2 form-error" id="${prefix}QuestionFormError"></div>
      <div class="span-2 row-actions">
        <button class="primary" id="${prefix}SaveQuestion">${submitLabel}</button>
        ${question?.id ? `<button class="danger" id="${prefix}DeleteQuestion">删除题目</button>` : ""}
      </div>
    </div>
  `;
}

function renderOptionRows(items) {
  const rows = Array.isArray(items) ? items : [];
  return rows.map((item) => optionRowHTML(item.label || item.value)).join("");
}

function optionRowHTML(label = "") {
  return `
    <div class="option-row">
      <input data-option-label placeholder="选项名" value="${escapeHtml(label)}">
      <button type="button" class="danger" data-remove-option>删除</button>
    </div>
  `;
}

function attachQuestionForm(prefix, onSave) {
  const modeInput = $(`#${prefix}QMode`);
  const optionList = $(`#${prefix}OptionList`);
  const addButton = $(`#${prefix}AddOption`);
  const saveButton = $(`#${prefix}SaveQuestion`);
  modeInput.onchange = () => toggleOptionEditor(prefix);
  addButton.onclick = () => {
    optionList.insertAdjacentHTML("beforeend", optionRowHTML());
  };
  optionList.onclick = (event) => {
    const removeButton = event.target.closest("[data-remove-option]");
    if (removeButton) removeButton.closest(".option-row")?.remove();
  };
  saveButton.onclick = onSave;
  toggleOptionEditor(prefix);
}

function toggleOptionEditor(prefix) {
  const isChoice = $(`#${prefix}QMode`).value !== "subjective";
  $(`#${prefix}OptionBlock`).hidden = !isChoice;
  $(`#${prefix}QAllowOtherWrap`).hidden = !isChoice;
}

function readQuestionPayload(prefix, group, question) {
  const mode = $(`#${prefix}QMode`).value;
  const requirement = document.querySelector(`input[name="${prefix}Requirement"]:checked`)?.value || "required";
  const optionRows = [...document.querySelectorAll(`#${prefix}OptionList .option-row`)];
  const title = $(`#${prefix}QTitle`).value.trim();
  const options = mode === "subjective"
    ? {}
    : {
        items: optionRows.map((row) => ({
          label: row.querySelector("[data-option-label]").value.trim(),
          value: row.querySelector("[data-option-label]").value.trim(),
        })).filter((item) => item.label),
      };
  return {
    category_id: state.activeCategoryId,
    group_id: group.id,
    key: title,
    title,
    answer_mode: mode === "subjective" ? "subjective" : "choice",
    choice_mode: mode === "single" ? "single" : mode === "multiple" ? "multiple" : "",
    type: questionTypeForMode(mode),
    status: $(`#${prefix}QStatus`).value,
    required: requirement === "required",
    skippable: requirement === "skippable",
    max_length: Number($(`#${prefix}QMax`).value || 0),
    helper_text: $(`#${prefix}QHelper`).value.trim(),
    description: $(`#${prefix}QDescription`).value.trim(),
    random_must_include: $(`#${prefix}QMust`).checked,
    options,
    allow_other: mode !== "subjective" && $(`#${prefix}QAllowOther`).checked,
    sort_order: Number(question?.sort_order ?? nextQuestionOrder(group)),
  };
}

async function saveQuestion(prefix, question) {
  const group = currentGroup();
  if (!group) return;
  const payload = readQuestionPayload(prefix, group, question);
  if (!payload.title) {
    $(`#${prefix}QuestionFormError`).textContent = "题目文案不能为空";
    return;
  }
  if (payload.answer_mode === "choice" && !payload.options.items.length) {
    $(`#${prefix}QuestionFormError`).textContent = "选择题至少需要一个选项";
    return;
  }
  const saved = question
    ? await api(`/admin/questions/${question.id}`, { method: "PATCH", body: JSON.stringify({ ...question, ...payload }) })
    : await api("/admin/questions", { method: "POST", body: JSON.stringify(payload) });
  state.activeQuestionId = saved.id;
  closeModal();
  await loadQuestionTree();
  paintQuestionWorkbench();
  setStatus("题目已保存");
}

async function reorderQuestions(questionIds) {
  const group = currentGroup();
  if (!group) return;
  const byId = new Map((group.questions || []).map((question) => [Number(question.id), question]));
  const reordered = questionIds.map((id) => byId.get(id)).filter(Boolean);
  if (reordered.length !== (group.questions || []).length) {
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus("题目排序失败，请重试", true);
    return;
  }
  const updated = reordered.map((question, index) => ({ ...question, sort_order: sortOrderForIndex(index) }));
  group.questions = updated;
  setStatus("正在保存题目排序...");
  try {
    await Promise.all(updated.map((question) => (
      api(`/admin/questions/${question.id}`, { method: "PATCH", body: JSON.stringify(question) })
    )));
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus("题目排序已保存");
  } catch (error) {
    await loadQuestionTree();
    paintQuestionWorkbench();
    setStatus(error.message, true);
  }
}

async function deleteQuestion(question) {
  if (!question) return;
  if (!confirm(`确定删除题目「${question.title}」吗？`)) return;
  await api(`/admin/questions/${question.id}`, { method: "DELETE" });
  state.activeQuestionId = 0;
  await loadQuestionTree();
  paintQuestionWorkbench();
  setStatus("题目已删除");
}

function openQuestionModal() {
  const group = currentGroup();
  if (!group) {
    setStatus("请先选择一个题组", true);
    return;
  }
  closeModal();
  const modal = document.createElement("div");
  modal.className = "modal-backdrop";
  modal.id = "modalRoot";
  modal.innerHTML = `
    <section class="modal-panel">
      <div class="modal-header">
        <div>
          <h3 class="panel-title">新建题目</h3>
          <p class="panel-subtitle">${escapeHtml(group.title)} · ${escapeHtml(currentCategory()?.label || "")}</p>
        </div>
        <button type="button" id="closeModal">关闭</button>
      </div>
      <div class="modal-body">
        ${renderQuestionFields("new", {}, group, "创建题目")}
      </div>
    </section>
  `;
  document.body.appendChild(modal);
  $("#closeModal").onclick = closeModal;
  modal.onclick = (event) => {
    if (event.target === modal) closeModal();
  };
  attachQuestionForm("new", () => saveQuestion("new", null));
}

function closeModal() {
  $("#modalRoot")?.remove();
}

async function renderSkills() {
  state.skills = sortSkills(await api("/admin/skills"));
  if (!state.activeSkill || !state.skills.some((skill) => skill.key === state.activeSkill)) {
    state.activeSkill = state.skills[0]?.key || "";
  }
  $("#view").innerHTML = `
    <div class="split stable-split skill-split">
      <section class="panel skill-editor-panel">
        <div class="panel-header"><h3 class="panel-title">Skills</h3></div>
        <div class="panel-body stack skill-list" id="skillList"></div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title" id="skillEditorTitle">文件编辑</h3>
            <p class="panel-subtitle" id="skillEditorMeta"></p>
          </div>
          <div class="row-actions"><button id="validateSkill">校验</button><button class="primary" id="publishSkill">发布</button></div>
        </div>
        <div class="panel-body stack skill-editor-body" id="skillEditor"></div>
      </section>
    </div>
  `;
  paintSkillList();
  $("#validateSkill").onclick = async () => {
    await api(`/admin/skills/${state.activeSkill}/validate`, { method: "POST" });
    setStatus("Skill 校验通过");
  };
  $("#publishSkill").onclick = async () => {
    await api(`/admin/skills/${state.activeSkill}/publish`, { method: "POST" });
    setStatus("Skill 已发布");
  };
  await renderSkillEditor();
}

function paintSkillList() {
  $("#skillList").innerHTML = state.skills.map((skill) => `
    <button class="skill-card ${skill.key === state.activeSkill ? "active" : ""}" data-skill="${skill.key}">
      <strong>${escapeHtml(skill.label || skill.name || skill.key)}</strong>
      <span>${escapeHtml(skill.key)}</span>
    </button>
  `).join("");
  $("#skillList").querySelectorAll("button[data-skill]").forEach((button) => {
    button.onclick = async () => {
      if (state.activeSkill === button.dataset.skill) return;
      state.activeSkill = button.dataset.skill;
      paintSkillList();
      await renderSkillEditor();
    };
  });
}

async function renderSkillEditor() {
  const skill = state.skills.find((item) => item.key === state.activeSkill);
  const files = sortSkillFiles(skill?.files?.length ? skill.files : skillFileOrder.map((name) => ({ name })));
  if (!files.some((file) => file.name === state.activeSkillFile)) {
    state.activeSkillFile = files[0]?.name || "prompt.md";
  }
  const data = await api(`/admin/skills/${state.activeSkill}/files/${state.activeSkillFile}`);
  $("#skillEditorTitle").textContent = skill?.label || state.activeSkill;
  $("#skillEditorMeta").textContent = `${state.activeSkill} / ${state.activeSkillFile}`;
  $("#skillEditor").innerHTML = `
    <div class="tabs">${files.map((file) => `<button class="${file.name === state.activeSkillFile ? "active" : ""}" data-file="${file.name}">${file.name}</button>`).join("")}</div>
    <textarea class="skill-editor-textarea" id="skillContent" rows="34" spellcheck="false">${escapeHtml(data.content)}</textarea>
    <div><button class="primary" id="saveSkillFile">保存草稿</button></div>
  `;
  $("#skillEditor").querySelectorAll("button[data-file]").forEach((button) => {
    button.onclick = () => {
      state.activeSkillFile = button.dataset.file;
      renderSkillEditor();
    };
  });
  $("#saveSkillFile").onclick = async () => {
    await api(`/admin/skills/${state.activeSkill}/files/${state.activeSkillFile}`, {
      method: "PATCH",
      body: JSON.stringify({ content: $("#skillContent").value }),
    });
    setStatus("Skill 文件已保存");
  };
}

async function renderKnowledge() {
  const data = await api("/admin/knowledge-sources");
  state.knowledgeSources = data.items || [];
  if (!state.activeKnowledgeId && state.knowledgeSources[0]) state.activeKnowledgeId = state.knowledgeSources[0].id;
  $("#view").innerHTML = `
    <div class="split">
      <section class="panel"><div class="panel-header"><h3 class="panel-title">知识源</h3></div><div class="panel-body stack" id="knowledgeList"></div></section>
      <section class="panel"><div class="panel-header"><h3 class="panel-title">Markdown 编辑</h3><div class="row-actions"><button id="versionsKnowledge">版本</button><button class="primary" id="publishKnowledge">发布并索引</button></div></div><div class="panel-body stack" id="knowledgeEditor"></div></section>
    </div>
  `;
  $("#knowledgeList").innerHTML = state.knowledgeSources.map((source) => `<button class="${source.id === state.activeKnowledgeId ? "primary" : ""}" data-source="${source.id}">${escapeHtml(source.title)}</button>`).join("");
  $("#knowledgeList").querySelectorAll("button[data-source]").forEach((button) => {
    button.onclick = () => {
      state.activeKnowledgeId = Number(button.dataset.source);
      renderKnowledge();
    };
  });
  $("#publishKnowledge").onclick = async () => {
    await saveKnowledge();
    await api(`/admin/knowledge-sources/${state.activeKnowledgeId}/publish`, { method: "POST" });
    setStatus("知识库已发布并触发索引");
  };
  $("#versionsKnowledge").onclick = async () => {
    const versions = await api(`/admin/knowledge-sources/${state.activeKnowledgeId}/versions`);
    $("#knowledgeVersions").textContent = JSON.stringify(versions, null, 2);
  };
  await renderKnowledgeEditor();
}

async function renderKnowledgeEditor() {
  const source = await api(`/admin/knowledge-sources/${state.activeKnowledgeId}`);
  $("#knowledgeEditor").innerHTML = `
    <label>标题</label><input id="knowledgeTitle" value="${escapeHtml(source.title)}">
    <label>内容</label><textarea id="knowledgeContent" rows="24" spellcheck="false">${escapeHtml(source.draft_content || source.published_content || "")}</textarea>
    <div><button class="primary" id="saveKnowledge">保存草稿</button></div>
    <pre class="json-preview" id="knowledgeVersions">版本记录会显示在这里</pre>
  `;
  $("#saveKnowledge").onclick = saveKnowledge;
}

async function saveKnowledge() {
  await api(`/admin/knowledge-sources/${state.activeKnowledgeId}`, {
    method: "PATCH",
    body: JSON.stringify({ title: $("#knowledgeTitle").value.trim(), content: $("#knowledgeContent").value }),
  });
  setStatus("知识库草稿已保存");
}

function table(headers, rows) {
  if (!rows.length) return "<div class='empty'>暂无数据</div>";
  return `<table><thead><tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell ?? ""}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

function statusLabel(value) {
  const map = {
    1: "可用",
    2: "已用",
    3: "禁用",
    enabled: "启用",
    disabled: "禁用",
    draft: "草稿",
    published: "已发布",
  };
  return `<span class="pill">${escapeHtml(map[value] || value || "-")}</span>`;
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

initAdminLogin();
