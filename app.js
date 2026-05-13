const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const storageKey = "squidhost-local-state-v1";
const agentBase = "http://127.0.0.1:58432";
const logTimers = new Map();
let state = loadState();
let selectedId = state.selectedId || state.servers[0]?.id || null;
let wizardStep = 0;
let agentOnline = false;

const versions = {
  "1.21.5": { java: 21, geyser: false },
  "1.21.4": { java: 21, geyser: true },
  "1.20.6": { java: 21, geyser: true },
  "1.20.4": { java: 17, geyser: true },
  "1.19.4": { java: 17, geyser: false }
};

const packs = [
  { name: "Crossplay SMP", loader: "Paper", version: "1.21.4", memory: 4, tags: "Geyser, Floodgate, voice friendly" },
  { name: "Performance Paper", loader: "Paper", version: "1.21.5", memory: 3, tags: "Plugins, low memory, stable ticks" },
  { name: "Fabric Friends", loader: "Fabric", version: "1.20.4", memory: 6, tags: "Fabric API, Simple Voice Chat" },
  { name: "Forge Kitchen Sink", loader: "Forge", version: "1.20.1", memory: 8, tags: "Large modpack baseline" },
  { name: "Creative Flatland", loader: "Vanilla", version: "1.21.5", memory: 2, tags: "Builders, flat world, commands" },
  { name: "Legacy Survival", loader: "Vanilla", version: "1.19.4", memory: 3, tags: "Older clients, Java 17" }
];

const issues = [
  {
    title: "Connection timed out",
    fix: "Use the generated public link first. If friends still cannot join, restart the tunnel, check firewall prompts, and keep the server window open."
  },
  {
    title: "Connection reset",
    fix: "Match client and server versions, confirm the loader is correct, and remove newly added mods until the console starts cleanly."
  },
  {
    title: "Incompatible Java version",
    fix: "Minecraft 1.20.5 and newer should use Java 21. Versions 1.17 through 1.20.4 typically use Java 17."
  },
  {
    title: "Modded server failed to launch",
    fix: "Use the server pack, not the client pack. Check dependencies, loader type, and the first red console line after libraries load."
  },
  {
    title: "Bedrock players cannot join",
    fix: "Use Paper, choose a Geyser-compatible version, enable Geyser, keep Floodgate enabled for players without Java accounts, then share the Bedrock address."
  }
];

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey));
    if (parsed && Array.isArray(parsed.servers)) return parsed;
  } catch (error) {
    console.warn(error);
  }
  return {
    selectedId: null,
    theme: "light",
    agentToken: "",
    files: [],
    servers: [
      makeServer({
        name: "Weekend Realm",
        loader: "Paper",
        version: "1.21.4",
        java: "21",
        memory: "4",
        world: "New world",
        folder: "~/SquidHost/Servers/Weekend-Realm",
        onlineMode: "Premium accounts only",
        geyser: true,
        floodgate: true,
        pack: false
      })
    ]
  };
}

function saveState() {
  state.selectedId = selectedId;
  state.agentToken = $("#agentToken")?.value || state.agentToken || "";
  localStorage.setItem(storageKey, JSON.stringify(state));
}

function makeServer(data) {
  const slug = (data.name || "server").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  return {
    id,
    name: data.name || "New Server",
    loader: data.loader || "Vanilla",
    version: data.version || "1.21.5",
    java: data.java || "21",
    memory: data.memory || "4",
    world: data.world || "New world",
    folder: data.folder || `~/SquidHost/Servers/${slug}`,
    onlineMode: data.onlineMode || "Premium accounts only",
    geyser: Boolean(data.geyser),
    floodgate: Boolean(data.floodgate),
    pack: Boolean(data.pack),
    status: "offline",
    players: 0,
    port: Math.floor(25565 + Math.random() * 240),
    bedrockPort: Math.floor(19132 + Math.random() * 200),
    publicHost: `${slug || "server"}.join.squidhost.local`,
    logs: [
      stamp("Profile created"),
      stamp(`Selected ${data.loader || "Vanilla"} ${data.version || "1.21.5"} with ${data.memory || "4"} GB RAM`)
    ],
    createdAt: Date.now()
  };
}

function stamp(message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `[${time}] ${message}`;
}

function init() {
  document.documentElement.dataset.theme = state.theme || "light";
  $("#agentToken").value = state.agentToken || "";
  bindNavigation();
  bindWizard();
  bindControls();
  renderAll();
  checkAgent();
  setInterval(checkAgent, 3500);
}

