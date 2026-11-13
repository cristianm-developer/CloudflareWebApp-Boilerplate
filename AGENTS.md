# AI agent guidance

When asked to create a project from this boilerplate, use `cf-apps create` rather than copying files manually. Follow `docs/ai-project-creation.md` and the schema in `packages/cli/project-config.example.json` to collect requirements and create the project non-interactively.

Never put provider credentials or other secrets in a project config JSON. Do not pass `--provision` or run `cf-apps resources --yes` unless the user explicitly asked to create Cloudflare resources. Run `cf-apps doctor` after configuring a project and report any setup still required.
