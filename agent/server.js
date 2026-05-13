#!/usr/bin/env node
"use strict";

const http = require("http");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

const PORT = Number(process.env.SQUIDHOST_AGENT_PORT || 58432);
const HOST = "localhost";
const DATA_DIR = process.env.SQUIDHOST_HOME || path.join(os.homedir(), ".squidhost-local");
const SERVERS_DIR = path.join(DATA_DIR, "servers");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const TOKEN_FILE = path.join(DATA_DIR, "pairing-token");

const state = {
  token: "",
  java: null,
  servers: {},
  processes: new Map()
};

const paperVersions = new Set(["1.21.5", "1.21.4", "1.20.6", "1.20.4", "1.19.4"]);

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  await fsp.mkdir(SERVERS_DIR, { recursive: true });
  state.token = await readOrCreateToken();
  await loadState();
  state.java = await detectJava();

  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log("");
    console.log("SquidHost Local Agent is running");
    console.log(`API: http://${HOST}:${PORT}`);
    console.log(`Pairing token: ${state.token}`);
    console.log(`Data folder: ${DATA_DIR}`);
    console.log("");
    console.log("Keep this window open while hosting servers.");
  });
}

async function handleRequest(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    if (url.pathname === "/health") {
      return json(res, 200, {
        ok: true,
        name: "SquidHost Local Agent",
        version: "1.0.0",
        tokenRequired: true,
        java: state.java,
        servers: publicServers()
      });
    }

    if (!isAuthorized(req)) {
      return json(res, 401, { ok: false, error: "Pairing token required" });
    }

    if (url.pathname === "/servers" && req.method === "GET") {
      return json(res, 200, { ok: true, servers: publicServers() });
    }

    if (url.pathname === "/servers/create" && req.method === "POST") {
      const body = await readJson(req);
      const server = await createServer(body);
      return json(res, 200, { ok: true, server: publicServer(server) });
    }

    const match = url.pathname.match(/^\/servers\/([^/]+)\/(start|stop|logs|delete)$/);
    if (match) {
      const [, id, action] = match;
      const server = state.servers[id];
      if (!server) return json(res, 404, { ok: false, error: "Server not found" });
      if (action === "start" && req.method === "POST") return json(res, 200, { ok: true, server: publicServer(await startServer(server)) });
      if (action === "stop" && req.method === "POST") return json(res, 200, { ok: true, server: publicServer(await stopServer(server)) });
      if (action === "delete" && req.method === "POST") return json(res, 200, { ok: true, deleted: await deleteServer(server) });
      if (action === "logs" && req.method === "GET") return json(res, 200, { ok: true, logs: server.logs || [] });
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (error) {
    console.error(error);
    json(res, 500, { ok: false, error: error.message || "Agent error" });
  }
}

function setCors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-SquidHost-Token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
}

function isAuthorized(req) {
  return req.headers["x-squidhost-token"] === state.token;
}

async function readOrCreateToken() {
  try {
    return (await fsp.readFile(TOKEN_FILE, "utf8")).trim();
  } catch {
    const token = crypto.randomBytes(16).toString("hex");
    await fsp.writeFile(TOKEN_FILE, token + os.EOL, "utf8");
    return token;
  }
}

async function loadState() {
  try {
    const saved = JSON.parse(await fsp.readFile(STATE_FILE, "utf8"));
    state.servers = saved.servers || {};
    for (const server of Object.values(state.servers)) {
      server.status = "offline";
      server.pid = null;
      server.logs = server.logs || [];
    }
  } catch {
    state.servers = {};
  }
}

async function saveState() {
  const servers = {};
  for (const [id, server] of Object.entries(state.servers)) {
    servers[id] = { ...server, status: state.processes.has(id) ? server.status : "offline", pid: null };
  }
  await fsp.writeFile(STATE_FILE, JSON.stringify({ servers }, null, 2), "utf8");
}

async function detectJava() {
  return new Promise((resolve) => {
    execFile("java", ["-version"], (error, stdout, stderr) => {
      if (error) {
        resolve({ found: false, version: null, output: "Java not found on PATH" });
        return;
      }
      const output = `${stdout}\n${stderr}`.trim();
      const versionMatch = output.match(/version "([^"]+)"/);
      resolve({ found: true, version: versionMatch ? versionMatch[1] : "unknown", output });
    });
  });
}

