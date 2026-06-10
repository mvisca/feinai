#!/usr/bin/env bun
// Runs after bun install -g feinai
// Copies feinai skills to opencode agents dir if opencode is configured

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const home = homedir();
const openCodeAgentsDir = join(home, ".config", "opencode", "agents");
const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

// Only run if opencode is configured
if (!existsSync(join(home, ".config", "opencode"))) process.exit(0);

if (!existsSync(openCodeAgentsDir)) mkdirSync(openCodeAgentsDir, { recursive: true });

let copied = 0;
for (const skill of readdirSync(skillsDir)) {
  if (!skill.startsWith("feinai-")) continue;
  const src = join(skillsDir, skill, "SKILL.md");
  const dst = join(openCodeAgentsDir, `${skill}.md`);
  if (existsSync(src)) {
    copyFileSync(src, dst);
    copied++;
  }
}

if (copied > 0 && process.stdout.isTTY) {
  console.log(`feinai: ${copied} skills copied to opencode agents (${openCodeAgentsDir})`);
}
