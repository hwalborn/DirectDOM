import type { Session, SessionMetadata, SubmitJob } from "@directdom/shared";
import { isProdEnvironment } from "@directdom/shared";
import { runCodegen } from "@directdom/codegen";
import {
  createJob,
  getSession,
  updateJob,
  updateSession,
} from "../store/session-store.js";
import { createOrUpdateGoogleDoc } from "./google-docs.js";
import { buildFigmaChangeManifest } from "./figma-manifest.js";
import { createOrUpdateJiraTicket } from "./jira.js";
import { analyzeGraphqlImpact } from "./llm.js";
import { config, getLlmConfig } from "../config.js";

const updateStep = (
  job: SubmitJob,
  name: string,
  status: SubmitJob["steps"][0]["status"],
  message?: string,
  url?: string,
): void => {
  const existing = job.steps.find((s) => s.name === name);
  if (existing) {
    existing.status = status;
    existing.message = message;
    existing.url = url;
  } else {
    job.steps.push({ name, status, message, url });
  }
};

const executeSubmitJob = async (
  sessionId: string,
  job: SubmitJob,
): Promise<SubmitJob> => {
  const session = getSession(sessionId);
  if (!session?.metadata) {
    throw new Error("Session not found or metadata missing");
  }

  job.status = "running";
  updateJob(job);

  updateStep(job, "Analyze GraphQL impact", "running");
  const graphqlImpact = await analyzeGraphqlImpact(
    session.ledger,
    session.pageUrl,
  );
  job.graphqlImpact = graphqlImpact;
  updateStep(job, "Analyze GraphQL impact", "completed", graphqlImpact);
  updateJob(job);

  updateStep(job, "Generate code & create PRs", "running");
  const codegenResult = await runCodegen({
    session,
    metadata: session.metadata,
    graphqlImpact,
    isProd: isProdEnvironment(session.environment),
    githubToken: config.github.token,
    llmConfig: getLlmConfig(),
    reposDir: config.reposDir,
  });

  job.ferrumPrUrl = codegenResult.ferrumPrUrl;
  job.graphqlPrUrl = codegenResult.graphqlPrUrl;
  updateStep(
    job,
    "Generate code & create PRs",
    "completed",
    codegenResult.message,
    codegenResult.ferrumPrUrl,
  );
  updateJob(job);

  updateStep(job, "Update Google Doc", "running");
  // const docResult = await createOrUpdateGoogleDoc({
  //   metadata: session.metadata,
  //   ledger: session.ledger,
  //   ferrumPrUrl: codegenResult.ferrumPrUrl,
  //   graphqlPrUrl: codegenResult.graphqlPrUrl,
  //   figmaUrl: session.metadata.figmaUrl,
  // });
  // job.googleDocUrl = docResult.docUrl;
  updateStep(
    job,
    "Update Google Doc",
    "completed",
    undefined,
    // docResult.docUrl,
  );
  updateJob(job);

  updateStep(job, "Create/update JIRA ticket", "running");
  const jiraResult = await createOrUpdateJiraTicket({
    session,
    metadata: session.metadata,
    ferrumPrUrl: codegenResult.ferrumPrUrl,
    // googleDocUrl: docResult.docUrl,
    graphqlPrUrl: codegenResult.graphqlPrUrl,
  });
  job.jiraTicketUrl = jiraResult.ticketUrl;
  updateStep(
    job,
    "Create/update JIRA ticket",
    "completed",
    jiraResult.ticketKey,
    jiraResult.ticketUrl,
  );
  updateJob(job);

  updateStep(job, "Build Figma change manifest", "running");
  // const manifest = buildFigmaChangeManifest({
  //   ledger: session.ledger,
  //   figmaUrl: session.metadata.figmaUrl,
  //   session,
  // });
  updateStep(
    job,
    "Build Figma change manifest",
    "completed",
    // `${manifest.length} bytes`,
  );

  job.status = "completed";
  updateJob(job);
  return job;
};

export const runSubmitJob = async (sessionId: string): Promise<SubmitJob> => {
  const job = createJob(sessionId);
  try {
    return await executeSubmitJob(sessionId, job);
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    updateJob(job);
    return job;
  }
};

export const startSubmitJobAsync = (sessionId: string): SubmitJob => {
  const job = createJob(sessionId);
  void executeSubmitJob(sessionId, job).catch((error) => {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    updateJob(job);
  });
  return job;
};

export const attachMetadata = (
  sessionId: string,
  metadata: SessionMetadata,
): Session | undefined => {
  const session = getSession(sessionId);
  if (!session) return undefined;
  session.metadata = metadata;
  return updateSession(session);
};
