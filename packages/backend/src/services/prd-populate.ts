import { google } from "googleapis";
import type { docs_v1 } from "googleapis";
import { config } from "../config.js";
import {
  DIRECTDOM_PRD_REPLACEMENTS,
  type PrdTextReplacement,
} from "./prd-content.js";

const getAuthClient = () => {
  const oauth2 = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri,
  );

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (refreshToken) {
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    const credentials = JSON.parse(serviceAccountJson) as {
      client_email: string;
      private_key: string;
    };
    return new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: [
        "https://www.googleapis.com/auth/documents",
        "https://www.googleapis.com/auth/drive",
      ],
    });
  }

  return oauth2;
};

export const hasGoogleDocsAuth = (): boolean =>
  Boolean(
    process.env.GOOGLE_REFRESH_TOKEN ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||
      (config.google.clientId && process.env.GOOGLE_ACCESS_TOKEN),
  );

const buildReplaceRequests = (
  replacements: PrdTextReplacement[],
): docs_v1.Schema$Request[] =>
  replacements.map(({ find, replace, matchCase = true }) => ({
    replaceAllText: {
      containsText: { text: find, matchCase },
      replaceText: replace,
    },
  }));

export const populatePrdDocument = async (
  documentId: string,
  replacements: PrdTextReplacement[] = DIRECTDOM_PRD_REPLACEMENTS,
): Promise<{ documentId: string; docUrl: string; replacementCount: number }> => {
  const auth = getAuthClient();
  const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
  if (accessToken && auth instanceof google.auth.OAuth2) {
    auth.setCredentials({ access_token: accessToken });
  }

  const docs = google.docs({ version: "v1", auth });
  const requests = buildReplaceRequests(replacements);

  await docs.documents.batchUpdate({
    documentId,
    requestBody: { requests },
  });

  return {
    documentId,
    docUrl: `https://docs.google.com/document/d/${documentId}/edit`,
    replacementCount: replacements.length,
  };
};
