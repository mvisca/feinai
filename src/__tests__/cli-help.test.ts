import { describe, it, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const cliPath = resolve(import.meta.dir, "..", "cli.ts");
const pkg = JSON.parse(readFileSync(resolve(import.meta.dir, "..", "..", "package.json"), "utf-8"));

describe("feinai --help", () => {
  it("shows the real version in the header", () => {
    const res = Bun.spawnSync([process.execPath, cliPath, "--help"]);
    const out = res.stdout.toString();
    expect(out).not.toContain("${VERSION}");
    expect(out.split("\n")[0]).toContain(`feinai v${pkg.version}`);
  });
});
