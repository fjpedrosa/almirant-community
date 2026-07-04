/**
 * The paginated expenses list only appears on the "list" tab of the expense
 * dashboard, so its query should stay gated until that tab is active (the
 * overview and recurring tabs never render it).
 */
export const shouldFetchExpenseList = (activeTab: string): boolean =>
  activeTab === "list";
