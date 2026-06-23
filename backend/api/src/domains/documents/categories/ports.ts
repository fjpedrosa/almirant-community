export type DocumentCategoryRepository = {
  getAll: (orgId: string) => Promise<any[]>;
  getById: (orgId: string, id: string) => Promise<any | null>;
  create: (orgId: string, data: {
    name: string;
    color?: string;
    icon?: string;
    parentId?: string;
  }) => Promise<any>;
  update: (orgId: string, id: string, data: {
    name?: string;
    color?: string;
    icon?: string;
    parentId?: string | null;
    status?: "active" | "archived";
  }) => Promise<any | null>;
  delete: (orgId: string, id: string) => Promise<boolean>;
};
