/**
 * Whether the project-detail "Repos" tab is the active one.
 *
 * Gates the installation-wide GitHub repos pagination (`useGithubInstallationRepos`),
 * which otherwise walks EVERY page of the whole installation on mount even when the
 * user never opens the Repos tab. The repo picker only lives inside that tab, so the
 * data is only needed when the tab is active.
 */
export const shouldFetchRepos = (activeTab: string): boolean =>
  activeTab === "repos";
