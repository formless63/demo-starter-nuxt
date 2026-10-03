/** Refresh only this account's current/list payloads, never cached data from another sign-in. */
export function organizationRefreshKeys(keys: readonly string[], accountId: string) {
  const identity = encodeURIComponent(accountId)
  return keys.filter(key => key === `organization-current:${identity}`
    || key.startsWith(`organizations-switcher:${identity}:`)
    || key.startsWith(`organizations-settings:${identity}:`))
}
