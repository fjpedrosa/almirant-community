# Worker Production Secrets Management

This guide covers how to generate, store, and rotate the secrets required to run the Almirant worker in production.

## Required Secrets

| Variable | Description | How to Generate |
|----------|-------------|----------------|
| `MC_API_KEY` | Worker API key to authenticate with the backend | Generate in Almirant UI under Settings → API Keys |
| `DATABASE_URL` | PostgreSQL connection string (same DB as backend) | Same as `backend/api/.env.production` |
| `ANTHROPIC_API_KEY` | Anthropic API key for Claude Code jobs | [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | OpenAI API key for Codex jobs (optional) | [platform.openai.com](https://platform.openai.com) |
| `GITHUB_TOKEN` | GitHub PAT for creating pull requests | See below |

## Generating the Worker API Key

1. Start the backend: `docker-compose -f docker-compose.prod.yml up -d backend`
2. Open Almirant UI → Settings → API Keys → New API Key
3. Copy the key and set it as `MC_API_KEY` in `worker/.env.production`
4. Verify: `MC_API_KEY=<key> MC_API_URL=http://localhost:3001 bun run mc-worker validate`

## GitHub Personal Access Token

The worker needs a GitHub token to push branches and create pull requests after completing AI jobs.

**Required permissions (fine-grained PAT):**

- Repository: Contents → Read and write
- Repository: Pull requests → Write
- Repository: Metadata → Read (automatically included)

**Steps:**

1. Go to [github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens)
2. Click "Generate new token (fine-grained)"
3. Set expiration (recommended: 1 year, rotate annually)
4. Select repositories or "All repositories" as needed
5. Grant the permissions above
6. Copy the token → set as `GITHUB_TOKEN` and `GH_TOKEN`

## Docker Compose Secrets Setup

When using `docker-compose.prod.yml`, env files are loaded from:

- Backend: `backend/api/.env.production`
- Worker: `worker/.env.production`

```bash
# On the VPS, create env files from examples:
cp backend/api/.env.production.example backend/api/.env.production
cp worker/.env.production.example worker/.env.production

# Edit each file with real values:
nano backend/api/.env.production
nano worker/.env.production
```

The Docker Compose file overrides `MC_API_URL` and `REDIS_URL` with internal Docker DNS names (`backend:3001`, `redis:6379`), so those values in `.env.production` only matter when running the worker outside Docker.

## Secret Rotation

### Rotating `MC_API_KEY`

1. Generate a new API key in Almirant UI
2. Update `worker/.env.production`
3. Restart worker: `docker-compose -f docker-compose.prod.yml restart worker`
4. Revoke the old key in Almirant UI

### Rotating `ANTHROPIC_API_KEY`

1. Generate a new key at [console.anthropic.com](https://console.anthropic.com)
2. Update `worker/.env.production`
3. Restart worker: `docker-compose -f docker-compose.prod.yml restart worker`
4. Revoke the old key

### Rotating `GITHUB_TOKEN`

1. Generate a new PAT on GitHub
2. Update `worker/.env.production`
3. Restart worker: `docker-compose -f docker-compose.prod.yml restart worker`
4. Delete the old PAT

## Security Best Practices

- **Never commit** `.env.production` files — they are git-ignored by default
- Use a secrets manager (Vault, AWS Secrets Manager, 1Password Secrets Automation) for team environments
- Restrict file permissions: `chmod 600 worker/.env.production`
- Rotate API keys every 90-365 days
- Use fine-grained GitHub PATs scoped to specific repositories
- Monitor API key usage in the Almirant UI to detect anomalies