function bindNavigation() {
  $$(".nav-item").forEach((button) => {
    button.addEventListener("click", () => switchView(button.dataset.view));
  });
  $("#newServerButton").addEventListener("click", () => switchView("create"));
}

function switchView(view) {
  const titles = { dashboard: "Dashboard", create: "Create Server", mods: "Mods & Packs", help: "Help" };
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  $$(".view").forEach((panel) => panel.classList.remove("active"));
  $(`#${view}View`).classList.add("active");
  $("#viewTitle").textContent = titles[view];
  if (view === "create") updateWizard();
}

function bindWizard() {
  $("#memoryRange").addEventListener("input", updateAdvice);
  $("#mcVersion").addEventListener("change", updateAdvice);
  $("#javaVersion").addEventListener("change", updateAdvice);
  $("#serverForm").addEventListener("input", (event) => {
    if (event.target.name === "loader") {
      $$(".choice-card").forEach((card) => card.classList.toggle("selected", card.contains(event.target)));
    }
    updateAdvice();
  });
  $$(".step").forEach((button) => {
    button.addEventListener("click", () => {
      wizardStep = Number(button.dataset.step);
      updateWizard();
    });
  });
  $("#backStepButton").addEventListener("click", () => {
    wizardStep = Math.max(0, wizardStep - 1);
    updateWizard();
  });
  $("#nextStepButton").addEventListener("click", () => {
    wizardStep = Math.min(3, wizardStep + 1);
    updateWizard();
  });
  $("#serverForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formData();
    if (agentOnline) {
      try {
        const created = await agentFetch("/servers/create", { method: "POST", body: JSON.stringify(data) });
        const server = normalizeAgentServer(created.server);
        upsertServer(server);
        selectedId = server.id;
        saveState();
        renderAll();
        switchView("dashboard");
        await startServer(server.id);
        showToast(`${server.name} created on local agent`);
        return;
      } catch (error) {
        showToast(error.message);
      }
    }
    const server = makeServer(data);
    state.servers.unshift(server);
    selectedId = server.id;
    saveState();
    renderAll();
    switchView("dashboard");
    startServer(server.id);
    showToast(`${server.name} created in preview mode`);
  });
}

function bindControls() {
  $("#themeToggle").addEventListener("click", () => {
    state.theme = state.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = state.theme;
    saveState();
  });
  $("#seedDemoButton").addEventListener("click", () => {
    const pack = packs[Math.floor(Math.random() * packs.length)];
    const server = makeServer({
      name: pack.name,
      loader: pack.loader,
      version: pack.version,
      java: versions[pack.version]?.java || 21,
      memory: pack.memory,
      world: "New world",
      folder: `~/SquidHost/Servers/${pack.name.replace(/\s+/g, "-")}`,
      onlineMode: "Premium accounts only",
      geyser: pack.name.includes("Crossplay"),
      floodgate: pack.name.includes("Crossplay")
    });
    state.servers.unshift(server);
    selectedId = server.id;
    saveState();
    renderAll();
    showToast("Example server added");
  });
  $("#clearLogsButton").addEventListener("click", () => {
    const server = getSelectedServer();
    if (!server) return;
    server.logs = [stamp("Console cleared")];
    saveState();
    renderConsole();
  });
  $("#modFileInput").addEventListener("change", (event) => {
    const names = Array.from(event.target.files).map((file) => file.name);
    state.files.push(...names);
    const server = getSelectedServer();
    if (server) {
      server.logs.push(stamp(`Queued ${names.length} file(s) for the mods folder`));
    }
    saveState();
    renderFiles();
    renderConsole();
    showToast("Files recorded locally");
  });
  $("#connectAgentButton").addEventListener("click", async () => {
    saveState();
    await checkAgent(true);
  });
}

function formData() {
  const data = new FormData($("#serverForm"));
  return {
    loader: data.get("loader"),
    version: data.get("version"),
    java: data.get("java"),
    memory: data.get("memory"),
    name: data.get("name"),
    world: data.get("world"),
    folder: data.get("folder"),
    onlineMode: data.get("onlineMode"),
    geyser: $("#geyserToggle").checked && data.get("loader") === "Paper",
    floodgate: $("#floodgateToggle").checked,
    pack: $("#packToggle").checked
  };
}

