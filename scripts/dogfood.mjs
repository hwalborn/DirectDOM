/**
 * End-to-end dogfood script — exercises the full API flow in mock mode.
 * Run: node scripts/dogfood.mjs (requires backend on localhost:3001)
 */
const API = process.env.API_URL ?? "http://localhost:3001";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const main = async () => {
  console.log("DirectDOM dogfood — starting…");

  const health = await fetch(`${API}/health`);
  assert(health.ok, "Backend health check failed");

  const sessionRes = await fetch(`${API}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pageUrl: "https://qa.1stdibs.com/test-page",
      hostname: "qa.1stdibs.com",
    }),
  });
  assert(sessionRes.ok, "Create session failed");
  const session = await sessionRes.json();
  console.log("✓ Session created:", session.id);

  const chatRes = await fetch(`${API}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: session.id,
      message: 'change the text to "Submit order"',
      selectedSelector: "[data-testid=save-btn]",
      elementSnapshot: {
        tagName: "button",
        textContent: "Save order",
      },
      pageUrl: session.pageUrl,
    }),
  });
  assert(chatRes.ok, "Chat failed");
  const chat = await chatRes.json();
  assert(chat.patch?.type === "textContent", "Expected textContent patch");
  console.log("✓ Chat returned patch:", chat.patch.value);

  const record = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    intent: 'change the text to "Submit order"',
    target: {
      selector: "[data-testid=save-btn]",
      boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    },
    before: { tagName: "button", textContent: "Save order" },
    after: { tagName: "button", textContent: "Submit order" },
    patch: chat.patch,
    confidence: "high",
  };

  await fetch(`${API}/sessions/${session.id}/ledger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record }),
  });
  console.log("✓ Ledger record appended");

  await fetch(`${API}/sessions/${session.id}/continue`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      metadata: {
        jiraProjectKey: "FE",
        jiraIssueType: "Task",
        summary: "Dogfood: change Save to Submit",
      },
    }),
  });
  console.log("✓ Metadata attached");

  const submitRes = await fetch(`${API}/sessions/${session.id}/submit`, {
    method: "POST",
  });
  assert(submitRes.ok, "Submit failed");
  const { jobId } = await submitRes.json();
  console.log("✓ Submit job started:", jobId);

  let job;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const jobRes = await fetch(`${API}/jobs/${jobId}`);
    job = await jobRes.json();
    if (job.status === "completed" || job.status === "failed") break;
  }

  assert(job?.status === "completed", `Job failed: ${job?.error}`);
  assert(job.ferrumPrUrl, "Missing Ferrum PR URL");
  assert(job.jiraTicketUrl, "Missing JIRA URL");
  assert(job.googleDocUrl, "Missing Google Doc URL");

  console.log("\n✅ Dogfood complete!");
  console.log("  Ferrum PR:", job.ferrumPrUrl);
  console.log("  JIRA:", job.jiraTicketUrl);
  console.log("  Google Doc:", job.googleDocUrl);
  console.log("  GraphQL impact:", job.graphqlImpact);
};

main().catch((err) => {
  console.error("❌ Dogfood failed:", err.message);
  process.exit(1);
});
