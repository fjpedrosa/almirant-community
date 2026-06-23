export const planningSessionKeys = {
  all: ["planning-sessions"] as const,
  lists: () => [...planningSessionKeys.all, "list"] as const,
  list: (filters: string) =>
    [...planningSessionKeys.lists(), filters] as const,
  details: () => [...planningSessionKeys.all, "detail"] as const,
  detail: (id: string) => [...planningSessionKeys.details(), id] as const,
  seeds: (id: string) =>
    [...planningSessionKeys.detail(id), "seeds"] as const,
  workItems: (id: string) =>
    [...planningSessionKeys.detail(id), "work-items"] as const,
  active: () => [...planningSessionKeys.all, "active"] as const,
};

export const seedKeys = {
  all: ["seeds"] as const,
  lists: () => [...seedKeys.all, "list"] as const,
  list: (filters: string) => [...seedKeys.lists(), filters] as const,
  details: () => [...seedKeys.all, "detail"] as const,
  detail: (id: string) => [...seedKeys.details(), id] as const,
  comments: (id: string) => [...seedKeys.detail(id), "comments"] as const,
  history: (id: string) => [...seedKeys.detail(id), "history"] as const,
  traceability: (id: string) =>
    [...seedKeys.detail(id), "traceability"] as const,
  tags: (id: string) => [...seedKeys.detail(id), "tags"] as const,
  selected: () => [...seedKeys.all, "selected"] as const,
};
