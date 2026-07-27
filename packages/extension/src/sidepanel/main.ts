import type {
  ChangeRecord,
  DomPatch,
  ElementSnapshot,
  Session,
  SessionMetadata,
  SubmitJob,
} from "@directdom/shared";
import { isProdEnvironment } from "@directdom/shared";
import {
  apiFetch,
  sendToActiveTab,
  sendToBackground,
  TabConnectionError,
  type ExtensionMessage,
} from "../lib/messaging";

type ViewId = "chat-view" | "continue-view" | "job-view";

// TODO: Advanced settings UI — LLM provider/model selection (anthropic | openai + model picker)

let session: Session | null = null;
let selectedSelector: string | null = null;
let selectedSnapshot: ElementSnapshot | null = null;
let ledger: ChangeRecord[] = [];

// mock up an easy way to get elements on the sidepanel
const $ = <T extends HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const showView = (viewId: ViewId): void => {
  document.querySelectorAll(".view").forEach((el) => {
    el.classList.toggle("view--active", el.id === viewId);
  });
};

const addMessage = (
  role: "user" | "assistant" | "error",
  content: string,
): void => {
  const container = $("chat-messages");
  const div = document.createElement("div");
  div.className = `message message--${role === "error" ? "error" : role}`;
  div.textContent = content;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
};

const updateEnvBadge = (environment: string): void => {
  const badge = $("env-badge");
  badge.textContent = environment;
  badge.className = `badge badge--${environment}`;
};

const renderLedger = (): void => {
  $("ledger-count").textContent = String(ledger.length);
  const list = $("ledger-list");
  list.innerHTML = "";

  ledger.forEach((record) => {
    const li = document.createElement("li");
    li.className = "ledger-item";
    li.innerHTML = `
      <span class="ledger-item__intent" title="${record.intent}">${record.intent}</span>
      <button type="button" class="btn btn--secondary" data-undo="${record.id}" aria-label="Undo change">Undo</button>
    `;
    list.appendChild(li);
  });

  ($("continue-btn") as HTMLButtonElement).disabled = ledger.length === 0;
};

/**
 * This grabs the context from the background page and begins a new session.
 * It's called on page load or navigate or whenever we start a new session! Nifty
 */
const initSession = async (): Promise<void> => {
  const context = await sendToBackground<
    ExtensionMessage & {
      pageUrl?: string;
      hostname?: string;
      allowed?: boolean;
      environment?: string;
    }
  >({ type: "GET_TAB_CONTEXT" });

  if (!context.allowed || !context.pageUrl) {
    addMessage("error", "This page is not on the DirectDOM allowlist.");
    updateEnvBadge("unknown");
    return;
  }

  updateEnvBadge(context.environment ?? "unknown");

  const res = await apiFetch("/sessions", {
    method: "POST",
    body: JSON.stringify({
      pageUrl: context.pageUrl,
      hostname: context.hostname,
    }),
  });

  if (!res.ok) {
    addMessage("error", "Failed to start session. Is the backend running?");
    return;
  }

  session = (await res.json()) as Session;
  addMessage(
    "assistant",
    "Session started. Pick an element or describe a change.",
  );
};

const handlePick = async (): Promise<void> => {
  try {
    await sendToActiveTab({ type: "START_PICKER" });
    addMessage("assistant", "Click an element on the page to select it.");
  } catch (error) {
    addMessage(
      "error",
      error instanceof TabConnectionError
        ? error.message
        : "Could not start element picker on this tab.",
    );
  }
};

/**
 * This is the main function that handles the chat input.
 * It sends the message to the backend and updates the ledger.
 */