async function createServer(input) {
  const name = cleanName(input.name || "Minecraft Server");
  const id = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(12).toString("hex");
  const loader = input.loader || "Paper";
  const version = input.version || "1.21.4";
  const dir = path.join(SERVERS_DIR, slugify(name));
  const server = {
    id,
    name,
    loader,
    version,
    memory: String(input.memory || "4"),
    port: Number(input.port || 25565 + Math.floor(Math.random() * 300)),
    bedrockPort: Number(input.bedrockPort || 19132 + Math.floor(Math.random() * 200)),
    geyser: Boolean(input.geyser && loader === "Paper"),
    floodgate: Boolean(input.floodgate),
    onlineMode: input.onlineMode || "Premium accounts only",
    world: input.world || "New world",
    dir,
    jar: path.join(dir, "server.jar"),
    status: "offline",
    pid: null,
    logs: []
  };
  log(server, "Created local server profile");
  state.servers[id] = server;
  await fsp.mkdir(dir, { recursive: true });
  await writeServerFiles(server);
  await saveState();
  return server;
}

async function startServer(server) {
  if (state.processes.has(server.id)) return server;
  if (!state.java?.found) throw new Error("Java is not installed or is not on PATH.");
  const requiredJava = requiredJavaFor(server.version);
  const currentJava = javaMajor(state.java.version);
  if (currentJava && currentJava < requiredJava) {
    throw new Error(`Minecraft ${server.version} needs Java ${requiredJava}. Current Java is ${state.java.version}.`);
  }

  await fsp.mkdir(server.dir, { recursive: true });
  await writeServerFiles(server);
  await ensureServerJar(server);

  log(server, `Starting ${server.loader} ${server.version} with ${server.memory} GB RAM`);
  const child = spawn("java", [`-Xmx${server.memory}G`, `-Xms${Math.min(Number(server.memory), 2)}G`, "-jar", server.jar, "nogui"], {
    cwd: server.dir,
    stdio: ["ignore", "pipe", "pipe"]
  });

  server.status = "starting";
  server.pid = child.pid;
  state.processes.set(server.id, child);

  child.stdout.on("data", (chunk) => pushProcessLog(server, chunk));
  child.stderr.on("data", (chunk) => pushProcessLog(server, chunk));
  child.on("exit", async (code) => {
    log(server, `Process exited with code ${code}`);
    server.status = "offline";
    server.pid = null;
    state.processes.delete(server.id);
    await saveState();
  });

  setTimeout(async () => {
    if (state.processes.has(server.id) && server.status !== "offline") {
      server.status = "online";
      log(server, `Java players can join on localhost:${server.port}`);
      if (server.geyser) log(server, `Bedrock players can join on localhost:${server.bedrockPort}`);
      await saveState();
    }
  }, 4500);

  await saveState();
  return server;
}

async function stopServer(server) {
  const child = state.processes.get(server.id);
  if (child) {
    log(server, "Stopping server");
    child.stdin?.write?.("stop\n");
    child.kill("SIGTERM");
    state.processes.delete(server.id);
  }
  server.status = "offline";
  server.pid = null;
  await saveState();
  return server;
}

async function deleteServer(server) {
  await stopServer(server);
  delete state.servers[server.id];
  await saveState();
  return true;
}

async function writeServerFiles(server) {
  await fsp.writeFile(path.join(server.dir, "eula.txt"), "eula=true\n", "utf8");
  const properties = [
    `server-port=${server.port}`,
    `motd=${server.name}`,
    `online-mode=${server.onlineMode === "Allow non-premium users" ? "false" : "true"}`,
    "enable-command-block=true",
    "view-distance=10",
    "simulation-distance=8",
    "spawn-protection=0"
  ].join("\n") + "\n";
  await fsp.writeFile(path.join(server.dir, "server.properties"), properties, "utf8");

  if (server.geyser) {
    const pluginsDir = path.join(server.dir, "plugins");
    await fsp.mkdir(pluginsDir, { recursive: true });
    await fsp.writeFile(path.join(pluginsDir, "GEYSER_ENABLED.txt"), `Bedrock port: ${server.bedrockPort}\nFloodgate: ${server.floodgate}\n`, "utf8");
    log(server, "Geyser requested. Add GeyserMC/Floodgate plugin jars to the plugins folder for real Bedrock bridging.");
  }
}

