import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createProxyServer } from "http-proxy";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const apiPort = Number(process.env.API_PORT ?? 8020);
const webPort = Number(process.env.WEB_PORT ?? 4000);
const publicPort = Number(process.env.PORT ?? 3000);

function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  child.on("exit", (code, signal) => {
    if (signal || code !== 0) {
      process.exit(code ?? 1);
    }
  });
  return child;
}

const apiCommand = process.platform === "win32" ? "python" : "python3";
launch(apiCommand, ["-m", "uvicorn", "app.main:app", "--app-dir", "apps/api", "--host", "127.0.0.1", "--port", String(apiPort)], repoRoot);
launch("npm", ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(webPort)], path.join(repoRoot, "apps/web"));

const proxy = createProxyServer({ changeOrigin: true, xfwd: true, ws: true });
const backendPrefixes = ["/twilio", "/ws", "/health", "/docs", "/redoc", "/openapi.json"];

function targetFor(url) {
  return backendPrefixes.some((prefix) => url.startsWith(prefix))
    ? `http://127.0.0.1:${apiPort}`
    : `http://127.0.0.1:${webPort}`;
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  proxy.web(req, res, { target: targetFor(url) });
});

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "/";
  proxy.ws(req, socket, head, { target: targetFor(url) });
});

server.listen(publicPort, "0.0.0.0", () => {
  console.log(`Railway proxy listening on ${publicPort}`);
});

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
