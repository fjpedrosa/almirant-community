# Security Policy

## Supported Versions

Almirant Self-Hosted is pre-alpha. Once the first stable release ships, this section will list which versions receive security updates.

| Version | Supported |
|---------|-----------|
| pre-alpha | See notes below |

During the pre-alpha phase, fixes are applied to `main` only. No backports are provided.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues, Discussions, or pull requests.**

Instead, report them privately to the Almirant security team:

- **Email**: <security@almirant.ai>
- **Subject line**: `[SECURITY] Brief description`

### What to include

Please include as much of the following information as possible:

- Type of issue (e.g., SQL injection, cross-site scripting, authentication bypass)
- Full paths of source files related to the issue
- Location of the affected source code (tag, branch, commit, or direct URL)
- Step-by-step instructions to reproduce the issue
- Proof-of-concept or exploit code (if available)
- Impact of the issue, including how an attacker might exploit it

This information will help us triage your report faster.

### What to expect

- **Acknowledgement**: within 3 business days
- **Initial assessment**: within 7 business days
- **Fix timeline**: depends on severity — critical issues are prioritized
- **Public disclosure**: coordinated with the reporter after a fix is available

We follow a 90-day responsible disclosure window. Vulnerabilities are publicly disclosed once a fix is released, or after 90 days from the initial report, whichever comes first.

## Preferred Languages

We prefer reports in **English** or **Spanish**.

## Recognition

We maintain a public acknowledgements page for reporters who follow responsible disclosure. If you would prefer to remain anonymous, let us know in your report.

## Scope

In scope:

- The Almirant Self-Hosted codebase (this repository)
- Official Docker images published to `ghcr.io/almirant-ai`
- Official documentation

Out of scope:

- Third-party integrations unless the vulnerability is in Almirant's integration code
- User-modified forks
- Issues requiring physical access to a user's machine
- Social engineering attacks

---

_Last updated: 2026-04-18_
