# Contributing

Thanks for helping improve Cloudflare Apps Boilerplate. Small, documented changes that are easy to review are the simplest to integrate.

## Before you start

- Read the [README](README.md), [architecture guide](docs/architecture.md), and the guide for the module you plan to change.
- For larger changes, open a discussion or issue first to describe the problem and proposed approach.
- Never include secrets, tokens, service credentials, `.dev.vars` files, or production data.

## Workflow

1. Create a branch from `main`.
2. Install dependencies with `pnpm install`.
3. Make the change within the existing modular structure and validate inputs with shared contracts where appropriate.
4. Add or update tests for new or corrected behavior.
5. Run the applicable checks:

   ```bash
   pnpm test
   pnpm check
   pnpm --dir packages/cli check
   ```

6. Open a pull request describing the motivation, implementation, checks performed, and any limitations or manual setup required.

Do not run remote migrations, create billable resources, or deploy to shared accounts as part of a contribution without explicit authorization from the account owner.

## API and identity changes

- Multi-tenant handlers and services must use the authorized context created by middleware. Do not authorize an operation using an unverified `tenantId` sent by the client.
- Keep admin endpoints behind authentication, an active tenant, and backend permission checks.
- Do not log secrets, cookies, JWTs, purchase tokens, or sensitive payloads.
- Configuration examples should explain what each variable needs without including real values.
- Schema changes require a new migration and instructions for applying it locally, in Preview, and in production.

## Scope and style

- Keep each module cohesive and avoid duplicating shared components, validation, or logic.
- Update documentation when commands, variables, endpoints, or architecture decisions change.
- Explain any scope expansion in the pull request.

## Contributor credits

Commit and pull request authorship remains in the repository history. If you want a public name or link in the contributor list, follow [`CONTRIBUTORS.md`](CONTRIBUTORS.md).
