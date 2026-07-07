import type { ChangeRecord, Session } from "@directdom/shared";

export const buildFigmaChangeManifest = (params: {
  ledger: ChangeRecord[];
  figmaUrl?: string;
  session: Session;
}): string => {
  const { ledger, figmaUrl, session } = params;

  return JSON.stringify(
    {
      version: "1.0",
      sessionId: session.id,
      pageUrl: session.pageUrl,
      figmaUrl: figmaUrl ?? null,
      generatedAt: new Date().toISOString(),
      changes: ledger.map((r) => ({
        intent: r.intent,
        selector: r.target.selector,
        patchType: r.patch.type,
        before: {
          text: r.before.textContent,
          className: r.before.className,
        },
        after: {
          text: r.after.textContent,
          className: r.after.className,
        },
        storybookId: r.target.storybookId,
        reactComponent: r.target.reactFiberHint,
        boundingBox: r.target.boundingBox,
      })),
    },
    null,
    2,
  );
};
