import { describe, expect, it } from "vitest";
import { transformWithEsbuild } from "vite";
import { buildClientEnvDefine } from "../../vite.config";

async function transformClientEnv(env: NodeJS.ProcessEnv) {
  return transformWithEsbuild(
    [
      "export const kill = process.env.VD_DISABLE_SPACES_OVERVIEW_UIC;",
      "export const alias = process.env.VD_SPACES_OVERVIEW_UIC;",
    ].join("\n"),
    "spaces-overview-uic-env.ts",
    {
      define: buildClientEnvDefine(env),
      format: "esm",
    },
  );
}

describe("SpacesOverview UIC production client env injection", () => {
  it("injects only the disable kill switch into the built client replacement map", () => {
    const define = buildClientEnvDefine({
      VD_DISABLE_SPACES_OVERVIEW_UIC: "1",
      VD_SPACES_OVERVIEW_UIC: "0",
    });

    expect(define["process.env.VD_DISABLE_SPACES_OVERVIEW_UIC"]).toBe("\"1\"");
    expect(define).not.toHaveProperty("process.env.VD_SPACES_OVERVIEW_UIC");
  });

  it("replaces production client kill-switch values while leaving enable aliases uninjected", async () => {
    for (const value of ["1", "true", "yes", "on", "", "0", "false"]) {
      const transformed = await transformClientEnv({
        VD_DISABLE_SPACES_OVERVIEW_UIC: value,
        VD_SPACES_OVERVIEW_UIC: "0",
      });

      expect(transformed.code).toContain(`const kill = ${JSON.stringify(value)};`);
      expect(transformed.code).toContain("process.env.VD_SPACES_OVERVIEW_UIC");
    }
  });
});
