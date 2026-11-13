# `cf-apps` CLI

The CLI generates a clean project from the boilerplate, records its choices in `.boilerplate.json`, prepares local environment examples, and checks local readiness. It never writes provider secret values. Use `create` for a new project and `init` to configure the current directory.

## Start from a cloned boilerplate

```bash
git clone <BOILERPLATE_REPOSITORY_URL> cloudflare-apps-boilerplate
cd cloudflare-apps-boilerplate
pnpm install
pnpm cli --help
pnpm cli create ../my-app --name my-app --domain app.example.com --modules stripe,resend
cd ../my-app
pnpm install
```

The `pnpm cli` script invokes the CLI package in this workspace; a global install is not needed. The destination must be a new directory outside the boilerplate repository. The CLI excludes Git history, local secrets, and generated files, sets the root package name, and configures the project. Install dependencies in the generated project before using Wrangler.

## Commands

```text
cf-apps create <directory> [options]  Generate a clean project in a new directory
cf-apps init [options]                Configure the current directory
cf-apps add <module>                  Add or record an optional module
cf-apps resources                     Check or create D1 and R2 resources
cf-apps doctor                        Check local project configuration
cf-apps --help                        Show command help
```

When working in the boilerplate checkout, prefix commands with `pnpm cli`, for example `pnpm cli doctor`. In a generated project that includes the CLI script, run `pnpm cli doctor`; otherwise run the CLI from the boilerplate checkout against the target directory with the supported command options.

`create` uses the destination folder name as the suggested project name; `--name` overrides it. Each project receives four distinct rate-limit namespace IDs because Cloudflare shares counters across Workers that reuse an ID. The destination cannot be the boilerplate repository itself or an existing directory.

## Non-interactive and AI agent use

For agents and automation, pass `--config-file <json>` with the schema in [`project-config.example.json`](./project-config.example.json), plus `--yes`:

```bash
pnpm cli create ../my-app --config-file ./my-app-config.json --yes
```

The config parser rejects unknown fields, including secret fields. Save the config outside the generated project and include only supported project settings. Provider credentials must be added later to ignored local `apps/web/.dev.vars` or the appropriate Cloudflare secret store.

For the full AI workflow, requirements checklist, example configuration, and copyable prompt, see [`../../docs/ai-project-creation.md`](../../docs/ai-project-creation.md).

## `init` and modules

`init` runs interactively in a terminal. It asks for a project name/domain, optional modules, Worker name, production and Preview branches, and production and Preview D1/R2 names. Core modules (`auth`, `tenants`, `permissions`, `quotas`, and `admin`) are always included. For automation, supply values and `--yes`:

```bash
pnpm cli init --name my-project --domain app.example.com --modules stripe,flutter --yes
pnpm cli create ../my-project --name my-project --domain app.example.com --modules stripe,flutter --yes
```

Optional modules are `stripe`, `google-play`, `openrouter`, `resend`, and `flutter`. If implementation files are absent, `init` records a selection in `plannedModules`, not as an active module. `cf-apps add <module>` activates a module only when its implementation paths exist and is idempotent. Use `cf-apps add <module> --config-only` to record an intention without claiming that integration code is present.

The CLI stays in this monorepo. Its `prepack` step builds a clean bundled template for future npm publication, so a published CLI can generate projects without a checkout of this repository.

## Cloudflare resource provisioning

Resource creation is separate from project file generation. Do not add `--provision` or run `cf-apps resources --yes` unless the user explicitly requested Cloudflare resources and Wrangler is authenticated to the intended account.

After installing dependencies and authenticating with `pnpm --filter @boilerplate/web exec wrangler login`, `cf-apps resources` checks the selected Cloudflare account and can create missing D1 databases and R2 buckets. Interactive use asks before provisioning. Automation must pass `cf-apps resources --yes` or `cf-apps init ... --yes --provision` after explicit authorization. The CLI reuses exact name matches and never deletes resources. It writes resulting D1 IDs into `apps/web/wrangler.jsonc`. If provisioning stops partway through, rerun `cf-apps resources`; already-created resources are reused.

The generated Cloudflare settings describe one Worker with production on `main` and branch Previews (including `stage`) using separate `DB` and `FILES` bindings. `init` writes resource names into `apps/web/wrangler.jsonc`; D1 IDs and rate-limit namespace IDs still need to be created and entered there. `stage` is a Preview branch, not a separate persistent Worker.

## Local environment and `doctor`

When `apps/web/.dev.vars` is missing, `init` creates it beside the Wrangler config with local `APP_ENV` and `BETTER_AUTH_URL` values plus independent random `BETTER_AUTH_SECRET` and `TENANT_CONTEXT_SECRET` values. The file is Git-ignored, and existing files are left untouched. `doctor` checks those four values only when the file exists and does not print their contents.

`doctor` checks local files and module prerequisites. It reports planned modules as not implemented. It does not contact Cloudflare, Google, Stripe, OpenRouter, or Resend. The `resources` command contacts Cloudflare through Wrangler and requires an authenticated account with Workers, D1, and R2 permissions.

## Safety

- `init` refuses to overwrite an existing `.boilerplate.json`.
- Secret values are never requested or stored. `.dev.vars.example` lists names only; local auth secrets are generated into Git-ignored `apps/web/.dev.vars`.
- Add real local secrets to `.dev.vars` and production secrets with Wrangler's secret commands.
- Review generated configuration and resource bindings before deploying.
