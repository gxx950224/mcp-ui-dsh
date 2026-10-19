/**
 * 测试运行器：node:test 没有内置的"跑目录"入口，这里显式列出测试文件。
 *
 * 用子进程跑 node --test 而不是在进程内 import：这样每个测试文件之间
 * 完全隔离（互不污染 globalThis 与模块缓存），失败时退出码也直接可用。
 */
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const testDir = path.join(root, "test")
const files = fs
  .readdirSync(testDir)
  .filter((f) => f.endsWith(".test.mjs"))
  .map((f) => path.join(testDir, f))
  .sort()

if (files.length === 0) {
  console.error("没找到任何测试文件")
  process.exit(1)
}

const result = spawnSync(process.execPath, ["--test", ...files], {
  cwd: root,
  stdio: "inherit",
})

process.exit(result.status ?? 1)
