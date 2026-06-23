# Runner Smoke Test Checklist

## Preconditions

- Backend API running and reachable from runner host.
- Docker daemon running on runner host.
- Worker API key configured in `services/runner/.env`.
- At least one AI provider key configured in Almirant.
- Discord bot token/channel configured if testing thread relay.

## Steps

1. Start runner:
   - `cd services/runner`
   - `docker compose -f docker-compose.prod.yml up -d`
2. Verify health endpoint:
   - `curl -fsS http://localhost:3002/health`
3. Create an agent job from API/MCP targeting one test work item.
4. Confirm runner claims the job (status transitions queued -> running).
5. Confirm container is created and removed after completion.
6. Confirm job status transitions to completed/failed with result metadata.
7. If Discord is enabled:
   - Verify thread creation
   - Verify streamed output appears
   - Verify completion rename/archive behavior

## Expected outcomes

- Heartbeat updates are visible in backend.
- No orphaned containers remain after job completion.
- Failures are reported with `errorMessage` and cleanups executed.
