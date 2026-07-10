import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDibsCssClassesFromRepo, cloneOrPullRepo } from "@directdom/codegen";
import { FERRUM_REPO } from "@directdom/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const registryPath = join(__dirname, "../data/component-registry.json");

const main = async (): Promise<void> => {
  const reposDir = process.env.REPOS_DIR ?? join(process.cwd(), "repos");
  const ferrumPath = await cloneOrPullRepo(FERRUM_REPO, reposDir);
  const dibsCssClasses = parseDibsCssClassesFromRepo(ferrumPath);

  const registry = JSON.parse(readFileSync(registryPath, "utf-8")) as Record<
    string,
    unknown
  >;
  registry.dibsCssClasses = dibsCssClasses;
  delete registry.tailwindAllowlist;

  writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf-8");
  console.log(`Synced ${dibsCssClasses.length} dibs-css classes to registry.`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
