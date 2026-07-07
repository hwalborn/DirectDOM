import { describe, it, expect } from "vitest";
import { buildFigmaChangeManifest } from "../services/figma-manifest.js";
import type { Session, ChangeRecord } from "@directdom/shared";

describe("figma manifest", () => {
  it("builds manifest from ledger", () => {
    const session: Session = {
      id: "test-session",
      pageUrl: "https://qa.1stdibs.com/page",
      hostname: "qa.1stdibs.com",
      environment: "qa",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ledger: [],
    };

    const record: ChangeRecord = {
      id: "r1",
      timestamp: Date.now(),
      intent: "Change button text",
      target: {
        selector: "[data-testid=save]",
        boundingBox: { x: 0, y: 0, width: 100, height: 40 },
      },
      before: { tagName: "button", textContent: "Save" },
      after: { tagName: "button", textContent: "Submit" },
      patch: { type: "textContent", value: "Submit" },
      confidence: "high",
    };

    const manifest = JSON.parse(
      buildFigmaChangeManifest({ ledger: [record], session }),
    );

    expect(manifest.sessionId).toBe("test-session");
    expect(manifest.changes).toHaveLength(1);
    expect(manifest.changes[0].intent).toBe("Change button text");
  });
});
