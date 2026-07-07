import { z } from "zod";

export const ConfidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const BoundingBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BoundingBox = z.infer<typeof BoundingBoxSchema>;

export const ElementSnapshotSchema = z.object({
  tagName: z.string(),
  textContent: z.string().optional(),
  className: z.string().optional(),
  attributes: z.record(z.string()).optional(),
  computedStyles: z
    .object({
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      fontSize: z.string().optional(),
      fontWeight: z.string().optional(),
      padding: z.string().optional(),
      margin: z.string().optional(),
    })
    .optional(),
  outerHTML: z.string().optional(),
});
export type ElementSnapshot = z.infer<typeof ElementSnapshotSchema>;

export const PatchTypeSchema = z.enum([
  "textContent",
  "className",
  "attribute",
  "swapElement",
]);
export type PatchType = z.infer<typeof PatchTypeSchema>;

const DOM_PATCH_TYPES = [
  "textContent",
  "className",
  "attribute",
  "swapElement",
] as const;

const PATCH_TYPE_ALIASES: Record<string, (typeof DOM_PATCH_TYPES)[number]> = {
  text: "textContent",
  textcontent: "textContent",
  innertext: "textContent",
  innerhtml: "textContent",
  content: "textContent",
  copy: "textContent",
  class: "className",
  classname: "className",
  classes: "className",
  tailwind: "className",
  css: "className",
  style: "className",
  attr: "attribute",
  swap: "swapElement",
  swapelement: "swapElement",
  component: "swapElement",
  replaceelement: "swapElement",
};

const isDomPatchType = (
  value: string,
): value is (typeof DOM_PATCH_TYPES)[number] =>
  (DOM_PATCH_TYPES as readonly string[]).includes(value);

/** Coerce common LLM patch shapes into the DomPatch discriminated union. */
export const normalizeDomPatch = (raw: unknown): unknown => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return raw;
  }

  const obj = { ...(raw as Record<string, unknown>) };
  let type = typeof obj.type === "string" ? obj.type : undefined;

  if (type) {
    const alias = PATCH_TYPE_ALIASES[type.toLowerCase()];
    if (alias) {
      type = alias;
    } else {
      const caseMatch = DOM_PATCH_TYPES.find(
        (patchType) => patchType.toLowerCase() === type!.toLowerCase(),
      );
      if (caseMatch) {
        type = caseMatch;
      }
    }
  }

  if (!type || !isDomPatchType(type)) {
    if (obj.componentName || obj.component) {
      type = "swapElement";
    } else if (obj.name !== undefined && obj.value !== undefined) {
      type = "attribute";
    } else if (obj.mode !== undefined || obj.className !== undefined) {
      type = "className";
    } else if (obj.value !== undefined) {
      type = "textContent";
    }
  }

  if (!type) {
    return raw;
  }

  obj.type = type;

  if (type === "swapElement" && !obj.componentName && typeof obj.component === "string") {
    obj.componentName = obj.component;
  }

  if (type === "className") {
    if (!obj.value && typeof obj.className === "string") {
      obj.value = obj.className;
    }
    if (!obj.value && typeof obj.classes === "string") {
      obj.value = obj.classes;
    }
  }

  if (type === "textContent") {
    if (!obj.value && typeof obj.text === "string") {
      obj.value = obj.text;
    }
    if (!obj.value && typeof obj.textContent === "string") {
      obj.value = obj.textContent;
    }
  }

  if (type === "attribute") {
    if (!obj.name && typeof obj.attribute === "string") {
      obj.name = obj.attribute;
    }
    if (!obj.name && typeof obj.attr === "string") {
      obj.name = obj.attr;
    }
  }

  return obj;
};

export const DomPatchSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("textContent"),
    value: z.string(),
  }),
  z.object({
    type: z.literal("className"),
    value: z.string(),
    mode: z.enum(["replace", "merge"]).default("replace"),
  }),
  z.object({
    type: z.literal("attribute"),
    name: z.string(),
    value: z.string(),
  }),
  z.object({
    type: z.literal("swapElement"),
    componentName: z.string(),
    props: z.record(z.unknown()).optional(),
    html: z.string().optional(),
  }),
]);
export type DomPatch = z.infer<typeof DomPatchSchema>;