async function ensureServerJar(server) {
  try {
    const stat = await fsp.stat(server.jar);
    if (stat.size > 1000000) return;
  } catch {
    // Download below.
  }

  if (server.loader === "Paper") {
    await downloadPaper(server);
    return;
  }
  if (server.loader === "Vanilla") {
    await downloadVanilla(server);
    return;
  }
  throw new Error(`${server.loader} automatic downloads are not implemented yet. Use Paper or Vanilla for one-click launch.`);
}

async function downloadPaper(server) {
  if (!paperVersions.has(server.version)) {
    throw new Error(`Paper ${server.version} is not available in this prototype version list.`);
  }
  log(server, `Looking up Paper builds for ${server.version}`);
  const builds = await getJson(`https://api.papermc.io/v2/projects/paper/versions/${server.version}/builds`);
  const latest = builds.builds[builds.builds.length - 1];
  if (!latest) throw new Error(`No Paper builds found for ${server.version}`);
  const file = latest.downloads.application.name;
  const url = `https://api.papermc.io/v2/projects/paper/versions/${server.version}/builds/${latest.build}/downloads/${file}`;
  log(server, `Downloading ${file}`);
  await downloadFile(url, server.jar);
  log(server, "Server jar downloaded");
}

async function downloadVanilla(server) {
  log(server, "Looking up Mojang version manifest");
  const manifest = await getJson("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
  const version = manifest.versions.find((item) => item.id === server.version);
  if (!version) throw new Error(`Vanilla ${server.version} was not found in the Mojang manifest.`);
  const details = await getJson(version.url);
  const url = details.downloads?.server?.url;
  if (!url) throw new Error(`Vanilla ${server.version} does not expose a server download.`);
  log(server, `Downloading Vanilla server ${server.version}`);
  await downloadFile(url, server.jar);
  log(server, "Server jar downloaded");
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    fetch(url).then((response) => {
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      return response.json();
    }).then(resolve, reject);
  });
}

async function downloadFile(url, target) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  const buffer = Buffer.from(await response.arrayBuffer());
  await fsp.writeFile(target, buffer);
}

function pushProcessLog(server, chunk) {
  String(chunk).split(/\r?\n/).filter(Boolean).forEach((line) => {
    log(server, line);
    if (/Done \([^)]+\)!/.test(line) || /For help, type/.test(line)) server.status = "online";
  });
}

function log(server, message) {
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  server.logs = server.logs || [];
  server.logs.push(`[${time}] ${message}`);
  if (server.logs.length > 500) server.logs = server.logs.slice(-500);
}

function publicServers() {
  return Object.values(state.servers).map(publicServer);
}

function publicServer(server) {
  return {
    id: server.id,
    name: server.name,
    loader: server.loader,
    version: server.version,
    memory: server.memory,
    port: server.port,
    bedrockPort: server.bedrockPort,
    geyser: server.geyser,
    floodgate: server.floodgate,
    onlineMode: server.onlineMode,
    world: server.world,
    folder: server.dir,
    status: state.processes.has(server.id) ? server.status : server.status || "offline",
    pid: server.pid,
    logs: server.logs || [],
    publicHost: "localhost"
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(value));
}

function cleanName(value) {
  return String(value).replace(/[^\w .-]/g, "").trim().slice(0, 48) || "Minecraft Server";
}

function slugify(value) {
  return cleanName(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "server";
}

function requiredJavaFor(version) {
  const parts = String(version).split(".").map((part) => Number(part));
  const minor = parts[1] || 0;
  const patch = parts[2] || 0;
  if (minor > 20 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

function javaMajor(version) {
  const raw = String(version || "");
  if (raw.startsWith("1.")) return Number(raw.split(".")[1]) || null;
  return Number(raw.split(".")[0]) || null;
}
