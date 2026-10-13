// `feinai install-skills` — copies feinai skills to the opencode agents dir.
// Explicit command (not a postinstall hook) so installing the package runs no code.

import { existsSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

export function cmdInstallSkills(): void {
  const home = homedir();
  const openCodeDir = join(home, ".config", "opencode");
  const agentsDir = join(openCodeDir, "agents");
  const skillsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "skills");

  if (!existsSync(openCodeDir)) {
    console.error(`opencode not configured (${openCodeDir} not found)`);
    process.exit(1);
  }
  mkdirSync(agentsDir, { recursive: true });

  let copied = 0;
  for (const skill of readdirSync(skillsDir)) {
    if (!skill.startsWith("feinai-")) continue;
    const src = join(skillsDir, skill, "SKILL.md");
    if (!existsSync(src)) continue;
    copyFileSync(src, join(agentsDir, `${skill}.md`));
    copied++;
  }
  console.log(`feinai: ${copied} skills copied to ${agentsDir}`);
}