function updateWizard() {
  $$(".step").forEach((step) => step.classList.toggle("active", Number(step.dataset.step) === wizardStep));
  $$(".wizard-step").forEach((panel) => panel.classList.toggle("active", Number(panel.dataset.stepPanel) === wizardStep));
  $("#backStepButton").disabled = wizardStep === 0;
  $("#nextStepButton").classList.toggle("hidden", wizardStep === 3);
  $("#createSubmitButton").classList.toggle("hidden", wizardStep !== 3);
  updateAdvice();
  updateReview();
}

function updateAdvice() {
  const data = formData();
  const requiredJava = versions[data.version]?.java || (data.version >= "1.20.5" ? 21 : 17);
  const compatible = Number(data.java) >= requiredJava;
  const geyserCapable = data.loader === "Paper" && Boolean(versions[data.version]?.geyser);
  $("#memoryValue").textContent = `${data.memory} GB`;
  $("#geyserBox").hidden = data.loader !== "Paper";
  if (!geyserCapable) $("#geyserToggle").checked = false;

  const advice = [
    compatible
      ? `Java ${data.java} is compatible with Minecraft ${data.version}.`
      : `Minecraft ${data.version} needs Java ${requiredJava}; switch runtime before launch.`,
    Number(data.memory) < 4 && data.loader !== "Vanilla"
      ? "Modded and plugin servers usually feel better with at least 4 GB RAM."
      : `${data.memory} GB is a reasonable allocation for this profile.`,
    data.loader === "Paper"
      ? geyserCapable
        ? "This Paper version can expose both Java and Bedrock join addresses."
        : "Choose a Geyser-compatible Paper version for Bedrock support."
      : "Use Paper when you need Bedrock crossplay through GeyserMC.",
    data.onlineMode === "Allow non-premium users"
      ? "Non-premium mode changes account verification. Only use it for groups you trust."
      : "Premium mode keeps Mojang account verification enabled."
  ];

  $("#setupAdvice").innerHTML = advice.map((item) => `<div class="advice-item">${item}</div>`).join("");
}

function updateReview() {
  const data = formData();
  $("#reviewCard").innerHTML = `
    <div class="server-meta">
      <span class="pill">${data.loader}</span>
      <span class="pill">Minecraft ${data.version}</span>
      <span class="pill">Java ${data.java}</span>
      <span class="pill">${data.memory} GB RAM</span>
      ${data.geyser ? '<span class="pill">Geyser enabled</span>' : ""}
    </div>
    <p><strong>${escapeHtml(data.name)}</strong> will be saved to <strong>${escapeHtml(data.folder)}</strong>.</p>
    <p>${escapeHtml(data.world)} · ${escapeHtml(data.onlineMode)}</p>
  `;
}

function renderAll() {
  renderMetrics();
  renderServers();
  renderConsole();
  renderPacks();
  renderFiles();
  renderIssues();
  renderDiagnostics();
}

function renderMetrics() {
  const online = state.servers.filter((server) => server.status === "online");
  $("#serverCount").textContent = state.servers.length;
  $("#onlineCount").textContent = online.length;
  $("#playerCount").textContent = online.reduce((sum, server) => sum + (server.players || 0), 0);
  $("#linkCount").textContent = state.servers.filter((server) => server.publicHost).length;
}

function renderServers() {
  if (!state.servers.length) {
    $("#serverList").innerHTML = `<div class="server-card"><h3>No servers yet</h3><p class="server-meta">Create a Vanilla, Paper, Fabric, or Forge server to begin.</p></div>`;
    return;
  }
  $("#serverList").innerHTML = state.servers.map((server) => `
    <article class="server-card ${server.id === selectedId ? "selected" : ""}" data-server-id="${server.id}">
      <div class="server-card-header">
        <div>
          <h3>${escapeHtml(server.name)}</h3>
          <div class="server-meta">
            <span class="pill">${server.loader}</span>
            <span class="pill">${server.version}</span>
            <span class="pill">${server.memory} GB</span>
            ${server.geyser ? '<span class="pill">Bedrock</span>' : ""}
          </div>
        </div>
        <span class="status-dot ${server.status === "online" ? "online" : ""}"></span>
      </div>
      <div class="join-links">
        <span class="pill">Java: ${server.publicHost || "localhost"}:${server.port}</span>
        ${server.geyser ? `<span class="pill">Bedrock: ${server.publicHost}:${server.bedrockPort}</span>` : ""}
      </div>
      <div class="server-actions">
        <button class="small-button" data-action="select">Select</button>
        <button class="small-button" data-action="${server.status === "online" || server.status === "starting" ? "stop" : "start"}">${server.status === "online" || server.status === "starting" ? "Stop" : "Launch"}</button>
        <button class="small-button" data-action="copy">Copy Link</button>
        <button class="small-button danger" data-action="delete">Delete</button>
      </div>
    </article>
  `).join("");

  $$(".server-card").forEach((card) => {
    card.addEventListener("click", (event) => {
      const action = event.target.dataset.action || "select";
      const id = card.dataset.serverId;
      if (action === "start") startServer(id);
      if (action === "stop") stopServer(id);
      if (action === "copy") copyLink(id);
      if (action === "delete") deleteServer(id);
      if (action === "select") selectServer(id);
    });
  });
}

