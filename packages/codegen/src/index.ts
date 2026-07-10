import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
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
} from "@directdom/shared";
import { Octokit } from "octokit";
import type { LlmConfig } from "@directdom/shared/llm";
import {
  completeJson,
  hasLlmApiKey,
  resolveLlmConfig,
} from "@directdom/shared/llm";
import { Project } from "ts-morph";

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
  reposDir?: string;
  llmConfig?: LlmConfig;
};

const DEFAULT_REPOS_DIR = "./repos";

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

  if (existsSync(join(localPath, ".git"))) {
    await simpleGit(localPath)
      .checkout(DEFAULT_BASE_BRANCH)
      .pull("origin", DEFAULT_BASE_BRANCH);
  } else {
    await git.clone(cloneUrl, localPath, [
      "--branch",
      DEFAULT_BASE_BRANCH,
      "--single-branch",
    ]);
  }

  return localPath;
};

export const applyTextContentEdits = (
  repoPath: string,
  ledger: ChangeRecord[],
): string[] => {
  const modifiedFiles: string[] = [];
  const textChanges = ledger.filter((r) => r.patch.type === "textContent");

  if (textChanges.length === 0) return modifiedFiles;

  const project = new Project({
    tsConfigFilePath: join(repoPath, "tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  project.addSourceFilesAtPaths([join(repoPath, "src/**/*.{tsx,ts,jsx,js}")]);

  for (const change of textChanges) {
    const searchText = change.before.textContent?.trim();
    const replaceText =
      change.patch.type === "textContent" ? change.patch.value : "";
    if (!searchText || !replaceText || searchText === replaceText) continue;

    for (const sourceFile of project.getSourceFiles()) {
      const content = sourceFile.getFullText();
      if (content.includes(searchText)) {
        sourceFile.replaceWithText(content.split(searchText).join(replaceText));
        modifiedFiles.push(sourceFile.getFilePath());
      }
    }
  }

  project.saveSync();
  return [...new Set(modifiedFiles)];
};

export const generateLlmEdits = async (params: {
  repoPath: string;
  repoName: string;
  ledger: ChangeRecord[];
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

  const rulesPath = join(params.repoPath, ".cursor", "rules");
  let rules = "";
  if (existsSync(rulesPath)) {
    rules = readFileSync(rulesPath, "utf-8").slice(0, 4000);
  }

  const content = await completeJson(llmConfig, {
    system: `You generate file edits for a React/TypeScript/Tailwind repo (${params.repoName}).
Return JSON: { "edits": [{ "path": "relative/path/from/repo/root", "content": "full file content" }] }
Follow these rules: ${rules || "Use React, TypeScript, Tailwind conventions."}`,
    user: JSON.stringify({ changes: params.ledger }),
  });

  const parsed = JSON.parse(content) as {
    edits: Array<{ path: string; content: string }>;
  };

  return parsed.edits ?? [];
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
  } = options;

  const octokit = getOctokit(options.githubToken);
  const branchSlug = (metadata.summary ?? "change")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);
  const branchName = `directdom/${session.id.slice(0, 8)}-${branchSlug}`;
  const labels = [
    "directdom",
    "needs-review",
    ...(isProd ? ["prod-origin"] : []),
  ];

  if (!octokit) {
    return {
      message: "Mock mode: GitHub token not configured. Codegen skipped.",
      ferrumPrUrl: `https://github.com/${FERRUM_REPO}/compare/develop...${branchName}?expand=1`,
      graphqlPrUrl:
        graphqlImpact !== "none"
          ? `https://github.com/${GRAPHQL_REPO}/compare/develop...${branchName}?expand=1`
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

  const modifiedByTsMorph = applyTextContentEdits(ferrumPath, session.ledger);

  const ferrumFiles: Array<{ path: string; content: string }> =
    modifiedByTsMorph.map((absPath) => ({
      path: absPath.replace(ferrumPath + "/", ""),
      content: readFileSync(absPath, "utf-8"),
    }));

  if (ferrumFiles.length === 0) {
    const llmEdits = await generateLlmEdits({
      repoPath: ferrumPath,
      repoName: "ferrum",
      ledger: session.ledger,
      llmConfig: options.llmConfig,
    });
    for (const edit of llmEdits) {
      const absPath = join(ferrumPath, edit.path);
      writeFileSync(absPath, edit.content, "utf-8");
      ferrumFiles.push(edit);
    }
  }

  if (ferrumFiles.length === 0) {
    ferrumFiles.push({
      path: `.directdom/${session.id}.json`,
      content: JSON.stringify({ session, ledger: session.ledger }, null, 2),
    });
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
    title:
      metadata.summary ??
      `DirectDOM: ${session.ledger[0]?.intent ?? "UI change"}`,
    body: prBody,
    files: ferrumFiles,
    basePath: ferrumPath,
    isDraft: true,
    labels,
    octokit,
  });

  let graphqlPrUrl: string | undefined;

  if (graphqlImpact !== "none") {
    try {
      const graphqlPath = await cloneOrPullRepo(GRAPHQL_REPO, reposDir);
      const graphqlEdits = await generateLlmEdits({
        repoPath: graphqlPath,
        repoName: "dibs-graphql",
        ledger: session.ledger,
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
        title: `[GraphQL] ${metadata.summary ?? "DirectDOM change"}`,
        body: `${prBody}\n\nLinked Ferrum PR: ${ferrumPrUrl}`,
        files: graphqlFiles,
        basePath: graphqlPath,
        isDraft: true,
        labels: [...labels, "graphql"],
        octokit,
      });
    } catch {
      graphqlPrUrl = undefined;
    }
  }

  return {
    ferrumPrUrl,
    graphqlPrUrl,
    message: `Created ${graphqlPrUrl ? "2" : "1"} draft PR(s)`,
  };
};

export {
  parseStoriesFromRepo,
  mergeRegistry,
  parseTailwindAllowlist,
  parseDibsCssClassesFromRepo,
} from "./registry-builder.js";
