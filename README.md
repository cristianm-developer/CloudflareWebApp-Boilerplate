# Cloudflare Apps Boilerplate

> Hi, welcome to my boilerplate! I built it because I kept repeating the same system for my apps. This is my personal boilerplate, and I’m sharing it in case it helps you get your projects moving faster. Good luck!

This repository is a modular starting point for SaaS applications built on Cloudflare Workers. It combines an Astro website and server-side rendering, interactive Preact components, and a Hono API in one Worker. It is a foundation to adapt for your product, not a finished SaaS. Each project must configure its own domains, secrets, plans, access rules, provider accounts, and Cloudflare resources.

## What’s included

- **Web and API:** Astro SSR, Preact, Hono, Tailwind CSS, TanStack Query, Zustand, Axios, and Zod.
- **Authentication:** Better Auth with sessions stored in D1, email/password, and optional Google OAuth.
- **Tenants and permissions:** personal tenants and organizations, with a short-lived tenant context token and server-side membership checks on protected requests.
- **Administration:** tenant, member, and billing views, plus a configuration health check for tenant administrators.
- **Cloudflare:** a Worker, D1, R2, and rate limiting configured with Wrangler for local development and Previews.
- **Optional integrations:** Stripe, Google Play Billing/RTDN, OpenRouter, and Resend.
- **Optional mobile app:** a Flutter WebView shell with a limited bridge for Google Play purchases.
- **CLI:** `cf-apps` creates and configures projects, tracks optional modules, and can prepare Cloudflare resources when explicitly requested.
- **Product quotas:** an extensible D1-backed foundation for daily, weekly, and monthly usage limits.

## Requirements

- Node.js **22.14 or later**
- pnpm **10**
- A Cloudflare account only when you are ready to provision Cloudflare resources or deploy
- Flutter only if you plan to use the mobile app

## Create your own project

The recommended flow is to clone this boilerplate, install its dependencies, and let `cf-apps create` generate a clean project in a separate directory. The generated project is independent of the boilerplate checkout.

```bash
git clone <BOILERPLATE_REPOSITORY_URL> cloudflare-apps-boilerplate
cd cloudflare-apps-boilerplate
pnpm install
pnpm cli --help
pnpm cli create ../my-app --name my-app --domain app.example.com --modules stripe,resend
```

Replace the repository URL, project name, domain, and module list with your own values. Omit `--modules` if you do not need optional integrations. The CLI uses the workspace copy of `cf-apps`, so you do not need to install it globally. The destination must be a new directory outside the boilerplate repository.

Then set up and inspect the generated project:

```bash
cd ../my-app
pnpm install
pnpm cli doctor
pnpm --filter @boilerplate/web db:bootstrap:local
pnpm dev
```

Open `http://localhost:4321`; the API health route is `GET /api/health`. Visit `/login` to try the sign-in flow. The `/admin` page requires a signed-in user with administrator permissions in the active tenant. Review the generated `.boilerplate.json`, `apps/web/wrangler.jsonc`, and environment examples before adding provider credentials or deploying.

### Ask an AI agent to create it for you

An AI coding agent can collect the project details, create the configuration, run the CLI, install dependencies, and run `cf-apps doctor`. Open the boilerplate repository in your coding agent and ask it something like:

> Create a new project from this Cloudflare Apps boilerplate in `../my-app`. Name it `my-app`, use `app.example.com` as the production domain, and enable Stripe and Resend. Follow `docs/ai-project-creation.md` and the configuration schema. Ask me for any missing project choices. Do not create or provision Cloudflare resources. After generation, install dependencies, run `cf-apps doctor`, and summarize any remaining manual setup. Never put credentials or secrets in the project config.

The agent should use `cf-apps create` rather than copying files manually. Project generation does not imply permission to create Cloudflare resources. Resource provisioning requires a separate, explicit request. See [Creating projects with an AI agent](docs/ai-project-creation.md) for the complete workflow and a reusable prompt.

## Run this boilerplate checkout locally

To work on the boilerplate itself instead of generating a separate project:

```bash
pnpm install
pnpm --filter @boilerplate/web db:bootstrap:local
pnpm dev
```

The starter repository already has its boilerplate configuration. Review [`.env.example`](.env.example) for public variables and [`apps/web/.dev.vars.example`](apps/web/.dev.vars.example) for local Worker settings. In a generated project, `cf-apps create` prepares `.boilerplate.json` and, if missing, `apps/web/.dev.vars` with random local authentication secrets. Never put secret values in `.env` or commit them to Git. The local `.dev.vars` file is Git-ignored.

## CLI commands

Run these commands from the boilerplate workspace or a generated project where the CLI package is installed:

```bash
pnpm cli create ../my-app --name my-app --domain app.example.com
pnpm cli init
pnpm cli add stripe
pnpm cli doctor
pnpm cli resources
```

`create` generates a clean project in a new directory. `init` configures the current directory. `add` records or activates an optional module when its implementation is present. `doctor` checks local files and configuration. `resources` can inspect or create D1 databases and R2 buckets through authenticated Wrangler. Creating resources is a separate Cloudflare action and should only happen when explicitly requested. See the [CLI guide](packages/cli/README.md) and [configuration example](packages/cli/project-config.example.json).

## Environments and deployment

The starter is configured for one Worker: `main` is production, and branch Previews can include `stage`. Preview uses the Worker Preview configuration with separate D1 and R2 bindings; it is not a separate persistent Worker or a database shared with production. Wrangler local mode uses its own local data.

Before the first deployment:

1. Replace sample names and IDs in [`apps/web/wrangler.jsonc`](apps/web/wrangler.jsonc).
2. Create separate D1 databases and R2 buckets for production and Preview.
3. Configure different secrets for local, Preview, and production in the appropriate stores.
4. Apply migrations explicitly to each database.
5. Configure products, plans, credentials, and webhooks for each provider you enable.

Common commands:

```bash
pnpm --filter @boilerplate/web db:migrate:local
pnpm --filter @boilerplate/web db:migrate:remote
pnpm check
pnpm deploy
```

`db:migrate:remote` uses the remote resource selected by the current Wrangler configuration. Verify the environment and database name before running it, and apply migrations to each isolated database deliberately.

## Identity and security model

Better Auth stores the primary session in a cookie and D1. After a user selects a tenant, the client requests a short-lived tenant context JWT. Protected endpoints validate both credentials, verify that the JWT subject matches the session, and re-check membership, status, role, and permission version in D1. A `tenantId` chosen by the browser does not grant access.

Authorization is enforced by the backend; hiding UI controls is not a substitute. Cloudflare rate limiting protects request volume, while D1 quotas meter product usage. Payment webhooks and mobile purchases have their own validation paths. Configure and review provider secrets and resources before using these integrations in production.

The admin health check reports whether selected bindings and configuration values are present and have a basic valid format. It does not contact providers, query D1/R2, or confirm migrations. A “Configured” status does not prove availability or complete security. Read the [architecture guide](docs/architecture.md), [quota module guide](api/modules/quotas/README.md), and [billing guide](api/modules/billing/README.md) before adapting these modules.

## Development and contributions

```bash
pnpm test
pnpm check
pnpm --dir packages/cli check
```

Unit tests do not require provider credentials. Manual checks for Cloudflare, OAuth, Stripe, and Google Play require isolated accounts and configuration. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a change. To opt in to a public name or link in the contributor list, follow [`CONTRIBUTORS.md`](CONTRIBUTORS.md).

## License

This project is distributed under the [MIT License](LICENSE). Third-party dependencies and services have their own licenses and terms.