function renderConsole() {
  const server = getSelectedServer();
  $("#consoleTitle").textContent = server ? server.name : "No server selected";
  $("#consoleOutput").innerHTML = server
    ? server.logs.slice(-80).map((line) => `<p>${escapeHtml(line)}</p>`).join("")
    : `<p>${stamp("Create or select a server to see launch logs.")}</p>`;
  $("#consoleOutput").scrollTop = $("#consoleOutput").scrollHeight;
}

function renderPacks() {
  $("#packGrid").innerHTML = packs.map((pack, index) => `
    <article class="pack-card">
      <strong>${pack.name}</strong>
      <span>${pack.loader} ${pack.version} · ${pack.memory} GB</span>
      <span>${pack.tags}</span>
      <button class="small-button" data-pack-index="${index}">Use template</button>
    </article>
  `).join("");
  $$("[data-pack-index]").forEach((button) => {
    button.addEventListener("click", () => applyPack(packs[Number(button.dataset.packIndex)]));
  });
}

function renderFiles() {
  $("#fileList").innerHTML = state.files.length
    ? state.files.map((file) => `<li class="pill">${escapeHtml(file)}</li>`).join("")
    : `<li class="pill">No files added yet</li>`;
}

function renderIssues() {
  $("#issueList").innerHTML = issues.map((issue) => `
    <article class="issue-card">
      <h3>${issue.title}</h3>
      <p>${issue.fix}</p>
    </article>
  `).join("");
}

function renderDiagnostics() {
  const server = getSelectedServer();
  const checks = [
    { title: "Java runtime", text: server ? `Selected Java ${server.java}; required Java ${versions[server.version]?.java || 17}.` : "No server selected." },
    { title: "Tunnel", text: server ? `${server.publicHost} is reserved for invite links in this local demo.` : "Create a server to reserve a join link." },
    { title: "World folder", text: server ? server.folder : "No world folder selected." },
    { title: "Crossplay", text: server?.geyser ? "Geyser and Bedrock address enabled." : "Crossplay is off. Use Paper and enable Geyser for Bedrock." }
  ];
  $("#diagnostics").innerHTML = checks.map((check) => `
    <article class="diagnostic-card">
      <h3>${check.title}</h3>
      <p>${escapeHtml(check.text)}</p>
    </article>
  `).join("");
}

function applyPack(pack) {
  switchView("create");
  $("#serverName").value = pack.name;
  $(`[name="loader"][value="${pack.loader}"]`).checked = true;
  $$(".choice-card").forEach((card) => card.classList.toggle("selected", card.querySelector("input").checked));
  $("#mcVersion").value = versions[pack.version] ? pack.version : "1.20.4";
  $("#javaVersion").value = String(versions[$("#mcVersion").value]?.java || 21);
  $("#memoryRange").value = pack.memory;
  $("#geyserToggle").checked = pack.name.includes("Crossplay");
  $("#floodgateToggle").checked = pack.name.includes("Crossplay");
  wizardStep = 0;
  updateWizard();
  showToast(`${pack.name} template loaded`);
}

function selectServer(id) {
  selectedId = id;
  saveState();
  renderAll();
}

