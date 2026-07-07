export const DIRECTDOM_PRD_DOC_ID = "1uhHRb8Rg8IsUVasQX2I0xrbwYiiRSgFAswv5wDAvrO8";

export type PrdTextReplacement = {
  find: string;
  replace: string;
  matchCase?: boolean;
};

/**
 * replaceAllText requests for the 1stDibs PRD template.
 * Order matters when one find string is a substring of another — longer/more-specific first.
 */
export const DIRECTDOM_PRD_REPLACEMENTS: PrdTextReplacement[] = [
  {
    find: "PRD: (Project/Solution Name)",
    replace: "PRD: DirectDOM — Live DOM Edit → Workflow Automation",
  },
  {
    find: "KR: Grow 90D 2nd-purchase rate from 20% to X%",
    replace:
      "KR: Reduce time-to-PR for small front-end changes (copy, color, attributes) from ~2 weeks to same-day draft PRs",
  },
  {
    find:
      "CPS: “As a seller, I need … to efficiently upload and update my inventory…”",
    replace:
      "CPS: “As a product/design/engineering stakeholder, I need to preview UI changes on live staging pages and automatically sync them to PRD, JIRA, and code so we can skip manual handoffs for small changes.”",
  },
  {
    find: "Quarter (ex. Q2 2026)",
    replace: "Quarter: Q3 2026",
  },
  {
    find:
      "What is the problem you are trying to solve or opportunity you are aiming to capture? Why is it important to consumers, sellers, and 1stDibs?",
    replace:
      "Small UI changes (copy updates, color tweaks, attribute fixes) still follow the full feature lifecycle: PRD → design → grooming → sprint → engineering → PR → QA → release. That process takes weeks for changes that could be validated in minutes on a live page.\n\n" +
      "This slows iteration for buyers and sellers who see stale copy or suboptimal UI longer than necessary, and it consumes engineering/design/product capacity on low-risk edits.\n\n" +
      "DirectDOM lets stakeholders chat-edit the live DOM on allowlisted 1stDibs apps (qa/stage/prod), then on Submit syncs a structured change bundle to Google Docs (PRD), JIRA, and GitHub (draft PR in ferrum and optionally dibs-graphql).",
  },
  {
    find:
      "Describe briefly the approach you’re taking to solve this problem. This should be enough for the reader to imagine possible solution directions and get a very rough sense of the scope of this project.",
    replace:
      "Chrome MV3 extension (side panel chat + element picker + content script) paired with a cloud backend.\n\n" +
      "Flow:\n" +
      "1. User opens DirectDOM on an allowlisted 1stDibs page and picks an element.\n" +
      "2. User describes a change in chat; backend LLM returns a schema-validated DOM patch.\n" +
      "3. Content script applies the patch live; changes accumulate in an immutable change ledger.\n" +
      "4. User clicks Continue → enters JIRA project key, optional Google Doc / Figma links.\n" +
      "5. Submit runs an async job: GraphQL impact analysis → codegen + draft PR(s) → Google Doc update → JIRA ticket → Figma change manifest.\n\n" +
      "Month 1 scope: text, className/Tailwind, attribute, and design-system-aware swapElement patches. Figma auto-edit deferred; manifest + deep link only.",
  },
  {
    find:
      "What is your hypothesis for solving the problem or capturing the opportunity? E.g. We believe that for will because.",
    replace:
      "We believe that for product, design, and engineering stakeholders working on small UI changes, a chat-driven live DOM editor with automated codegen and workflow sync will reduce cycle time from weeks to hours because:\n\n" +
      "• Changes can be validated in-context on real staging/prod pages before any code is written.\n" +
      "• An immutable change ledger gives codegen deterministic input (intent, selector, before/after, patch).\n" +
      "• Integrations (Google Docs, JIRA, GitHub) are updated in one Submit action instead of manual handoffs.\n" +
      "• Draft PRs with confidence scoring keep humans in the loop while eliminating repetitive setup work.",
  },
  {
    find:
      "Target user segments and critical user journeys for each user segment. This is an opportunity to highlight user groups most likely to benefit from the feature, and how they’ll likely benefit from it.\n\nWhat is the affected audience of this problem / intended solution (if tested, will this size audience reach power in a reasonable period of time)? What types of users or flows? Include the affected audience as a % of sessions, users, or orders. For more details please see Analytics <> AB Testing Guide.",
    replace:
      "Primary users (internal):\n" +
      "• Product managers — validate copy/UX hypotheses on live pages; auto-update PRD sections.\n" +
      "• Designers — preview visual changes in real context before Figma updates.\n" +
      "• Front-end engineers — receive draft PRs with structured change records instead of vague tickets.\n" +
      "• QA — linked JIRA tickets with acceptance criteria stubs and PR links.\n\n" +
      "Critical journeys:\n" +
      "• Copy fix on checkout/admin flows (qa/stage first, prod with guardrails).\n" +
      "• Color/spacing tweak using Tailwind tokens from the Ferrum design system.\n" +
      "• Attribute/aria-label accessibility fixes.\n\n" +
      "This is an internal tooling project, not a buyer/seller-facing A/B test. Success is measured by adoption among FE/product/design and reduction in time-to-draft-PR for eligible change types.",
  },
  {
    find:
      "What evidence do you have? Include any internal background for the project such as any relevant metrics and user research.",
    replace:
      "• Feature lifecycle at 1stDibs spans 10+ steps from PRD to release; small changes often wait for full sprint capacity.\n" +
      "• Ferrum (1stdibs/ferrum) + dibs-graphql monorepo pattern; Storybook at adminv2.1stdibs.com/internal/style-guide.\n" +
      "• Existing PRD template (Google Doc) and JIRA workflow are established; DirectDOM integrates with both rather than replacing them.\n" +
      "• Prototype built: Chrome extension + backend with mock and live integration paths; dogfood script validates end-to-end API flow.",
  },
  {
    find: "Figma (;) Not Started",
    replace: "Figma: Change manifest + deep link (auto-edit deferred to v2)",
  },
  {
    find:
      "Details of the features at a sufficient level of detail to design the UX and build the feature. Any new buyer/seller policies required?",
    replace:
      "Extension (packages/extension):\n" +
      "• Side panel chat UI with element picker (⊕), change ledger, undo, Continue/Submit.\n" +
      "• Content script applies patches: textContent, className (Tailwind allowlist), attribute, swapElement (registry-only).\n" +
      "• Host allowlist: adminv2.{qa,stage}.1stdibs.com, {qa,stage}.1stdibs.com, intranet variants, adminv2.1stdibs.com, 1stdibs.com.\n" +
      "• Prod guardrails: confirmation dialog before Submit; draft PRs tagged prod-origin.\n\n" +
      "Backend (packages/backend):\n" +
      "• Fastify API: sessions, chat→patch LLM, ledger, Continue metadata, async Submit jobs.\n" +
      "• Integrations: Google Docs (template copy + append), JIRA REST, GitHub via codegen.\n\n" +
      "Codegen (packages/codegen):\n" +
      "• Clone ferrum + dibs-graphql at develop; GraphQL impact: none | query-only | schema-change.\n" +
      "• ts-morph for textContent edits; LLM fallback for complex swaps.\n" +
      "• Draft PRs: directdom/{session-id}-{slug} → develop.\n\n" +
      "No new buyer/seller policies. Internal tool only; no customer-facing rollout.",
  },
  {
    find: "What related features aren’t part of the project?",
    replace:
      "• Full PRD semantic rewrite by LLM without human review (v2).\n" +
      "• Figma node-level auto-editing (v2 — v1 is manifest + link only).\n" +
      "• Multi-page / multi-tab edit sessions.\n" +
      "• Full page layout redesign or new feature scaffolding.\n" +
      "• Sprint automation, auto-merge, or production deploy from extension.\n" +
      "• OAuth login flow in extension (planned; mock mode for month 1 dev).",
  },
  {
    find:
      "Any controversial topics for the project, and how they are mitigated for the experiment.",
    replace:
      "• Prod edits — mitigated by allowlist, Submit confirmation on prod, draft PRs only.\n" +
      "• Codegen accuracy — mitigated by confidence scores, component registry, Tailwind allowlist, draft PR + human review.\n" +
      "• LLM hallucination — mitigated by Zod-validated patch schema; invalid patches rejected client-side.\n" +
      "• Integration secrets in extension — mitigated by cloud backend; extension never holds GitHub/JIRA/Google tokens.",
  },
  {
    find:
      "How will success be measured during the experiment? Metrics targeting change should be inherent to the hypothesis statement above. A reminder that test success should be based off of primary metrics, and therefore should include exit criteria. For more details please seeAnalytics <> AB Testing Guide.",
    replace:
      "DirectDOM is internal tooling — not an A/B test. Success metrics:",
  },
  {
    find: "{metric name} | {exit criteria}",
    replace: "Time from live edit to draft PR | ≤ 4 hours for text/attribute changes",
  },
  {
    find: "{metric name}",
    replace: "Dogfood pass rate (end-to-end Submit job) | 100% in mock mode; ≥ 1 real change to draft PR in staging",
  },
  {
    find: "Test Type: Select Option",
    replace: "Test Type: Internal tooling pilot (not A/B)",
  },
  {
    find:
      "Does this require an A/B test on another platform or is it a direct rollout? Please clarify if this update is a dependency for launch cross-platform. Include relevant details and link the cross-platform PRD where applicable.",
    replace:
      "N/A — internal Chrome extension + cloud backend. No buyer/seller app changes. Web-only (Ferrum admin + public site). iOS parity not applicable.",
  },
];
