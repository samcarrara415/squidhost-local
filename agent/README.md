# SquidHost Local Agent

The hosted browser UI cannot run Java or start Minecraft by itself. Run this local agent on the player's computer, then the GitHub Pages UI controls it through `http://127.0.0.1:58432`.

## Run From Source

```sh
cd agent
npm start
```

The terminal prints a pairing token. Paste that token into the web UI when prompted.

## Build A Windows EXE

```sh
cd agent
npm run build:win
```

The executable is written to `agent/dist/squidhost-agent.exe`.

## What It Does

- Creates local server folders under `~/.squidhost-local/servers`
- Writes `eula.txt` and `server.properties`
- Downloads Paper or Vanilla server jars
- Starts/stops Java server processes
- Streams console logs to the browser UI

Paper and Vanilla are one-click. Fabric/Forge profiles are kept in the UI, but automatic installer handling is intentionally not enabled yet.
