# Boilerplate CLI

The CLI creates a fresh project from the boilerplate, records its configuration in `.boilerplate.json`, prepares secret name examples, and checks local readiness. It does not write secret values.

## Use from this repository

```bash
node packages/cli/src/cli.js create ../my-app
node packages/cli/src/cli.js init
node packages/cli/src/cli.js add stripe
node packages/cli/src/cli.js resources
node packages/cli/src/cli.js doctor
```

Once the workspace package is linked, use `cf-apps` instead of the Node command.

## Commands

`create <directory>` copies a clean starter project into a new path, excludes Git history, local secrets and generated files, sets the root package name, then runs the setup in the new folder. The destination must not already exist and must be outside the boilerplate repository. The folder name becomes the suggested project name; `--name` can override it. It assigns four distinct rate-limit namespace IDs per project, because Cloudflare shares counters across Workers that reuse an ID. Install dependencies in the generated project with `pnpm install` before running Wrangler commands.

For AI agents and other non-interactive callers, pass `--config-file <json>` with the shape in [project-config.example.json](./project-config.example.json), plus `--yes`. The parser rejects unknown fields, so credentials cannot be passed through this config. `--provision` is separate and must only be added after the user approves creating Cloudflare resources.

The CLI stays in this monorepo. Its `prepack` step builds a clean bundled template for future npm publication, so released CLI installs can generate projects without a checkout of this repository.

`init` is interactive in a terminal. It asks for project name/domain, optional modules, Worker name, production/preview branches, and production/preview D1 and R2 names. Core modules (`auth`, `tenants`, `permissions`, `quotas`, `admin`) are always included. For automation, use `--yes` and pass values explicitly:

```bash
cf-apps init --name my-project --domain app.example.com --modules stripe,flutter --yes
cf-apps create ../my-project --name my-project --domain app.example.com --modules stripe,flutter --yes
cf-apps create ../my-project --config-file ./my-project.json --yes
```

After installing dependencies and authenticating with `pnpm --filter @boilerplate/web exec wrangler login`, run `cf-apps resources` to check the selected Cloudflare account and create only missing D1 databases and R2 buckets. The interactive command asks before provisioning; automation must pass `cf-apps resources --yes` or `cf-apps init ... --yes --provision`. It reuses exact name matches and never deletes resources. It writes the resulting D1 IDs into `apps/web/wrangler.jsonc`. If provisioning stops partway through, rerun `cf-apps resources`; already created resources are reused.

Optional modules are `stripe`, `google-play`, `openrouter`, `resend`, and `flutter`. If their implementation files are not present, `init` records selections in `plannedModules`, not as active modules. `cf-apps add <module>` only activates a module after its implementation paths exist. It is idempotent. Use `cf-apps add <module> --config-only` to record an intention without claiming the integration is implemented.

`doctor` checks local files and module prerequisites. It reports planned modules as not implemented. It does not contact Cloudflare, Google, Stripe, OpenRouter, or Resend. `resources` contacts Cloudflare through Wrangler and requires an authenticated account with Workers, D1, and R2 permissions.

The generated Cloudflare settings describe one Worker with production on `main` and branch Previews (including the `stage` branch) using separate `DB` and `FILES` bindings. `init` writes the resource names into `apps/web/wrangler.jsonc`; Cloudflare D1 IDs and rate-limit namespace IDs still need to be created and entered there. `stage` is not a separately deployed persistent Worker.

When `apps/web/.dev.vars` is absent, `init` creates it beside the Wrangler config with local `APP_ENV` and `BETTER_AUTH_URL` values plus independent random `BETTER_AUTH_SECRET` and `TENANT_CONTEXT_SECRET` values. The file is Git-ignored. Existing `apps/web/.dev.vars` files are left untouched. `doctor` checks those four values only when that file exists; it does not inspect or report their contents.

## Safety

- `init` refuses to overwrite an existing `.boilerplate.json`.
- Secret values are never requested or stored. `.dev.vars.example` contains names only; local auth secrets are generated into the Git-ignored `apps/web/.dev.vars`.
- Add real local secrets to `.dev.vars` (ignored by Git) and production secrets with Wrangler's secret commands.
- Review generated configuration and resource bindings before deploying.
