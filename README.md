# SquidHost Local

A browser-based Minecraft server manager inspired by SquidServers' public product flow and support documentation. The web UI can be hosted on GitHub Pages, while the companion local agent runs on the player's computer and performs native work through `http://127.0.0.1:58432`.

## Launch

Open `index.html` directly, run a small local server, or use the GitHub Pages deployment:

```sh
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Real Local Hosting

Start the companion agent:

```sh
cd agent
npm start
```

Paste the pairing token printed by the agent into the web UI. After that, creating and launching Paper or Vanilla servers will:

- create local server folders under `~/.squidhost-local/servers`
- write `eula.txt` and `server.properties`
- download the matching Paper or Vanilla server jar
- start/stop the Java server process
- stream logs back into the browser

The computer running the agent must have a compatible Java runtime installed. Minecraft 1.20.5+ needs Java 21, and 1.17 through 1.20.4 usually needs Java 17.

## Windows EXE

The agent can be packaged as a Windows executable:

```sh
cd agent
npm run build:win
```

GitHub Actions also includes a manual `Build Local Agent` workflow that produces `squidhost-agent.exe` as an artifact.

The Pages site links to `agent/dist/squidhost-agent.exe` when that built artifact is committed or uploaded into the deployed site.

## Current Scope

Paper and Vanilla are wired for one-click downloads and launches. Fabric/Forge remain profile options in the UI, but automatic installer handling is not enabled yet. Geyser is surfaced in setup and server files; real Bedrock bridging requires adding the GeyserMC/Floodgate plugin jars to the Paper server's `plugins` folder.
