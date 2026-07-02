#!/usr/bin/env bash
#
# Codemod: rename the tenant-scoping concept "organization" -> "workspace".
#
# Re-runnable and idempotent. Designed to be re-executed after merging branches
# that still contain "organization" references (e.g. fix/planning-turn-events,
# feat/claude5-model-catalog, refactor/container-driver): just run it again from
# the repo root and it will re-sweep the tree.
#
#   ./scripts/codemods/rename-organization-to-workspace.sh
#
# What it does NOT touch (intentional exceptions, mirroring the enterprise
# rename e7bf2342c / ed4e1902d / b4a04808f):
#   - Better-Auth plugin API surface: auth.api.listOrganizations,
#     setActiveOrganization, getFullOrganization, useListOrganizations,
#     useActiveOrganization, organizationClient, authClient.organization.*.
#   - Quoted enum/scope literals: "organization" (github_account_type,
#     connection_scope, ws scopes) and "Organization" (GitHub account.type,
#     schema.org JSON-LD).
#   - Files that mirror Better-Auth request/response shapes (teams domain,
#     accept-invitation, dashboard layout, auth-client mocks) and files where
#     "organization" is fully semantic (organization-json-ld.tsx, pglite-poc).
#   - frontend/src/lib/auth.ts and auth-permissions.ts: curated by hand
#     (Better-Auth plugin schema mapping lives in
#     frontend/src/lib/better-auth-organization-schema.ts).
#   - Historical migrations and drizzle meta snapshots.
#
# After running on NEW code, review files listed in the final warning section:
# they are skipped on purpose and may need manual attention if a merge added
# tenant-scoping references to them.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

# --------------------------------------------------------------------------
# Stage 1: file renames (git mv, idempotent)
# --------------------------------------------------------------------------
mv_if() {
  if [ -e "$1" ] && [ ! -e "$2" ]; then
    git mv "$1" "$2"
    echo "renamed: $1 -> $2"
  fi
}

mv_if backend/api/src/domains/auth/routes/organization-settings.routes.ts \
      backend/api/src/domains/auth/routes/workspace-settings.routes.ts
mv_if backend/api/src/domains/integrations/telegram/services/telegram/organization-context.ts \
      backend/api/src/domains/integrations/telegram/services/telegram/workspace-context.ts
mv_if backend/packages/database/src/schema/organization-settings.ts \
      backend/packages/database/src/schema/workspace-settings.ts
mv_if backend/packages/database/src/schema/organization.ts \
      backend/packages/database/src/schema/workspace.ts
mv_if frontend/src/domains/integrations/application/hooks/use-organization-settings.ts \
      frontend/src/domains/integrations/application/hooks/use-workspace-settings.ts
# Intentionally NOT renamed:
#   - frontend/src/components/seo/organization-json-ld.tsx (schema.org type)
#   - backend/packages/database/src/scripts/backfill-organization.ts
#     (historical script name; its content IS renamed)

# --------------------------------------------------------------------------
# Stage 2: content rename
# --------------------------------------------------------------------------

# Files skipped entirely. They either mirror Better-Auth request/response
# shapes (field names are part of the Better-Auth wire contract) or use
# "organization" with external semantics.
SKIP_REGEX='^frontend/src/domains/teams/|^frontend/src/domains/auth/application/hooks/use-accept-invitation|^frontend/src/app/\(app-shell\)/\(dashboard\)/layout\.tsx$|^frontend/src/lib/auth\.ts$|^frontend/src/lib/auth-permissions\.ts$|^frontend/src/lib/better-auth-organization-schema|^frontend/src/components/seo/organization-json-ld\.tsx$|^frontend/src/domains/api-keys/presentation/containers/api-keys-page-container\.test\.tsx$|^frontend/src/domains/integrations/presentation/components/github-account-picker-dialog\.tsx$|^backend/packages/database/src/pglite-poc/|^backend/packages/database/migrations/|^scripts/codemods/'

TARGETS=$(git ls-files -- frontend/src backend services packages worker/src \
  | grep -E '\.(ts|tsx)$' \
  | grep -Ev "$SKIP_REGEX" \
  | (xargs grep -lE 'organization|Organization|ORGANIZATION' 2>/dev/null || true))

