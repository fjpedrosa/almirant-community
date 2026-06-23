# Connecting GitHub (BYO GitHub App)

Almirant Self-Hosted uses a **Bring Your Own GitHub App** model. You create
and control the GitHub App; Almirant only consumes the credentials you
provide.

There are two ways to set it up:

- **Recommended - automatic flow from the wizard**: Almirant generates a
  GitHub App manifest, GitHub hands the credentials back, and they are stored
  in the database. You never touch `GITHUB_*` environment variables.
- **Manual flow**: register the app in GitHub yourself and paste the
  credentials (still through the UI or, optionally, via env vars).

Both paths require the instance to have a public HTTPS URL configured first
(see [Production over tailnet](../production-tailnet.md) or your reverse
proxy of choice).

## Recommended: automatic setup from the UI

1. Sign in as admin and open `/onboarding` (or
   `/settings/github`).
2. Make sure the **Public URL** step is green - GitHub needs a reachable
   callback URL.
3. On the **GitHub App** step, keep the **Auto setup (manifest)** tab and
   click **Create GitHub App**.
4. GitHub opens with a pre-filled manifest. Confirm the name and the
   organization or user account that will own the app, then submit.
5. GitHub redirects back to Almirant. The backend exchanges the manifest
   code, stores App ID, slug, client ID/secret, webhook secret and private
   key in the database, and marks the step done.
6. Click **Install App** on the same page (or open
   `https://github.com/apps/<slug>/installations/new`) to install it on the
   repositories you want Almirant to access.

After this the wizard step turns green and you do not need to set any
`GITHUB_*` env var. To rotate or remove credentials use
`/settings/github`.

## Manual: register the app yourself

Use this if you cannot use the manifest flow (for example: the instance is
not yet reachable from GitHub, or you want to share one app across multiple
self-hosted Almirant instances).

### 1. Register a new GitHub App

1. Go to <https://github.com/settings/apps/new>
2. Fill in:

| Field | Value |
|---|---|
| GitHub App name | `Almirant Self-Hosted <your-name>` |
| Homepage URL | URL where Almirant is running, e.g. `https://almirant.example.com` |
| Callback URL | `https://almirant.example.com/api/github/oauth/callback` |
| Setup URL | `https://almirant.example.com/settings/github` |
| Webhook URL | `https://almirant.example.com/api/github/webhook` |
| Webhook secret | Generate a long random value and keep it for step 2 |

Recommended repository permissions:

- Contents: **Read & write**
- Issues: **Read & write**
- Pull requests: **Read & write**
- Metadata: **Read-only**
- Commit statuses: **Read & write**

Subscribe to these events:

- Pull request
- Pull request review
- Push
- Issues
- Issue comment

### 2. Collect credentials

From the GitHub App settings page collect:

- **App ID**
- **App slug** (the URL-safe name in `https://github.com/apps/<slug>`)
- **Client ID**
- **Client secret**
- **Webhook secret**
- **Private key (.pem)** - download the file from GitHub

### 3. Save credentials in Almirant

Preferred path - paste them into the UI:

1. Sign in as admin
2. Open `/onboarding` (or `/settings/github`)
3. On the **GitHub App** step pick the **Paste credentials** tab
4. Fill in App ID, slug, client ID/secret, webhook secret and the PEM
   content of the private key
5. Save

Optional fallback - environment variables:

If you really want to bake the credentials into the deployment, set them in
`.env`:

```bash
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=almirant-self-hosted-acme
GITHUB_CLIENT_ID=Iv1.xxxxxxxx
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GITHUB_WEBHOOK_SECRET=replace-me
GITHUB_PRIVATE_KEY=<base64-encoded-pem>
```

Encode the PEM into a single base64 line with:

```bash
base64 -i your-private-key.pem | tr -d '\n'
```

Then restart:

```bash
docker compose restart backend frontend
```

Note: credentials saved through the UI take precedence over env vars, so
mixing both can be confusing. Pick one source of truth.

### 4. Install the App on your repositories

1. Open the GitHub App page
2. Click **Install App**
3. Choose the org/user account
4. Select the repositories you want Almirant to access

## Troubleshooting

### Manifest flow opens GitHub but the credentials never come back

- Confirm the instance public URL is reachable from GitHub (HTTPS, valid
  certificate). The wizard's *Public URL* step must be green.
- Check `docker compose logs backend` for `github/manifest/exchange` errors.

### Webhook delivery fails

- Verify the webhook secret stored in Almirant matches what GitHub shows
- Verify the webhook URL is public and not `localhost`
- Check `docker compose logs backend`

### Private key errors

- If you used the manifest flow, regenerate the credentials from
  `/settings/github` (the UI re-runs the manifest exchange).
- If you used env vars, verify `GITHUB_PRIVATE_KEY` is the
  **base64-encoded PEM content**, not a file path.

### Pull request permissions are denied

Re-open the GitHub App settings and ensure **Pull requests** is set to
**Read & write**.
