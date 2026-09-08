import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "coverage/builder-editor-browser");
await new Promise((done, reject) => webpack({
  mode: "development", target: "web", devtool: false,
  entry: resolve(root, "tests/browser/builder-editor.entry.tsx"),
  output: { path: output, filename: "fixture.js" },
  resolve: { extensions: [".tsx", ".ts", ".js"], alias: {
    "@/lib/tests/actions$": resolve(root, "tests/browser/builder-import-actions.ts"),
    "@/lib/tests/builder-actions$": resolve(root, "tests/browser/builder-import-actions.ts"), "@": root,
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve(root, "tests/browser/builder-profile-loader.cjs") }] },
  plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED": JSON.stringify("false") })],
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : done()));
createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(resolve(output, "fixture.js"))); return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Builder editor profiling</title></head><body><pre id="result">Running...</pre><div id="root"></div><script src="/fixture.js"></script></body></html>');
}).listen(4320, "127.0.0.1", () => console.log("Browser fixture: http://127.0.0.1:4320 (synthetic data only)"));
