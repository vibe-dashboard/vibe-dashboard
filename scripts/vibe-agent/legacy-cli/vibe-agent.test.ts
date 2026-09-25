import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const cliSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vibe-agent.ts"), "utf8");

describe("vibe-agent legacy CLI command surface", () => {
  it("does not expose the removed review-request scheduler command", () => {
    const removedCommand = ["request", "review"].join("-");

    expect(cliSource).not.toContain(`${removedCommand} [instructions]`);
    expect(cliSource).not.toContain(`case '${removedCommand}'`);
    expect(cliSource).not.toContain(`__${removedCommand}-runner`);
  });

  it("keeps normal send, submit, and review workflows documented", () => {
    expect(cliSource).toContain('send <role> "<message>"');
    expect(cliSource).toContain('submit "<message>"');
    expect(cliSource).toContain("review <approve|changes>");
  });
});
