# Creating a project with an AI agent

`cf-apps create` is the supported way for an AI coding agent to generate a project from this boilerplate. The agent can discuss requirements with you, prepare a non-secret JSON configuration, run the CLI, install dependencies, and check the result. It should follow this guide and the schema in [`../packages/cli/project-config.example.json`](../packages/cli/project-config.example.json).

## What the agent should ask

Before generating files, the agent should collect or infer from your request:

- Project name and destination directory.
- Production domain, if already chosen.
- Optional modules to enable: `stripe`, `google-play`, `openrouter`, `resend`, and `flutter`.
- Preview branch name and Cloudflare resource names, only if they differ from the defaults.
- Whether you are asking only for project files or also explicitly authorizing Cloudflare resource creation.

The agent should not ask for provider credentials to put in the project config. Those credentials are added later as ignored local `.dev.vars` values or as secrets in the appropriate Cloudflare environment.

## Recommended prompt

Open this boilerplate repository in your AI coding agent and adapt this prompt:

> Create a new project from this Cloudflare Apps boilerplate at `../my-app`. Use `my-app` as the project name, `app.example.com` as its production domain, and enable Stripe and Resend. Follow `docs/ai-project-creation.md` and the schema in `packages/cli/project-config.example.json`. Ask me about any missing project choices. Generate the project with `cf-apps create`, install dependencies, run `cf-apps doctor`, and report remaining setup steps. Do not create Cloudflare resources unless I explicitly ask. Do not put credentials or secrets in the config.

If you want the agent to create Cloudflare resources too, say so explicitly and review the resource names before authorizing that step. Project generation by itself is not authorization to provision resources.

## Agent workflow

1. Confirm the destination is a new directory outside this boilerplate checkout. The CLI refuses to overwrite an existing destination.
2. Ask for any missing project choices and settle the exact module list.
3. Copy the example JSON configuration, fill only supported public project settings, and save it outside the generated project directory. Never include provider credentials, API keys, passwords, tokens, or secret values.
4. Run `cf-apps create <destination> --config-file <config-path> --yes`. Add `--provision` only after the user explicitly asks to create Cloudflare resources and Wrangler is authenticated to the intended account.
5. In the generated project, install dependencies with `pnpm install`, then run `cf-apps doctor` and the project checks/build as appropriate.
6. Report what was generated, what `doctor` found, and each remaining manual step. Do not claim that OAuth, billing, Cloudflare, or store setup is complete unless it was actually verified.

The configuration parser rejects unknown fields, including secret fields. Provider credentials belong in Git-ignored local `apps/web/.dev.vars` or Cloudflare's secret store. The CLI does not write secret values. The generated project must not contain the boilerplate repository's Git history, local secrets, or generated files.

## Example configuration and command

Start from [`../packages/cli/project-config.example.json`](../packages/cli/project-config.example.json) and update names to match the project:

```json
{
  "name": "ledger",
  "domain": "app.example.com",
  "modules": ["stripe", "resend"],
  "cloudflare": {
    "workerName": "ledger",
    "accountId": "",
    "productionBranch": "main",
    "previewBranches": ["stage"],
    "productionDatabase": "ledger-production",
    "stageDatabase": "ledger-stage",
    "productionBucket": "ledger-production",
    "stageBucket": "ledger-stage"
  }
}
```

From the boilerplate repository:

```bash
pnpm cli create ../ledger --config-file ./ledger-config.json --yes
cd ../ledger
pnpm install
pnpm cli doctor
```

If the user has explicitly authorized provisioning and the correct Wrangler account is authenticated, the create command can include `--provision`:

```bash
pnpm cli create ../ledger --config-file ./ledger-config.json --yes --provision
```

For an existing configured project, `cf-apps resources --yes` can create missing Cloudflare resources. Use it only when resource creation has been explicitly requested. It does not delete resources.
