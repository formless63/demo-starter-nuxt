const chartDependencies = ['echarts/core', 'echarts/renderers', 'echarts/components', 'echarts/charts']

export function mergeChartsOptimizeDeps<T extends { optimizeDeps?: { include?: string[] } }>(config: T): T {
  const include = config.optimizeDeps?.include ?? []
  config.optimizeDeps = {
    ...config.optimizeDeps,
    include: [...new Set([...include, ...chartDependencies])],
  }
  return config
}
