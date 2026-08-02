/**
 * Downstream distributions may replace this module to register additional
 * extension-point implementations (via `@almirant/shared`'s `set*()`
 * registry) before `bootstrapExtensions()` returns — e.g. an enterprise
 * feedback processor or a cloud-specific auth provider registry.
 *
 * Community keeps the default implementation synchronous and inert: it
 * registers nothing and leaves every extension point to whatever
 * `bootstrap.ts` already wired.
 */
export const registerCloudExtensions = (): void => {};
