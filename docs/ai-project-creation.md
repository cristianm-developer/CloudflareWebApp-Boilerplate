# Creating projects with an AI agent

The CLI is the supported project-generation interface for AI agents. An agent can gather requirements conversationally, write a JSON config, and call `cf-apps create` without an interactive terminal.

## Agent workflow

1. Ask for the project name, production domain (if known), optional modules, preview branch name, and Cloudflare resource names when they differ from the defaults.
2. Confirm whether the user wants Cloudflare D1/R2 resources created now. Do not infer that permission from a request to create project files.
3. Copy [project-config.example.json](../packages/cli/project-config.example.json), fill in only those public project settings, and save it outside the new project's target directory.
4. Create the project with `pnpm cli create <new-path> --config-file <config-path> --yes`. Add `--provision` only after the user explicitly confirms Cloudflare resource creation and Wrangler is authenticated.
5. From the generated directory, run `pnpm install`, then `pnpm cli doctor` and the project build. Report any missing provider credentials; do not put secrets into the JSON config.

The config parser rejects unknown fields, including secret fields. Provider credentials belong in ignored local `.dev.vars` or Cloudflare's secret store. A generated project is created in a new directory and the CLI refuses to overwrite an existing destination.

## Example

```sh
pnpm cli create ../ledger --config-file ./ledger-config.json --yes
```

After reviewing the resource names and receiving the user's go-ahead to create them:

```sh
pnpm cli create ../ledger --config-file ./ledger-config.json --yes --provision
```

If the project already exists, provision or reconcile resources with `cf-apps resources --yes` from that project directory.