export const parseDomPatch = (
  raw: unknown,
): { success: true; data: DomPatch } | { success: false; error: z.ZodError } => {
  const result = DomPatchSchema.safeParse(normalizeDomPatch(raw));
  if (result.success) {
    return result;
  }
  return result;
};

export const ChangeTargetSchema = z.object({
  selector: z.string(),
  xpath: z.string().optional(),
  reactFiberHint: z.string().optional(),
  storybookId: z.string().optional(),
  boundingBox: BoundingBoxSchema,
});
export type ChangeTarget = z.infer<typeof ChangeTargetSchema>;

export const ChangeRecordSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  intent: z.string(),
  target: ChangeTargetSchema,
  before: ElementSnapshotSchema,
  after: ElementSnapshotSchema,
  patch: DomPatchSchema,
  confidence: ConfidenceSchema,
});
export type ChangeRecord = z.infer<typeof ChangeRecordSchema>;

export const EnvironmentSchema = z.enum(["qa", "stage", "prod", "unknown"]);
export type Environment = z.infer<typeof EnvironmentSchema>;

export const SessionMetadataSchema = z.object({
  jiraProjectKey: z.string().min(1),
  jiraTicketKeys: z.array(z.string()).optional(),
  jiraIssueType: z.string().default("Task"),
  googleDocId: z.string().optional(),
  googleDocUrl: z.string().optional(),
  figmaUrl: z.string().optional(),
  summary: z.string().optional(),
});
export type SessionMetadata = z.infer<typeof SessionMetadataSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  pageUrl: z.string(),
  hostname: z.string(),
  environment: EnvironmentSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
  ledger: z.array(ChangeRecordSchema),
  metadata: SessionMetadataSchema.optional(),
  userId: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

export const GraphqlImpactSchema = z.enum([
  "none",
  "query-only",
  "schema-change",
]);
export type GraphqlImpact = z.infer<typeof GraphqlImpactSchema>;

export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  patch: DomPatchSchema.optional(),
  changeRecord: ChangeRecordSchema.optional(),
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
  selectedSelector: z.string().optional(),
  elementSnapshot: ElementSnapshotSchema.optional(),
  pageUrl: z.string(),
  boundingBox: BoundingBoxSchema.optional(),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

export const CreateSessionRequestSchema = z.object({
  pageUrl: z.string().url(),
  hostname: z.string(),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const ContinueRequestSchema = z.object({
  metadata: SessionMetadataSchema,
});
export type ContinueRequest = z.infer<typeof ContinueRequestSchema>;

export const JobStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobStepSchema = z.object({
  name: z.string(),
  status: JobStatusSchema,
  message: z.string().optional(),
  url: z.string().optional(),
});
export type JobStep = z.infer<typeof JobStepSchema>;

export const SubmitJobSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  status: JobStatusSchema,
  steps: z.array(JobStepSchema),
  graphqlImpact: GraphqlImpactSchema.optional(),
  ferrumPrUrl: z.string().optional(),
  graphqlPrUrl: z.string().optional(),
  jiraTicketUrl: z.string().optional(),
  googleDocUrl: z.string().optional(),
  error: z.string().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SubmitJob = z.infer<typeof SubmitJobSchema>;

export const ComponentRegistryEntrySchema = z.object({
  name: z.string(),
  importPath: z.string(),
  storybookId: z.string().optional(),
  storybookUrl: z.string().optional(),
  propsSchema: z.record(z.unknown()).optional(),
});
export type ComponentRegistryEntry = z.infer<
  typeof ComponentRegistryEntrySchema
>;

export const ComponentRegistrySchema = z.object({
  version: z.string(),
  components: z.array(ComponentRegistryEntrySchema),
  tailwindAllowlist: z.array(z.string()).optional(),
});
export type ComponentRegistry = z.infer<typeof ComponentRegistrySchema>;

export const GOOGLE_DOC_TEMPLATE_ID =
  "1i9TTXYwjwcTf81L2zdGch_n8VtI2tqmqwvsC4tyNkqo";

export const FERRUM_REPO = "1stdibs/ferrum";
export const GRAPHQL_REPO = "1stdibs/dibs-graphql";
export const DEFAULT_BASE_BRANCH = "develop";
