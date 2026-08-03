import {
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import simpleGit from "simple-git";
import type {
  ChangeRecord,
  GraphqlImpact,
  Session,
  SessionMetadata,
} from "@directdom/shared";
import {
  DEFAULT_BASE_BRANCH,
  FERRUM_REPO,
  GRAPHQL_REPO,
  buildChangeTitle,
  withJiraTicketPrefix,
} from "@directdom/shared";
import { Octokit } from "octokit";
import type { LlmConfig } from "@directdom/shared/llm";
import {
  completeJson,
  hasLlmApiKey,
  resolveLlmConfig,
} from "@directdom/shared/llm";
import { applyStylingEdits } from "./apply-styling-edits.js";
import { applyStructuralEdits } from "./apply-structural-edits.js";
import {
  buildStructuralCodegenHints,
  findCandidateFiles,
} from "./find-candidates.js";

export type CodegenResult = {
  ferrumPrUrl?: string;
  graphqlPrUrl?: string;
  message: string;
};

export type CodegenOptions = {
  session: Session;
  metadata: SessionMetadata;
  graphqlImpact: GraphqlImpact;
  isProd: boolean;
  githubToken?: string;
  createGithubPr?: boolean;
  reposDir?: string;
  llmConfig?: LlmConfig;
  /** When set, prefixed onto commit message + PR title for Jira linking */
  jiraTicketKey?: string;
};

const DEFAULT_REPOS_DIR = "./repos";
const CURSOR_RULES_MAX_CHARS = 4000;

const readCursorRules = (repoPath: string): string => {
  const rulesPath = join(repoPath, ".cursor", "rules");
  if (!existsSync(rulesPath)) return "";

  const stat = statSync(rulesPath);
  if (stat.isFile()) {
    return readFileSync(rulesPath, "utf-8").slice(0, CURSOR_RULES_MAX_CHARS);
  }

  if (!stat.isDirectory()) return "";

  const ruleFiles = readdirSync(rulesPath)
    .filter((name) => /\.(mdc?|txt)$/i.test(name))
    .sort();

  let rules = "";
  for (const name of ruleFiles) {
    const chunk = readFileSync(join(rulesPath, name), "utf-8");
    rules = rules ? `${rules}\n\n${chunk}` : chunk;
    if (rules.length >= CURSOR_RULES_MAX_CHARS) break;
  }

  return rules.slice(0, CURSOR_RULES_MAX_CHARS);
};

export const getCompareUrl = (repo: string, branchName: string): string =>
  `https://github.com/${repo}/compare/${DEFAULT_BASE_BRANCH}...${branchName}?expand=1`;

const getOctokit = (token?: string): Octokit | null => {
  const t = token ?? process.env.GITHUB_TOKEN;
  if (!t) return null;
  return new Octokit({ auth: t });
};

export const cloneOrPullRepo = async (
  repo: string,
  reposDir: string,
): Promise<string> => {
  const dirName = repo.split("/")[1];
  const localPath = join(reposDir, dirName);
  mkdirSync(reposDir, { recursive: true });

  const git = simpleGit();
  const cloneUrl = `https://github.com/${repo}.git`;
  const remoteRef = `origin/${DEFAULT_BASE_BRANCH}`;

  try {
    if (existsSync(join(localPath, ".git"))) {
      const repoGit = simpleGit(localPath);
      await repoGit.fetch("origin", DEFAULT_BASE_BRANCH, ["--prune"]);
      await repoGit.checkout(DEFAULT_BASE_BRANCH);
      await repoGit.reset(["--hard", remoteRef]);
      await repoGit.clean("f", ["-d"]);
      console.log(
        `[codegen] Refreshed ${repo} to a clean ${remoteRef} at ${localPath}`,
      );
    } else {
      await git.clone(cloneUrl, localPath, [
        "--branch",
        DEFAULT_BASE_BRANCH,
        "--single-branch",
      ]);
      console.log(
        `[codegen] Cloned ${repo} at ${DEFAULT_BASE_BRANCH} to ${localPath}`,
      );
    }
  } catch (error) {
    console.error(`Error cloning or refreshing repo ${repo}:`, error);
    throw error;
  }

  return localPath;
};

export const generateLlmEdits = async (params: {
  repoPath: string;
  repoName: string;
  ledger: ChangeRecord[];
  pageUrl?: string;
  llmConfig?: LlmConfig;
}): Promise<Array<{ path: string; content: string }>> => {
  const llmConfig =
    params.llmConfig ??
    resolveLlmConfig({
      provider: process.env.LLM_PROVIDER,
      model: process.env.LLM_MODEL,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
    });
  console.log("llmConfig", llmConfig);
  if (!hasLlmApiKey(llmConfig)) return [];

  const rules = readCursorRules(params.repoPath);
  const structuralHints = buildStructuralCodegenHints(params.ledger);
  const hasStructuralChanges = structuralHints.length > 0;

  const candidates = findCandidateFiles(params.repoPath, params.ledger, {
    pageUrl: params.pageUrl,
    maxCandidates: hasStructuralChanges ? 1 : undefined,
  });

  if (candidates.length === 0) {
    console.warn(
      `[codegen] No candidate source files found in ${params.repoName} for ledger changes; skipping LLM edits.`,
    );
    return [];
  }

  console.log(
    `[codegen] Found ${candidates.length} candidate file(s) for ${params.repoName}:`,
    candidates.map((c) => `${c.path} (score=${c.score})`).join(", "),
  );

  const topCandidatePath = candidates[0]?.path;

  const content = await completeJson(llmConfig, {
    system: `You generate file edits for a React/TypeScript repo (${params.repoName}) that uses dibs-css utility classes.
Return JSON: { "edits": [{ "path": "relative/path/from/repo/root", "content": "full file content" }] }

Rules:
- Only edit files from the provided candidates (or a clearly related import in the same package).
${
  hasStructuralChanges && topCandidatePath
    ? `- STRUCTURAL CHANGES: edit ONLY "${topCandidatePath}" (the highest-scored candidate). Do NOT edit any other candidate files.
- Make the smallest possible diff. NEVER remove or alter export statements (keep "export default" exactly as-is).
- insertElement: insert newElementPreview JSX at the anchor location described in structuralHints (use anchorFiberHint / anchorSelector data-tn). Respect position: before/after/inside.
- Do NOT relocate unrelated JSX, do NOT duplicate existing blocks, do NOT modify sibling components unless required for the insert.`
    : ""
}
- For styling patches (className or inlineStyle preview), map inline values back to dibsCss.<key> when possible. If the component imports a *.module.css file, update the relevant rule in that CSS file instead of adding inline styles to JSX.
- When no dibs-css class matches the requested style, add style={{ ... }} on the matching JSX element in the component source.
- Prefer dibsCss.<key> / classNames(...) over raw "dc-*" class strings. DOM classes use a "dc-" prefix; source uses dibsCss without that prefix (e.g. dc-textBlue600 → dibsCss.textBlue600).
- For textContent patches, preserve the existing localization architecture. Update the relevant translation message, copy-producing function, or interpolated value; do not replace rendered text blindly across source files.
- Apply the ledger patches as minimal source changes; return the full updated file content for each edited path.
- You MUST return at least one edit when candidates are provided and the change is a className/textContent/attribute patch.
- Do not invent new files unless absolutely required.
Follow these repo rules: ${rules || "Use React, TypeScript, and existing dibs-css conventions."}`,
    user: JSON.stringify({
      pageUrl: params.pageUrl,
      changes: params.ledger,
      structuralHints,
      primaryCandidate: topCandidatePath,
      candidates: candidates.map(({ path, content: fileContent, score }) => ({
        path,
        score,
        content: fileContent,
      })),
    }),
  });

  let parsed: { edits?: Array<{ path: string; content: string }> };
  try {
    parsed = JSON.parse(content) as {
      edits?: Array<{ path: string; content: string }>;
    };
  } catch (error) {
    console.error(
      `[codegen] Failed to parse LLM JSON for ${params.repoName}:`,
      error,
      content.slice(0, 500),
    );
    return [];
  }

  const edits = (parsed.edits ?? []).filter((edit) => {
    if (!hasStructuralChanges || !topCandidatePath) return true;
    if (edit.path !== topCandidatePath) {
      console.warn(
        `[codegen] Dropping LLM edit for non-primary candidate: ${edit.path}`,
      );
      return false;
    }
    if (!edit.content.includes("export default")) {
      console.warn(
        `[codegen] Dropping LLM edit missing export default: ${edit.path}`,
      );
      return false;
    }
    return true;
  });

  if (edits.length === 0 && (parsed.edits ?? []).length > 0) {
    console.warn(
      `[codegen] All LLM edits were filtered out for ${params.repoName}`,
    );
  } else if (edits.length === 0) {
    console.warn(
      `[codegen] LLM returned 0 edits for ${params.repoName} despite ${candidates.length} candidate(s). Raw (truncated): ${content.slice(0, 400)}`,
    );
  }

  return edits;
};

export const createPullRequest = async (params: {
  repo: string;
  branchName: string;
  title: string;
  body: string;
  files: Array<{ path: string; content: string }>;
  basePath: string;
  isDraft: boolean;
  labels: string[];
  octokit: Octokit;
  createPr?: boolean;
}): Promise<string> => {
  const [owner, repoName] = params.repo.split("/");
  const { data: ref } = await params.octokit.rest.git.getRef({
    owner,
    repo: repoName,
    ref: `heads/${DEFAULT_BASE_BRANCH}`,
  });
  const baseSha = ref.object.sha;

  await params.octokit.rest.git.createRef({
    owner,
    repo: repoName,
    ref: `refs/heads/${params.branchName}`,
    sha: baseSha,
  });

  const { data: baseCommit } = await params.octokit.rest.git.getCommit({
    owner,
    repo: repoName,
    commit_sha: baseSha,
  });

  const blobs = await Promise.all(
    params.files.map(async (file) => {
      const { data } = await params.octokit.rest.git.createBlob({
        owner,
        repo: repoName,
        content: Buffer.from(file.content).toString("base64"),
        encoding: "base64",
      });
      return { path: file.path, sha: data.sha };
    }),
  );

  const { data: tree } = await params.octokit.rest.git.createTree({
    owner,
    repo: repoName,
    base_tree: baseCommit.tree.sha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644" as const,
      type: "blob" as const,
      sha: b.sha,
    })),
  });

  const { data: commit } = await params.octokit.rest.git.createCommit({
    owner,
    repo: repoName,
    message: params.title,
    tree: tree.sha,
    parents: [baseSha],
  });

  await params.octokit.rest.git.updateRef({
    owner,
    repo: repoName,
    ref: `heads/${params.branchName}`,
    sha: commit.sha,
  });

  const compareUrl = getCompareUrl(params.repo, params.branchName);
  if (params.createPr === false) {
    return compareUrl;
  }

  const { data: pr } = await params.octokit.rest.pulls.create({
    owner,
    repo: repoName,
    title: params.title,
    head: params.branchName,
    base: DEFAULT_BASE_BRANCH,
    body: params.body,
    draft: params.isDraft,
  });

  if (params.labels.length) {
    await params.octokit.rest.issues.addLabels({
      owner,
      repo: repoName,
      issue_number: pr.number,
      labels: params.labels,
    });
  }

  return pr.html_url;
};

