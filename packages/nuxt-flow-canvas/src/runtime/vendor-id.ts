/** Vendor selectors interpolate IDs without CSS escaping. Never pass graph IDs
 * directly to those selectors; preserve original IDs only in the graph model. */
export function flowVendorId(value: string): string {
  return `n_${Array.from(value, character => character.codePointAt(0)!.toString(16)).join('_')}`
}
