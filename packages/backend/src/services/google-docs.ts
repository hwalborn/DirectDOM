import { google } from "googleapis";
import type { ChangeRecord, SessionMetadata } from "@directdom/shared";
import { GOOGLE_DOC_TEMPLATE_ID } from "@directdom/shared";
import { config, useMockIntegrations } from "../config.js";

const getDocsClient = () => {
  const auth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
  return google.docs({ version: "v1", auth });
};

const getDriveClient = () => {
  const auth = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );
  return google.drive({ version: "v3", auth });
};

const extractDocId = (urlOrId: string): string => {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
};

export const createOrUpdateGoogleDoc = async (params: {
  metadata: SessionMetadata;
  ledger: ChangeRecord[];
  jiraTicketUrl?: string;
  ferrumPrUrl?: string;
  graphqlPrUrl?: string;
  figmaUrl?: string;
}): Promise<{ docId: string; docUrl: string }> => {
  const { metadata, ledger, jiraTicketUrl, ferrumPrUrl, graphqlPrUrl, figmaUrl } =
    params;

  if (useMockIntegrations || !config.google.clientId) {
    const docId = metadata.googleDocUrl
      ? extractDocId(metadata.googleDocUrl)
      : GOOGLE_DOC_TEMPLATE_ID;
    return {
      docId,
      docUrl: `https://docs.google.com/document/d/${docId}/edit`,
    };
  }

  let docId = metadata.googleDocUrl
    ? extractDocId(metadata.googleDocUrl)
    : undefined;

  if (!docId) {
    const drive = getDriveClient();
    const copy = await drive.files.copy({
      fileId: config.google.docTemplateId,
      requestBody: {
        name: metadata.summary ?? `DirectDOM Change Request ${Date.now()}`,
      },
    });
    docId = copy.data.id ?? GOOGLE_DOC_TEMPLATE_ID;
  }

  const changeSection = buildChangeSection({
    ledger,
    jiraTicketUrl,
    ferrumPrUrl,
    graphqlPrUrl,
    figmaUrl,
  });

  const docs = getDocsClient();
  const doc = await docs.documents.get({ documentId: docId });
  const endIndex =
    doc.data.body?.content?.[doc.data.body.content.length - 1]?.endIndex ?? 1;

  await docs.documents.batchUpdate({
    documentId: docId,
    requestBody: {
      requests: [
        {
          insertText: {
            location: { index: endIndex - 1 },
            text: changeSection,
          },
        },
      ],
    },
  });

  return {
    docId,
    docUrl: `https://docs.google.com/document/d/${docId}/edit`,
  };
};

const buildChangeSection = (params: {
  ledger: ChangeRecord[];
  jiraTicketUrl?: string;
  ferrumPrUrl?: string;
  graphqlPrUrl?: string;
  figmaUrl?: string;
}): string => {
  const lines = [
    "\n\n---\n",
    "Change Request (DirectDOM)\n",
    `Generated: ${new Date().toISOString()}\n\n`,
    "Changes:\n",
    ...params.ledger.map(
      (r, i) =>
        `${i + 1}. ${r.intent}\n   Selector: ${r.target.selector}\n   Type: ${r.patch.type}\n`,
    ),
    "\nLinks:\n",
  ];
  if (params.jiraTicketUrl) lines.push(`JIRA: ${params.jiraTicketUrl}\n`);
  if (params.ferrumPrUrl) lines.push(`Ferrum PR: ${params.ferrumPrUrl}\n`);
  if (params.graphqlPrUrl) lines.push(`GraphQL PR: ${params.graphqlPrUrl}\n`);
  if (params.figmaUrl) lines.push(`Figma: ${params.figmaUrl}\n`);
  lines.push("\nFigma change manifest: see JIRA ticket attachments.\n");
  return lines.join("");
};
