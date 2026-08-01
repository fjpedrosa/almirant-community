import {
  attachRepositoryAtomically,
  extractGithubRepoFullName,
  getActiveGithubConnectionsForWorkspace,
  getInstallationByRepoId,
  linkRepoToInstallation,
} from "@almirant/database";
import { fetchInstallationRepositories } from "../../../integrations/github/services/github-service";

export type RepositoryProvider = "github" | "gitlab" | "bitbucket" | "other";

export interface AttachProjectRepositoryInput {
  workspaceId: string;
  projectId: string;
  name: string;
  url: string;
  provider: RepositoryProvider;
  isMonorepo: boolean;
  order?: number;
}

export class RepositoryUrlValidationError extends Error {}

type AtomicAttachment = NonNullable<
  Awaited<ReturnType<typeof attachRepositoryAtomically>>
>;

export interface AttachProjectRepositoryResult extends AtomicAttachment {
  githubInstallationLinked: boolean;
}

type Dependencies = {
  attachRepositoryAtomically: typeof attachRepositoryAtomically;
  getActiveGithubConnectionsForWorkspace: typeof getActiveGithubConnectionsForWorkspace;
  fetchInstallationRepositories: typeof fetchInstallationRepositories;
  linkRepoToInstallation: typeof linkRepoToInstallation;
  getInstallationByRepoId: typeof getInstallationByRepoId;
};

const defaultDependencies: Dependencies = {
  attachRepositoryAtomically,
  getActiveGithubConnectionsForWorkspace,
  fetchInstallationRepositories,
  linkRepoToInstallation,
  getInstallationByRepoId,
};

const INSTALLATION_PAGE_SIZE = 100;
const MAX_INSTALLATION_PAGES = 20;

export const normalizeRepositoryUrl = (
  url: string,
  provider: RepositoryProvider,
): string => {
  const value = url.trim();
  if (provider === "github") {
    const fullName = extractGithubRepoFullName(value)?.toLowerCase();
    if (!fullName) {
      throw new RepositoryUrlValidationError("URL must be a valid GitHub repository URL");
    }
    return `https://github.com/${fullName}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RepositoryUrlValidationError("URL must be a valid repository URL");
  }
  if (parsed.protocol !== "https:") {
    throw new RepositoryUrlValidationError("URL must use HTTPS");
  }
  if (parsed.username || parsed.password) {
    throw new RepositoryUrlValidationError("URL must not include credentials");
  }
  if (parsed.search || parsed.hash) {
    throw new RepositoryUrlValidationError("URL must not include a query or fragment");
  }
  if (parsed.port && parsed.port !== "443") {
    throw new RepositoryUrlValidationError("URL must use the standard HTTPS port");
  }
  if (isUnsafeLiteralHost(parsed.hostname)) {
    throw new RepositoryUrlValidationError("URL must use a public host");
  }
  parsed.pathname = parsed.pathname.replace(/\.git\/?$/i, "").replace(/\/$/, "");
  return parsed.toString().replace(/\/$/, "");
};

const isUnsafeLiteralHost = (rawHostname: string): boolean => {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;

  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some((octet) => octet > 255)) return true;
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b! >= 16 && b! <= 31) ||
      (a === 192 && b === 168);
  }

  if (!hostname.includes(":")) return false;
  if (hostname === "::" || hostname === "::1") return true;
  const first = Number.parseInt(hostname.split(":", 1)[0] || "0", 16);
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;
  const mapped = hostname.match(/^(?:0*:){5}ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? isUnsafeLiteralHost(mapped[1]!) : false;
};

const findExposedRepository = async (
  dependencies: Dependencies,
  installationId: number,
  fullName: string,
) => {
  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
    const response = await dependencies.fetchInstallationRepositories(
      installationId,
      page,
      INSTALLATION_PAGE_SIZE,
    );
    const match = response.repositories.find(
      (repository) =>
        repository.full_name.toLowerCase() === fullName.toLowerCase(),
    );
    if (match) return match;
    if (
      page * INSTALLATION_PAGE_SIZE >= response.total_count ||
      response.repositories.length < INSTALLATION_PAGE_SIZE
    ) {
      break;
    }
  }
  return null;
};

const ensureGithubInstallationLink = async (
  dependencies: Dependencies,
  workspaceId: string,
  repository: AtomicAttachment["repository"],
  fullName: string,
): Promise<boolean> => {
  if (await dependencies.getInstallationByRepoId(repository.id)) return true;

  const connections =
    await dependencies.getActiveGithubConnectionsForWorkspace(workspaceId);
  for (const connection of connections) {
    const installationId = (
      connection.config as { installationId?: unknown } | null
    )?.installationId;
    if (typeof installationId !== "number") continue;

    try {
      const match = await findExposedRepository(
        dependencies,
        installationId,
        fullName,
      );
      if (!match) continue;
      await dependencies.linkRepoToInstallation({
        installationId: connection.id,
        repoId: repository.id,
        githubRepoFullName: fullName,
        defaultBranch: match.default_branch,
      });
      return true;
    } catch {
      // Continue with another installation without exposing provider errors.
    }
  }
  return false;
};

export const createProjectRepositoryService = (
  dependencies: Dependencies = defaultDependencies,
) => ({
  attach: async (
    input: AttachProjectRepositoryInput,
  ): Promise<AttachProjectRepositoryResult> => {
    const normalizedUrl = normalizeRepositoryUrl(input.url, input.provider);
    const attachment = await dependencies.attachRepositoryAtomically(
      input.workspaceId,
      input.projectId,
      {
        name: input.name.trim(),
        url: normalizedUrl,
        provider: input.provider,
        isMonorepo: input.isMonorepo,
        order: input.order,
      },
    );
    if (!attachment) throw new Error("Project not found");

    const githubInstallationLinked =
      input.provider === "github"
        ? await ensureGithubInstallationLink(
            dependencies,
            input.workspaceId,
            attachment.repository,
            extractGithubRepoFullName(normalizedUrl)!,
          )
        : false;

    return { ...attachment, githubInstallationLinked };
  },
});

const projectRepositoryService = createProjectRepositoryService();

export const attachProjectRepository = (input: AttachProjectRepositoryInput) =>
  projectRepositoryService.attach(input);

export type ProjectRepositoryService = ReturnType<
  typeof createProjectRepositoryService
>;