COUNT=0
for f in $TARGETS; do
  perl -i -pe '
    # ---- pre-rules: renames that must win over protections ----
    s/pgTable\((\s*)(["\x27])organization\2/pgTable(${1}${2}workspace${2}/g;

    # ---- protections (placeholders) ----
    # English word "organizational" (prose) must not become "workspaceal"
    s/\borganizational\b/__KEEP_ORGL__/g;
    s/\bOrganizational\b/__KEEP_ORGLU__/g;
    # Quoted standalone literals: enum values, scopes, GitHub account types,
    # schema.org types. (Spanish "organización" is unaffected by all rules.)
    s/"organization"/__KQ_DQ_L__/g;
    s/\x27organization\x27/__KQ_SQ_L__/g;
    s/"Organization"/__KQ_DQ_U__/g;
    s/\x27Organization\x27/__KQ_SQ_U__/g;
    # Better-Auth plugin API surface
    s/authClient\.organization\b/__KEEP_ACORG__/g;
    s/\blistOrganizations\b/__KEEP_LISTORGS__/g;
    s/\bsetActiveOrganization\b/__KEEP_SETACTORG__/g;
    s/\bgetFullOrganization\b/__KEEP_GETFULLORG__/g;
    s/\buseListOrganizations\b/__KEEP_USELISTORGS__/g;
    s/\buseActiveOrganization\b/__KEEP_USEACTORG__/g;
    s/\borganizationClient\b/__KEEP_ORGCLIENT__/g;
    s/\ballowUserToCreateOrganization\b/__KEEP_ALLOWCREATE__/g;
    # schema.org JSON-LD component + import path
    s/\bOrganizationJsonLd\b/__KEEP_ORGJSONLD__/g;
    s/organization-json-ld/__KEEP_ORGJSONLD_PATH__/g;
    # Historical script name (file is not renamed)
    s/backfill-organization/__KEEP_BACKFILL__/g;
    # Better-Auth indirection module (created by hand, referenced from lib)
    s/better-auth-organization-schema/__KEEP_BA_SCHEMA_PATH__/g;
    # External API contracts
    s{/v1/organizations/}{__KEEP_ANTHROPIC_ADMIN__}g;      # Anthropic Admin API paths
    s/\bid_token_add_organizations\b/__KEEP_CODEX_IDTOKEN__/g; # Codex OAuth param
    s/:organization:/__KEEP_COMPOSITE_SCOPE__/g;            # provider:scope:id cache keys

    # ---- renames ----
    s/organization/workspace/g;
    s/Organization/Workspace/g;
    s/ORGANIZATION/WORKSPACE/g;

    # ---- grammar cleanup for renamed prose ----
    s/\ban workspace/a workspace/g;
    s/\bAn workspace/A workspace/g;

    # ---- restore ----
    s/__KEEP_ORGL__/organizational/g;
    s/__KEEP_ORGLU__/Organizational/g;
    s/__KQ_DQ_L__/"organization"/g;
    s/__KQ_SQ_L__/\x27organization\x27/g;
    s/__KQ_DQ_U__/"Organization"/g;
    s/__KQ_SQ_U__/\x27Organization\x27/g;
    s/__KEEP_ACORG__/authClient.organization/g;
    s/__KEEP_LISTORGS__/listOrganizations/g;
    s/__KEEP_SETACTORG__/setActiveOrganization/g;
    s/__KEEP_GETFULLORG__/getFullOrganization/g;
    s/__KEEP_USELISTORGS__/useListOrganizations/g;
    s/__KEEP_USEACTORG__/useActiveOrganization/g;
    s/__KEEP_ORGCLIENT__/organizationClient/g;
    s/__KEEP_ALLOWCREATE__/allowUserToCreateOrganization/g;
    s/__KEEP_ORGJSONLD__/OrganizationJsonLd/g;
    s/__KEEP_ORGJSONLD_PATH__/organization-json-ld/g;
    s/__KEEP_BACKFILL__/backfill-organization/g;
    s/__KEEP_BA_SCHEMA_PATH__/better-auth-organization-schema/g;
    s{__KEEP_ANTHROPIC_ADMIN__}{/v1/organizations/}g;
    s/__KEEP_CODEX_IDTOKEN__/id_token_add_organizations/g;
    s/__KEEP_COMPOSITE_SCOPE__/:organization:/g;
  ' "$f"
  COUNT=$((COUNT + 1))
done
echo "content pass: $COUNT files processed"

# Grammar sweep (separate pass: renamed files no longer match the org grep)
git ls-files -- frontend/src backend services packages worker/src \
  | grep -E '\.(ts|tsx)$' \
  | grep -Ev "$SKIP_REGEX" \
  | (xargs grep -lE '\b[Aa]n workspace\b' 2>/dev/null || true) \
  | while read -r f; do
      perl -i -pe 's/\ban workspace/a workspace/g; s/\bAn workspace/A workspace/g;' "$f"
    done

# --------------------------------------------------------------------------
# Stage 3: i18n (frontend/messages) — targeted key renames only.
# Marketing/legal copy and GitHub install-flow copy keep "organization".
# --------------------------------------------------------------------------
perl -i -pe '
  s/"organizations": "Organizations"/"workspaces": "Workspaces"/;
  s/"createOrganization": "Create organization"/"createWorkspace": "Create workspace"/;
  s/"title": "Organization Invitation"/"title": "Workspace Invitation"/;
  s/"description": "Organization usage metrics and per-user consumption\."/"description": "Workspace usage metrics and per-user consumption."/;
' frontend/messages/en.json
perl -i -pe '
  s/"organizations": "Organizaciones"/"workspaces": "Workspaces"/;
  s/"createOrganization": "Crear organización"/"createWorkspace": "Crear workspace"/;
  s/"title": "Invitación a organización"/"title": "Invitación al workspace"/;
  s/"description": "Metricas de uso de la organizacion y consumo por usuario\."/"description": "Métricas de uso del workspace y consumo por usuario."/;
' frontend/messages/es.json

# --------------------------------------------------------------------------
# Stage 4: report skipped files that still contain tenant-ish references so
# a human can review them after future merges.
# --------------------------------------------------------------------------
echo ""
echo "Skipped (intentional — review manually only if a merge changed them):"
git ls-files -- frontend/src backend services packages worker/src \
  | grep -E '\.(ts|tsx)$' \
  | grep -E "$SKIP_REGEX" \
  | (xargs grep -lE 'organization|Organization' 2>/dev/null || true) \
  | sed 's/^/  /'
echo "done"
