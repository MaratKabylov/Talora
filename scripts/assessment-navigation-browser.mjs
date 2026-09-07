// Isolated browser fixture: real React components, synthetic transport, no Supabase/env keys.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { webpack } = require("next/dist/compiled/webpack/webpack");
const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "coverage/assessment-navigation-browser");
await new Promise((done, reject) => webpack({
  mode: "development", target: "web", devtool: false,
  entry: resolve(root, "tests/browser/assessment-navigation.entry.tsx"),
  output: { path: output, filename: "fixture.js" },
  resolve: { extensions: [".tsx", ".ts", ".js"], alias: {
    "@/lib/assessment/actions$": resolve(root, "tests/browser/assessment-navigation-actions.ts"),
    "@/lib/employee-assessments/public-actions$": resolve(root, "tests/browser/assessment-navigation-actions.ts"),
    "@": root,
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve(root, "tests/browser/typescript-loader.cjs") }] },
  plugins: [new webpack.DefinePlugin({ "process.env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED": JSON.stringify("false") })],
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString({ all: false, errors: true }))) : done()));
createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (request.url === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(resolve(output, "fixture.js"))); return;
  }
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Assessment navigation browser test</title></head><body><pre id="result">Running...</pre><div id="root"></div><script src="/fixture.js"></script></body></html>');
}).listen(4318, "127.0.0.1", () => console.log("Browser fixture: http://127.0.0.1:4318 (synthetic data only)"));
