import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import {
  ChatRequestSchema,
  ContinueRequestSchema,
  CreateSessionRequestSchema,
  ChangeRecordSchema,
} from "@directdom/shared";
import { config } from "./config.js";
import { generatePatch } from "./services/llm.js";
import {
  appendLedgerRecord,
  createSession,
  getJob,
  getSession,
} from "./store/session-store.js";
import { attachMetadata, startSubmitJobAsync } from "./services/submit-job.js";
import { getRegistry } from "./services/registry.js";

const app = Fastify({ logger: true });

await app.register(cors, { origin: true });
await app.register(websocket);

app.get("/health", async () => ({ status: "ok" }));

app.get("/registry", async () => getRegistry());

app.post("/sessions", async (request, reply) => {
  const parsed = CreateSessionRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const session = createSession(parsed.data.pageUrl, parsed.data.hostname);
  return session;
});

app.get("/sessions/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: "Session not found" });
  return session;
});

app.post("/sessions/:id/ledger", async (request, reply) => {
  const { id } = request.params as { id: string };
  const body = request.body as { record: unknown };
  const parsed = ChangeRecordSchema.safeParse(body.record);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const session = appendLedgerRecord(id, parsed.data);
  if (!session) return reply.status(404).send({ error: "Session not found" });
  return session;
});

app.post("/sessions/:id/continue", async (request, reply) => {
  const { id } = request.params as { id: string };
  const parsed = ContinueRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }
  const session = attachMetadata(id, parsed.data.metadata);
  if (!session) return reply.status(404).send({ error: "Session not found" });
  return session;
});

app.post("/sessions/:id/submit", async (request, reply) => {
  const { id } = request.params as { id: string };
  const session = getSession(id);
  if (!session) return reply.status(404).send({ error: "Session not found" });
  if (!session.metadata) {
    return reply
      .status(400)
      .send({ error: "Metadata required. Call /continue first." });
  }
  if (session.ledger.length === 0) {
    return reply.status(400).send({ error: "No changes in ledger" });
  }
  const job = startSubmitJobAsync(id);
  return { jobId: job.id };
});

app.get("/jobs/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const job = getJob(id);
  if (!job) return reply.status(404).send({ error: "Job not found" });
  return job;
});

app.post("/chat", async (request, reply) => {
  const parsed = ChatRequestSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({ error: parsed.error.message });
  }

  const session = getSession(parsed.data.sessionId);
  if (!session) return reply.status(404).send({ error: "Session not found" });

  try {
    const result = await generatePatch({
      message: parsed.data.message,
      elementSnapshot: parsed.data.elementSnapshot,
      selectedSelector: parsed.data.selectedSelector,
      ledger: session.ledger,
    });
    return result;
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({ error: "Internal server error" });
  }
});

app.register(async (fastify) => {
  fastify.get("/ws/chat", { websocket: true }, (socket) => {
    socket.on("message", async (raw) => {
      try {
        const data = JSON.parse(raw.toString()) as {
          sessionId: string;
          message: string;
          selectedSelector?: string;
          elementSnapshot?: unknown;
        };
        const session = getSession(data.sessionId);
        if (!session) {
          socket.send(JSON.stringify({ error: "Session not found" }));
          return;
        }
        const result = await generatePatch({
          message: data.message,
          elementSnapshot: data.elementSnapshot as Parameters<
            typeof generatePatch
          >[0]["elementSnapshot"],
          selectedSelector: data.selectedSelector,
          ledger: session.ledger,
        });
        socket.send(JSON.stringify(result));
      } catch (error) {
        socket.send(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown error",
          }),
        );
      }
    });
  });
});

const start = async (): Promise<void> => {
  try {
    await app.listen({ port: config.port, host: "0.0.0.0" });
    console.log(
      `DirectDOM backend listening on http://localhost:${config.port}`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
