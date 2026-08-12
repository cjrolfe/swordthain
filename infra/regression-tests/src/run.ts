import { signIn } from "./auth.js";
import { makeApi } from "./api.js";
import * as smoke from "./scenarios/smoke.js";
import * as folders from "./scenarios/folders.js";
import * as media from "./scenarios/media.js";
import * as playlists from "./scenarios/playlists.js";

const SCENARIOS = { smoke, folders, media, playlists } as const;

async function main(): Promise<void> {
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]?.split(",")
    : undefined;

  console.log("Signing in as the regression-test account...");
  const idToken = await signIn();
  const api = makeApi(idToken);
  console.log("Signed in.\n");

  const results: { name: string; passed: boolean; error?: string; ms: number }[] = [];

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    if (only && !only.includes(name)) continue;
    const start = Date.now();
    process.stdout.write(`[${name}] running... `);
    try {
      await scenario.run(api);
      const ms = Date.now() - start;
      results.push({ name, passed: true, ms });
      console.log(`PASS (${ms}ms)`);
    } catch (err) {
      const ms = Date.now() - start;
      const message = err instanceof Error ? err.message : String(err);
      results.push({ name, passed: false, error: message, ms });
      console.log(`FAIL (${ms}ms)\n  ${message}`);
    }
  }

  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} scenarios passed.`);
  if (failed.length > 0) {
    console.log(`Failed: ${failed.map((f) => f.name).join(", ")}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Regression suite crashed before completing:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
