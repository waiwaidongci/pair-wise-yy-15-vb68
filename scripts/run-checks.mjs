// 规则层与台账层冒烟测试：用 esbuild 转译 TS 后由 node 执行，无需额外测试框架。
// check-store 依赖 jsdom（提供 localStorage/window），标记为 external 后从工作区解析。
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const outDir = path.resolve(".test-tmp");
const cases = [
  { entry: "scripts/check-rules.ts", external: [] },
  { entry: "scripts/check-store.ts", external: ["jsdom"] },
  { entry: "scripts/check-ui.tsx", external: ["jsdom", "react", "react-dom", "react/jsx-runtime"] },
];

let failed = false;
for (const c of cases) {
  const out = path.join(outDir, path.basename(c.entry).replace(/\.tsx?$/, ".mjs"));
  await build({
    entryPoints: [c.entry],
    bundle: true,
    platform: "node",
    format: "esm",
    external: c.external,
    outfile: out,
    logLevel: "silent",
  });
  process.stdout.write(`\n▶ ${c.entry}\n`);
  try {
    await import(pathToFileURL(out).href + `?v=${Date.now()}`);
  } catch (err) {
    console.error(err);
    failed = true;
  }
}

await rm(outDir, { recursive: true, force: true });
if (failed) process.exit(1);