export const runCodegen = async (
  options: CodegenOptions,
): Promise<CodegenResult> => {
  const {
    session,
    metadata,
    graphqlImpact,
    isProd,
    reposDir = DEFAULT_REPOS_DIR,
    jiraTicketKey,
  } = options;

  const changeTitle = buildChangeTitle({
    pageUrl: session.pageUrl,
    intents: session.ledger.map((r) => r.intent),
    summary: metadata.summary,
  });
  const prTitle = withJiraTicketPrefix(changeTitle, jiraTicketKey);

  const octokit = getOctokit(options.githubToken);
  const branchSlug = changeTitle
    .toLowerCase()
    .replace(/^\[[^\]]+\]\s*/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const branchName = `directdom/${session.id.slice(0, 8)}-${branchSlug || "change"}`;
  const labels = [
    "directdom",
    "needs-review",
    ...(isProd ? ["prod-origin"] : []),
  ];

  const createGithubPr = options.createGithubPr !== false;

  if (!octokit) {
    return {
      message: "Mock mode: GitHub token not configured. Codegen skipped.",
      ferrumPrUrl: getCompareUrl(FERRUM_REPO, branchName),
      graphqlPrUrl:
        graphqlImpact !== "none"
          ? getCompareUrl(GRAPHQL_REPO, `${branchName}-graphql`)
          : undefined,
    };
  }

  let ferrumPath: string;
  try {
    ferrumPath = await cloneOrPullRepo(FERRUM_REPO, reposDir);
  } catch {
    return {
      message: "Could not clone ferrum repo. Check GITHUB_TOKEN permissions.",
    };
  }

  const stylingResult = applyStylingEdits(
    ferrumPath,
    session.ledger,
    session.pageUrl,
  );

  const structuralResult = applyStructuralEdits(
    ferrumPath,
    session.ledger,
    session.pageUrl,
  );

  const ferrumFiles: Array<{ path: string; content: string }> = [
    ...new Set([
      ...stylingResult.modifiedPaths,
      ...structuralResult.modifiedPaths,
    ]),
  ].map((absPath) => ({
    path: absPath.replace(ferrumPath + "/", ""),
    content: readFileSync(absPath, "utf-8"),
  }));

  const isCodegenClassEdit = (change: (typeof session.ledger)[number]): boolean =>
    change.patch.type === "className" ||
    change.patch.type === "inlineStyle";

  const isInsertChange = (change: (typeof session.ledger)[number]): boolean =>
    change.patch.type === "insertElement";

  const appliedStylingIds = new Set(stylingResult.appliedChangeIds);
  const appliedStructuralIds = new Set(structuralResult.appliedChangeIds);

  const changesForLlm = session.ledger.filter((change) => {
    if (isCodegenClassEdit(change) && appliedStylingIds.has(change.id)) {
      return false;
    }
    if (isInsertChange(change) && appliedStructuralIds.has(change.id)) {
      return false;
    }
    return true;
  });
  let generatedLlmEdits =
    structuralResult.appliedChangeIds.length > 0 ||
    stylingResult.appliedChangeIds.length > 0;

  if (changesForLlm.length > 0) {
    try {
      const llmEdits = await generateLlmEdits({
        repoPath: ferrumPath,
        repoName: "ferrum",
        ledger: changesForLlm,
        pageUrl: session.pageUrl,
        llmConfig: options.llmConfig,
      });
      generatedLlmEdits = llmEdits.length > 0 || generatedLlmEdits;
      for (const edit of llmEdits) {
        const absPath = join(ferrumPath, edit.path);
        writeFileSync(absPath, edit.content, "utf-8");
        const existingFileIndex = ferrumFiles.findIndex(
          (file) => file.path === edit.path,
        );
        if (existingFileIndex >= 0) {
          ferrumFiles[existingFileIndex] = edit;
        } else {
          ferrumFiles.push(edit);
        }
      }
    } catch (error) {
      console.error(`Error generating LLM edits for ferrum:`, error);
      throw error;
    }
  }

  if (ferrumFiles.length === 0 || !generatedLlmEdits) {
    console.error(
      `[codegen] Falling back to .directdom session dump for ${session.id}. ` +
        `Ledger patches: ${session.ledger
          .map(
            (r) =>
              `${r.patch.type}@${r.target.reactFiberHint ?? r.target.selector}`,
          )
          .join("; ")}`,
    );
    const fallbackPath = `.directdom/${session.id}.json`;
    if (!ferrumFiles.some((file) => file.path === fallbackPath)) {
      ferrumFiles.push({
        path: fallbackPath,
        content: JSON.stringify({ session, ledger: session.ledger }, null, 2),
      });
    }
  }

  const prBody = [
    "## DirectDOM automated change",
    "",
    `**Session:** ${session.id}`,
    `**Page:** ${session.pageUrl}`,
    `**Environment:** ${session.environment}`,
    "",
    "### Changes",
    ...session.ledger.map(
      (r, i) => `${i + 1}. ${r.intent} (\`${r.patch.type}\`)`,
    ),
    "",
    "---",
    "*Generated by DirectDOM*",
  ].join("\n");

  const ferrumPrUrl = await createPullRequest({
    repo: FERRUM_REPO,
    branchName,
    title: prTitle,
    body: prBody,
    files: ferrumFiles,
    basePath: ferrumPath,
    isDraft: true,
    labels,
    octokit,
    createPr: createGithubPr,
  });

  let graphqlPrUrl: string | undefined;

  if (graphqlImpact !== "none") {
    try {
      const graphqlPath = await cloneOrPullRepo(GRAPHQL_REPO, reposDir);
      const graphqlEdits = await generateLlmEdits({
        repoPath: graphqlPath,
        repoName: "dibs-graphql",
        ledger: session.ledger,
        pageUrl: session.pageUrl,
        llmConfig: options.llmConfig,
      });

      const graphqlFiles =
        graphqlEdits.length > 0
          ? graphqlEdits
          : [
              {
                path: `.directdom/${session.id}.json`,
                content: JSON.stringify(
                  { session, graphqlImpact, ledger: session.ledger },
                  null,
                  2,
                ),
              },
            ];

      graphqlPrUrl = await createPullRequest({
        repo: GRAPHQL_REPO,
        branchName: `${branchName}-graphql`,
        title: withJiraTicketPrefix(
          `[GraphQL] ${changeTitle}`,
          jiraTicketKey,
        ),
        body: `${prBody}\n\nLinked Ferrum change: ${ferrumPrUrl}`,
        files: graphqlFiles,
        basePath: graphqlPath,
        isDraft: true,
        labels: [...labels, "graphql"],
        octokit,
        createPr: createGithubPr,
      });
    } catch {
      graphqlPrUrl = undefined;
    }
  }

  const count = graphqlPrUrl ? 2 : 1;
  const artifact = createGithubPr ? "draft PR(s)" : "branch(es)";

  return {
    ferrumPrUrl,
    graphqlPrUrl,
    message: `Created ${count} ${artifact}`,
  };
};
