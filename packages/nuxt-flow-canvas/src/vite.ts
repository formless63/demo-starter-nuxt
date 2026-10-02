export function mergeFlowOptimizeDeps<T extends { optimizeDeps?: { include?: string[] } }>(config: T): T {
  config.optimizeDeps = { ...config.optimizeDeps, include: [...new Set([...(config.optimizeDeps?.include ?? []), '@vue-flow/core'])] }
  return config
}
