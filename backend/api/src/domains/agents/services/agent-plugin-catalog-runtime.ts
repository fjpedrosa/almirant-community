import {
  createAgentPluginVersion,
  createPluginMarketplace,
  deletePluginMarketplace,
  ensurePluginMarketplace,
  findOwnedAgentPluginVersion,
  findOwnedMarketplaceAgentPluginVersion,
  getPluginMarketplaceById,
  listOwnedAgentPackagePlugins,
  listPluginMarketplacesByWorkspace,
  updatePluginMarketplaceCatalog,
} from "@almirant/database";
import { userStorageService } from "../../storage/services/user-storage-runtime";
import { createAgentPluginCatalogService } from "./agent-plugin-catalog-service";
import { loadClaudeMarketplaceCatalog } from "./plugin-marketplace-loader";

export const agentPluginCatalogService = createAgentPluginCatalogService({
  repository: {
    ensureMarketplace: ensurePluginMarketplace,
    listMarketplaces: listPluginMarketplacesByWorkspace,
    createMarketplace: createPluginMarketplace,
    getMarketplace: getPluginMarketplaceById,
    updateMarketplaceCatalog: updatePluginMarketplaceCatalog,
    deleteMarketplace: deletePluginMarketplace,
    findOwnedPluginVersion: findOwnedAgentPluginVersion,
    findOwnedMarketplacePluginVersion: findOwnedMarketplaceAgentPluginVersion,
    createPluginVersion: createAgentPluginVersion,
    listOwnedPackagePlugins: listOwnedAgentPackagePlugins,
  },
  storage: userStorageService,
  loadCatalog: loadClaudeMarketplaceCatalog,
});