const handleSend = async (): Promise<void> => {
  const input = $<HTMLInputElement>("chat-input");
  const message = input.value.trim();
  if (!message || !session) return;

  input.value = "";
  addMessage("user", message);

  try {
    const res = await apiFetch("/chat", {
      method: "POST",
      body: JSON.stringify({
        sessionId: session.id,
        message,
        selectedSelector: selectedSelector ?? undefined,
        elementSnapshot: selectedSnapshot ?? undefined,
        pageUrl: session.pageUrl,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      addMessage(
        "error",
        (err as { error?: string }).error ?? "Chat request failed",
      );
      return;
    }

    const data = (await res.json()) as {
      reply: string;
      patch?: DomPatch;
      changeRecord?: ChangeRecord;
    };

    addMessage("assistant", data.reply);

    if (data.patch) {
      try {
        const result = (await sendToActiveTab({
          type: "APPLY_PATCH",
          patch: data.patch,
          intent: message,
          selector: selectedSelector ?? undefined,
        })) as { changeRecord?: ChangeRecord };

        if (result?.changeRecord) {
          await apiFetch(`/sessions/${session.id}/ledger`, {
            method: "POST",
            body: JSON.stringify({ record: result.changeRecord }),
          });
        } else {
          addMessage(
            "error",
            "Patch was generated but could not be applied. Re-pick the element and try again.",
          );
        }
      } catch (error) {
        addMessage(
          "error",
          error instanceof TabConnectionError
            ? error.message
            : "Could not apply change to the page.",
        );
      }
    } else if (data.changeRecord) {
      await apiFetch(`/sessions/${session.id}/ledger`, {
        method: "POST",
        body: JSON.stringify({ record: data.changeRecord }),
      });
    }
  } catch {
    addMessage("error", "Could not reach backend.");
  }
};

const handleContinue = (): void => {
  if (ledger.length === 0) return;

  const summary = ledger
    .map((r) => r.intent)
    .join("; ")
    .slice(0, 200);
  $<HTMLInputElement>("summary").value = summary;
  showView("continue-view");
};

const handleBack = (): void => {
  showView("chat-view");
};

const handleSubmit = async (): Promise<void> => {
  if (!session) return;

  const jiraProject = $<HTMLInputElement>("jira-project").value.trim();
  if (!jiraProject) {
    alert("JIRA project key is required.");
    return;
  }

  if (isProdEnvironment(session.environment)) {
    const confirmed = confirm(
      "You are submitting changes from a PRODUCTION page. The PR will be created as a draft with a prod-origin label. Continue?",
    );
    if (!confirmed) return;
  }

  const metadata: SessionMetadata = {
    jiraProjectKey: jiraProject,
    jiraTicketKeys: $<HTMLInputElement>("jira-tickets")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    jiraIssueType: $<HTMLSelectElement>("jira-issue-type").value,
    googleDocUrl: $<HTMLInputElement>("google-doc").value.trim() || undefined,
    figmaUrl: $<HTMLInputElement>("figma-url").value.trim() || undefined,
    summary: $<HTMLInputElement>("summary").value.trim() || undefined,
  };

  showView("job-view");
  renderJobSteps([]);

  try {
    await apiFetch(`/sessions/${session.id}/continue`, {
      method: "POST",
      body: JSON.stringify({ metadata }),
    });

    const submitRes = await apiFetch(`/sessions/${session.id}/submit`, {
      method: "POST",
    });

    if (!submitRes.ok) {
      renderJobError("Submit failed");
      return;
    }

    const { jobId } = (await submitRes.json()) as { jobId: string };
    await pollJob(jobId);
  } catch {
    renderJobError("Could not reach backend.");
  }
};

const renderJobSteps = (steps: SubmitJob["steps"]): void => {
  const list = $("job-steps");
  list.innerHTML = steps
    .map(
      (step) =>
        `<li class="job-step job-step--${step.status}">${step.status === "running" ? "⏳" : step.status === "completed" ? "✓" : step.status === "failed" ? "✗" : "○"} ${step.name}${step.message ? `: ${step.message}` : ""}</li>`,
    )
    .join("");
};

const renderJobError = (message: string): void => {
  const result = $("job-result");
  result.classList.remove("hidden");
  result.innerHTML = `<p style="color:#b91c1c">${message}</p>`;
  $("new-session-btn").classList.remove("hidden");
};

const githubLinkLabel = (url: string, repo: string): string =>
  url.includes("/compare/") ? `${repo} changes` : `${repo} PR`;

const pollJob = async (jobId: string): Promise<void> => {
  const poll = async (): Promise<void> => {
    const res = await apiFetch(`/jobs/${jobId}`);
    if (!res.ok) {
      renderJobError("Failed to poll job status");
      return;
    }

    const job = (await res.json()) as SubmitJob;
    renderJobSteps(job.steps);

    if (job.status === "completed") {
      const result = $("job-result");
      result.classList.remove("hidden");
      result.innerHTML = `
        <p><strong>Done!</strong></p>
        ${job.jiraTicketUrl ? `<p><a href="${job.jiraTicketUrl}" target="_blank" rel="noopener">JIRA ticket</a></p>` : ""}
        ${job.googleDocUrl ? `<p><a href="${job.googleDocUrl}" target="_blank" rel="noopener">Google Doc</a></p>` : ""}
        ${job.ferrumPrUrl ? `<p><a href="${job.ferrumPrUrl}" target="_blank" rel="noopener">${githubLinkLabel(job.ferrumPrUrl, "Ferrum")}</a></p>` : ""}
        ${job.graphqlPrUrl ? `<p><a href="${job.graphqlPrUrl}" target="_blank" rel="noopener">${githubLinkLabel(job.graphqlPrUrl, "GraphQL")}</a></p>` : ""}
      `;
      $("new-session-btn").classList.remove("hidden");
      return;
    }

    if (job.status === "failed") {
      renderJobError(job.error ?? "Job failed");
      return;
    }

    setTimeout(poll, 1500);
  };

  await poll();
};

const handleNewSession = (): void => {
  ledger = [];
  selectedSelector = null;
  selectedSnapshot = null;
  renderLedger();
  $("chat-messages").innerHTML = "";
  $("job-result").classList.add("hidden");
  $("new-session-btn").classList.add("hidden");
  showView("chat-view");
  initSession();
};

chrome.runtime.onMessage.addListener((message: ExtensionMessage) => {
  if (message.type === "ELEMENT_SELECTED") {
    const msg = message as ExtensionMessage & {
      selector: string;
      snapshot: ElementSnapshot;
    };
    selectedSelector = msg.selector;
    selectedSnapshot = msg.snapshot;
    $("selected-element").classList.remove("hidden");
    $("selected-selector").textContent = msg.selector;
    addMessage("assistant", `Selected: ${msg.selector}`);
  }

  if (message.type === "LEDGER_UPDATE") {
    const msg = message as ExtensionMessage & { ledger: ChangeRecord[] };
    ledger = msg.ledger;
    renderLedger();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  $("pick-btn").addEventListener("click", handlePick);
  $("send-btn").addEventListener("click", handleSend);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleSend();
  });
  $("continue-btn").addEventListener("click", handleContinue);
  $("back-btn").addEventListener("click", handleBack);
  $("submit-btn").addEventListener("click", handleSubmit);
  $("new-session-btn").addEventListener("click", handleNewSession);

  $("ledger-list").addEventListener("click", async (e) => {
    const target = (e.target as HTMLElement).closest("[data-undo]");
    if (!target) return;
    const changeId = target.getAttribute("data-undo");
    if (!changeId) return;

    try {
      const result = (await sendToActiveTab({
        type: "UNDO_CHANGE",
        changeId,
      })) as { ok?: boolean };

      if (!result?.ok) {
        addMessage(
          "error",
          "Could not undo that change. The element may no longer exist.",
        );
        return;
      }

      if (session) {
        await apiFetch(`/sessions/${session.id}/ledger/${changeId}`, {
          method: "DELETE",
        });
      }
    } catch (error) {
      addMessage(
        "error",
        error instanceof TabConnectionError
          ? error.message
          : "Could not undo on this tab.",
      );
    }
  });

  initSession();
});
