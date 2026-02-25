import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve(process.cwd(), "frontend", "dist");
const targetDir = resolve(process.cwd(), "dist");

if (!existsSync(sourceDir)) {
  throw new Error("Expected frontend/dist to exist after build.");
}

if (existsSync(targetDir)) {
  rmSync(targetDir, { recursive: true, force: true });
}

mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });

console.log("Synced frontend/dist -> dist");
