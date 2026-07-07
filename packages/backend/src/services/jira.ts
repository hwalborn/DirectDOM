import type { ChangeRecord, Session, SessionMetadata } from "@directdom/shared";
import { config, useMockIntegrations } from "../config.js";

const authHeader = (): string =>
  `Basic ${Buffer.from(`${config.jira.email}:${config.jira.apiToken}`).toString("base64")}`;

export const createOrUpdateJiraTicket = async (params: {
  session: Session;
  metadata: SessionMetadata;
  ferrumPrUrl?: string;
  googleDocUrl?: string;
  graphqlPrUrl?: string;
}): Promise<{ ticketKey: string; ticketUrl: string }> => {
  const { session, metadata, ferrumPrUrl, googleDocUrl, graphqlPrUrl } = params;

  if (useMockIntegrations || !config.jira.apiToken) {
    const mockKey = metadata.jiraTicketKeys?.[0] ?? `${metadata.jiraProjectKey}-MOCK`;
    return {
      ticketKey: mockKey,
      ticketUrl: `${config.jira.baseUrl}/browse/${mockKey}`,
    };
  }

  const description = buildDescription(session.ledger, {
    ferrumPrUrl,
    googleDocUrl,
    graphqlPrUrl,
    sessionId: session.id,
  });

  if (metadata.jiraTicketKeys?.length) {
    const key = metadata.jiraTicketKeys[0];
    await fetch(`${config.jira.baseUrl}/rest/api/3/issue/${key}/comment`, {
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
    return {
      ticketKey: key,
      ticketUrl: `${config.jira.baseUrl}/browse/${key}`,
    };
  }

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
        summary:
          metadata.summary ??
          `DirectDOM: ${session.ledger.map((r) => r.intent).join("; ").slice(0, 80)}`,
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
    ticketUrl: `${config.jira.baseUrl}/browse/${data.key}`,
  };
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
