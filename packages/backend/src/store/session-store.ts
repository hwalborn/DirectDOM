import type { Session, SubmitJob, ChangeRecord } from "@directdom/shared";
import { matchHostname } from "@directdom/shared";
import { v4 as uuidv4 } from "uuid";

const sessions = new Map<string, Session>();
const jobs = new Map<string, SubmitJob>();

export const createSession = (pageUrl: string, hostname: string): Session => {
  const { environment } = matchHostname(hostname);
  const now = Date.now();
  const session: Session = {
    id: uuidv4(),
    pageUrl,
    hostname,
    environment,
    createdAt: now,
    updatedAt: now,
    ledger: [],
  };
  sessions.set(session.id, session);
  return session;
};

export const getSession = (id: string): Session | undefined => sessions.get(id);

export const updateSession = (session: Session): Session => {
  session.updatedAt = Date.now();
  sessions.set(session.id, session);
  return session;
};

export const appendLedgerRecord = (
  sessionId: string,
  record: ChangeRecord,
): Session | undefined => {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  session.ledger.push(record);
  session.updatedAt = Date.now();
  return session;
};

export const createJob = (sessionId: string): SubmitJob => {
  const job: SubmitJob = {
    id: uuidv4(),
    sessionId,
    status: "pending",
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  jobs.set(job.id, job);
  return job;
};

export const getJob = (id: string): SubmitJob | undefined => jobs.get(id);

export const updateJob = (job: SubmitJob): SubmitJob => {
  job.updatedAt = Date.now();
  jobs.set(job.id, job);
  return job;
};
