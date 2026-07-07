# DirectDOM

Chrome extension + cloud backend for live DOM edits on 1stDibs apps, synced to JIRA, Google Docs, and GitHub PRs.

## Architecture

```
packages/
  extension/   MV3 Chrome extension (side panel chat + content script)
  backend/     Fastify API, LLM orchestration, integration clients
  shared/      Change ledger types, patch schema, allowlist
  codegen/     Ferrum + dibs-graphql clone, patch apply, draft PRs
```

## Quick start

```bash
yarn install
yarn workspace @directdom/shared build
node packages/extension/scripts/generate-icons.mjs

# Terminal 1 — backend
cp .env.example .env
yarn dev:backend

# Terminal 2 — extension (Vite dev server + CRXJS HMR)
yarn dev:extension
```

> Uses Yarn Classic workspaces (same as ferrum). Requires Yarn 1.x (`yarn --version`).

Load the extension from `packages/extension/dist` in Chrome (`chrome://extensions` → Developer mode → Load unpacked).

## Usage

1. Open a 1stDibs page (qa/stage/prod allowlisted hosts)
2. Open DirectDOM side panel
3. Pick an element (⊕), describe a change in chat
4. Click **Continue** → enter JIRA project key and optional links
5. Click **Submit** → creates Google Doc, JIRA ticket, draft PR(s)

## Allowlisted hosts

- `adminv2.{qa,stage}.intranet.1stdibs.com`
- `adminv2.{qa,stage}.1stdibs.com`
- `{qa,stage}.intranet.1stdibs.com`
- `{qa,stage}.1stdibs.com`
- `adminv2.1stdibs.com` (prod — extra confirmation on submit)
- `1stdibs.com` / `www.1stdibs.com` (prod)

## Environment variables

See [`.env.example`](.env.example). Without API keys, the backend runs in **mock mode** (local DOM edits work; integrations return placeholder URLs).

| Variable | Purpose |
|----------|---------|
| `LLM_PROVIDER` | `openai` (default) or `anthropic` |
| `OPENAI_API_KEY` | Chat → patch + codegen (default provider) |
| `LLM_MODEL` | Override default model (`gpt-4o-mini` / `claude-haiku-4-5`) |
| `ANTHROPIC_API_KEY` | Chat → patch + codegen when `LLM_PROVIDER=anthropic` |
| `GITHUB_TOKEN` | Clone repos, create PRs |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Create/update tickets |
| `GOOGLE_CLIENT_ID/SECRET` | Docs API |

## Integrations

| Step | Service |
|------|---------|
| Live DOM edit | Chrome content script |
| Chat → patch | Backend LLM (mock fallback) |
| PRD update | Google Docs (template copy + append) |
| Tickets | JIRA REST API |
| Code | Ferrum + dibs-graphql codegen → draft PR to `develop` |
| Figma | Change manifest JSON (auto-edit deferred) |

## Repos

- Client: [1stdibs/ferrum](https://github.com/1stdibs/ferrum)
- GraphQL: [1stdibs/dibs-graphql](https://github.com/1stdibs/dibs-graphql)
- Storybook: [admin style guide](https://adminv2.1stdibs.com/internal/style-guide/)
