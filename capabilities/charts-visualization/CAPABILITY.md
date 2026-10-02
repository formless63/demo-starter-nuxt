# Charts / Visualization

`@repo/nuxt-charts-visualization` is an optional client UI package. Register its Nuxt module explicitly; it is not installed by default and has no hard capability dependencies.

`<ChartsVisualization>` supports line, bar, and area charts. SSR always emits a semantic figure and accessible data table. The client bundle uses static selective ECharts 6.1.0 imports; chart initialization occurs only after mount. Updates replace options, `ResizeObserver` handles responsive sizing, unmount disposes the instance, and reduced-motion preferences suppress animation. The module adds its ECharts entries to Vite's dependency prebundle list without replacing consumer entries. No fetching, database, provider, or Data Table dependency is owned.

Verify with `bun run packages:test charts-visualization` and `bun run capabilities:check`.
