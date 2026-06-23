# Contributing to Almirant Self-Hosted

Thanks for your interest in contributing. This document covers how to report issues, propose changes, and submit pull requests.

## Before you start

1. Read our [Code of Conduct](./CODE_OF_CONDUCT.md)
2. Understand our [License](./LICENSE) (BSL 1.1)
3. Sign the [Contributor License Agreement](./CLA.md) when you open your first PR

The CLA is signed automatically via a bot when you open a pull request. You only sign once; future PRs are covered.

## Ways to contribute

### Report a bug

Open an issue using the Bug Report template. Include:

- Version of Almirant you are running
- Steps to reproduce
- Expected vs actual behavior
- Logs or screenshots if relevant

### Request a feature

Open an issue using the Feature Request template. Describe:

- The problem you are trying to solve
- Why existing features are not enough
- How you imagine the solution

### Submit a pull request

1. Fork the repo and create a branch from `main`
2. Make your changes following the project conventions
3. Add tests when applicable
4. Run `bun run lint` and `bun run type-check` before pushing
5. Open the PR against `main` with a clear description

## Development setup

> Coming soon. Will be documented before the first public release.

```bash
# Expected workflow:
git clone https://github.com/almirant-ai/almirant.git
cd almirant
bun install
docker compose up -d postgres
bun run dev
```

## Commit conventions

We use [Conventional Commits](https://www.conventionalcommits.org/). Examples:

- `feat: add invitation links to settings page`
- `fix: resolve race condition in work item drag`
- `docs: update self-hosting guide for v1.2`
- `refactor: extract permission checker to shared package`
- `test: cover edge cases in planning pipeline`

## PR review process

- A maintainer will review within 5 business days
- CI must pass (lint, type-check, tests)
- CLA must be signed
- At least one maintainer approval required before merge
- Squash merge is the default

## What we do NOT accept

- Changes that only reformat code without functional value
- Dependencies with incompatible licenses (GPL, AGPL)
- Code copied from commercial products or incompatible open-source projects
- Contributions that duplicate existing features without clear improvement

## Questions?

Open a GitHub Discussion or email **<hello@almirant.ai>**.
