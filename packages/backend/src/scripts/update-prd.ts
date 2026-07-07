import "../load-env.js";
import { DIRECTDOM_PRD_DOC_ID } from "../services/prd-content.js";
import {
  hasGoogleDocsAuth,
  populatePrdDocument,
} from "../services/prd-populate.js";

const docId =
  process.argv[2]?.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] ??
  process.argv[2] ??
  process.env.PRD_DOC_ID ??
  DIRECTDOM_PRD_DOC_ID;

const main = async (): Promise<void> => {
  if (!hasGoogleDocsAuth()) {
    console.error(
      "Google Docs auth not configured. Set one of:\n" +
        "  GOOGLE_REFRESH_TOKEN (+ GOOGLE_CLIENT_ID/SECRET)\n" +
        "  GOOGLE_SERVICE_ACCOUNT_JSON\n" +
        "  GOOGLE_ACCESS_TOKEN (+ GOOGLE_CLIENT_ID/SECRET)",
    );
    process.exit(1);
  }

  console.log(`Populating PRD document: ${docId}`);
  const result = await populatePrdDocument(docId);
  console.log(`✅ Updated ${result.replacementCount} template sections`);
  console.log(result.docUrl);
};

main().catch((err) => {
  console.error("❌ PRD update failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
