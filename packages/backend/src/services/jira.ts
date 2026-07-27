import type { ChangeRecord, Session, SessionMetadata } from "@directdom/shared";
import { buildChangeTitle } from "@directdom/shared";
import { config, useMockIntegrations } from "../config.js";

const authHeader = (): string =>
  `Basic ${Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64")}`;

export type JiraTicketResult = {
  ticketKey: string;
  ticketUrl: string;
};

const ticketUrlFor = (key: string): string =>
  `${config.jira.baseUrl}/browse/${key}`;

export const ensureJiraTicket = async (params: {
  session: Session;
  metadata: SessionMetadata;
}): Promise<JiraTicketResult> => {
  const { session, metadata } = params;

  if (metadata.jiraTicketKeys?.length) {
    const key = metadata.jiraTicketKeys[0];
    return { ticketKey: key, ticketUrl: ticketUrlFor(key) };
  }

  if (useMockIntegrations || !config.jira.apiToken) {
    const mockKey = `${metadata.jiraProjectKey}-MOCK`;
    return { ticketKey: mockKey, ticketUrl: ticketUrlFor(mockKey) };
  }

  const summary = buildChangeTitle({
    pageUrl: session.pageUrl,
    intents: session.ledger.map((r) => r.intent),
    summary: metadata.summary,
  });

  const description = buildDescription(session.ledger, {
    sessionId: session.id,
  });

  const res = await fetch(`${config.jira.baseUrl}/rest/api/3/issue`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      fields: {
        project: { key: metadata.jiraProjectKey },
        summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: description }],
            },
          ],
        },
        issuetype: { name: metadata.jiraIssueType ?? "Task" },
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`JIRA create failed: ${err}`);
  }

  const data = (await res.json()) as { key: string };
  return {
    ticketKey: data.key,
    ticketUrl: ticketUrlFor(data.key),
  };
};

export const commentJiraTicket = async (params: {
  ticketKey: string;
  session: Session;
  ferrumPrUrl?: string;
  googleDocUrl?: string;
  graphqlPrUrl?: string;
}): Promise<void> => {
  const { ticketKey, session, ferrumPrUrl, googleDocUrl, graphqlPrUrl } =
    params;

  if (useMockIntegrations || !config.jira.apiToken) {
    return;
  }

  const description = buildDescription(session.ledger, {
    ferrumPrUrl,
    googleDocUrl,
    graphqlPrUrl,
    sessionId: session.id,
  });

  await fetch(`${config.jira.baseUrl}/rest/api/3/issue/${ticketKey}/comment`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      body: {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: description }],
          },
        ],
      },
    }),
  });
};

/** @deprecated Prefer ensureJiraTicket + commentJiraTicket for PR linking */
export const createOrUpdateJiraTicket = async (params: {
  session: Session;
  metadata: SessionMetadata;
  ferrumPrUrl?: string;
  googleDocUrl?: string;
  graphqlPrUrl?: string;
}): Promise<JiraTicketResult> => {
  const result = await ensureJiraTicket(params);
  await commentJiraTicket({
    ticketKey: result.ticketKey,
    session: params.session,
    ferrumPrUrl: params.ferrumPrUrl,
    googleDocUrl: params.googleDocUrl,
    graphqlPrUrl: params.graphqlPrUrl,
  });
  return result;
};

const buildDescription = (
  ledger: ChangeRecord[],
  links: {
    ferrumPrUrl?: string;
    googleDocUrl?: string;
    graphqlPrUrl?: string;
    sessionId: string;
  },
): string => {
  const lines = [
    `DirectDOM session: ${links.sessionId}`,
    `Page: ${ledger[0]?.target.selector ?? "n/a"}`,
    "",
    "Changes:",
    ...ledger.map(
      (r, i) =>
        `${i + 1}. ${r.intent} (${r.patch.type}, confidence: ${r.confidence})`,
    ),
  ];
  if (links.googleDocUrl) lines.push("", `Google Doc: ${links.googleDocUrl}`);
  if (links.ferrumPrUrl) lines.push(`Ferrum PR: ${links.ferrumPrUrl}`);
  if (links.graphqlPrUrl) lines.push(`GraphQL PR: ${links.graphqlPrUrl}`);
  return lines.join("\n");
};