async function startServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  if (server.agent && agentOnline) {
    try {
      const result = await agentFetch(`/servers/${id}/start`, { method: "POST" });
      upsertServer(normalizeAgentServer(result.server));
      selectedId = id;
      saveState();
      renderAll();
      showToast(`${server.name} is starting for real`);
      return;
    } catch (error) {
      showToast(error.message);
    }
  }
  selectedId = id;
  server.status = "starting";
  server.logs.push(stamp(`Launching ${server.loader} ${server.version}`));
  server.logs.push(stamp(`Using Java ${server.java} with -Xmx${server.memory}G`));
  server.logs.push(stamp(`Preparing world: ${server.world}`));
  saveState();
  renderAll();

  clearInterval(logTimers.get(id));
  const bootLines = [
    "Downloading server libraries",
    server.loader === "Paper" ? "Applying Paper patches" : "Validating server jar",
    server.geyser ? "Installing GeyserMC and Floodgate" : "Skipping Bedrock bridge",
    "Starting Minecraft server on 0.0.0.0",
    "Done. Server is online"
  ];
  let index = 0;
  const timer = setInterval(() => {
    const current = state.servers.find((item) => item.id === id);
    if (!current || current.status === "offline") {
      clearInterval(timer);
      return;
    }
    current.logs.push(stamp(bootLines[index]));
    if (index === bootLines.length - 1) {
      current.status = "online";
      current.players = Math.floor(Math.random() * 4);
      current.logs.push(stamp(`Java join: ${current.publicHost}:${current.port}`));
      if (current.geyser) current.logs.push(stamp(`Bedrock join: ${current.publicHost}:${current.bedrockPort}`));
      clearInterval(timer);
      showToast(`${current.name} is online`);
    }
    index += 1;
    saveState();
    renderAll();
  }, 650);
  logTimers.set(id, timer);
}

async function stopServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  if (server.agent && agentOnline) {
    try {
      const result = await agentFetch(`/servers/${id}/stop`, { method: "POST" });
      upsertServer(normalizeAgentServer(result.server));
      saveState();
      renderAll();
      showToast(`${server.name} stopped`);
      return;
    } catch (error) {
      showToast(error.message);
    }
  }
  clearInterval(logTimers.get(id));
  server.status = "offline";
  server.players = 0;
  server.logs.push(stamp("Stopping server"));
  server.logs.push(stamp("Saved world and closed network listener"));
  saveState();
  renderAll();
  showToast(`${server.name} stopped`);
}

function copyLink(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) return;
  const link = `${server.publicHost}:${server.port}`;
  navigator.clipboard?.writeText(link);
  server.logs.push(stamp(`Copied invite link ${link}`));
  saveState();
  renderConsole();
  showToast("Invite link copied");
}

async function deleteServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (server?.agent && agentOnline) {
    try {
      await agentFetch(`/servers/${id}/delete`, { method: "POST" });
    } catch (error) {
      showToast(error.message);
    }
  }
  state.servers = state.servers.filter((item) => item.id !== id);
  if (selectedId === id) selectedId = state.servers[0]?.id || null;
  clearInterval(logTimers.get(id));
  saveState();
  renderAll();
  showToast(`${server?.name || "Server"} deleted`);
}

function getSelectedServer() {
  return state.servers.find((server) => server.id === selectedId) || null;
}

async function checkAgent(verbose = false) {
  try {
    const health = await fetch(`${agentBase}/health`, { cache: "no-store" }).then((response) => response.json());
    agentOnline = Boolean(health.ok);
    $("#agentStatus").textContent = agentOnline ? "Online" : "Offline";
    $("#javaStatus").textContent = health.java?.found ? health.java.version : "Missing";
    if (agentOnline && state.agentToken) await syncAgentServers();
    if (verbose) showToast(agentOnline ? "Agent connected" : "Agent not available");
  } catch {
    agentOnline = false;
    $("#agentStatus").textContent = "Offline";
    $("#javaStatus").textContent = "Unknown";
    if (verbose) showToast("Start the local agent, then connect again");
  }
}

async function syncAgentServers() {
  try {
    const result = await agentFetch("/servers");
    result.servers.map(normalizeAgentServer).forEach(upsertServer);
    saveState();
    renderAll();
  } catch {
    // Token may not be entered yet.
  }
}

async function agentFetch(path, options = {}) {
  const token = $("#agentToken").value.trim();
  if (!token) throw new Error("Paste the pairing token from the local agent");
  const response = await fetch(`${agentBase}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-SquidHost-Token": token,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Agent returned HTTP ${response.status}`);
  return payload;
}

function normalizeAgentServer(server) {
  return {
    ...server,
    java: server.java || "system",
    folder: server.folder || server.dir,
    publicHost: server.publicHost || "localhost",
    players: server.players || 0,
    logs: server.logs || [],
    agent: true
  };
}

function upsertServer(server) {
  const index = state.servers.findIndex((item) => item.id === server.id);
  if (index >= 0) state.servers[index] = server;
  else state.servers.unshift(server);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

init();
