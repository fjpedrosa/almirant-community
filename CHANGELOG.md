# Changelog

All notable changes to Almirant Self-Hosted will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Scheduled agent dispatch is now backend-authoritative by default.**
  `SCHEDULED_AGENT_DISPATCHER_ENABLED` now defaults to `true` (was `false`):
  fresh self-hosted installs dispatch scheduled agents from the backend
  instead of from the runner's own scheduler tick. The runner's new
  `RUNNER_SCHEDULER_ENABLED` flag defaults OFF to match, deriving its
  default from `SCHEDULED_AGENT_DISPATCHER_ENABLED` so an existing
  self-hoster who has explicitly set the backend flag to `false` keeps the
  pre-2026-08-02 runner-only behavior with no extra configuration. See
  [`docs/self-hosting/environment.md` → Scheduled agent dispatch
  authority](docs/self-hosting/environment.md#scheduled-agent-dispatch-authority)
  for the full compatibility matrix and how to opt back out.

### Added

- Initial repository bootstrap (LICENSE, CLA, CODE_OF_CONDUCT, SECURITY, README, CONTRIBUTING)
- GitHub templates for issues and pull requests
- Design document for the self-hosted edition
- Placeholder docker-compose.yml with Postgres
- Scaffolding for self-hosting documentation
- `.env.example` with ~27 documented variables across DB, Auth, OAuth, SMTP, LLM, GitHub App, Telemetry, Runner, Operational
- `scripts/entrypoint.sh` with auth-secret generation, Postgres wait, migration fail-fast, exec handoff
- `docs/self-hosting/getting-started.md` — 5-step quickstart with troubleshooting
- `docs/self-hosting/environment.md` — full env variable reference
- `docs/self-hosting/backups.md` — backup, restore, retention policies
- `docs/self-hosting/integrations/github.md` — BYO GitHub App tutorial (Coolify-style)
- `CHANGELOG.md` with Keep a Changelog format
- `.github/FUNDING.yml` with pricing link
- `.github/workflows/lint-markdown.yml` and `.markdownlint.json`
- Improved `docker-compose.yml` with Postgres healthcheck, `app-data` volume, and commented stubs for api/web/runner with `depends_on: condition: service_healthy`
- `README.md` Quickstart updated with real copy-paste commands and CHANGELOG badge
- Full Contributor Covenant 2.1 text pasted into `CODE_OF_CONDUCT.md` with `conduct@almirant.ai` as the contact
