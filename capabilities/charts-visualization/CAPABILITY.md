# Charts / Visualization

`@repo/nuxt-charts-visualization` is an optional client UI package. Register its Nuxt module explicitly; it is not installed by default and has no hard capability dependencies.

`<ChartsVisualization>` supports line, bar, and area charts. SSR always emits a semantic figure and accessible data table. After mount, ECharts 6.1.0 is loaded with selective imports. Updates replace options, `ResizeObserver` handles responsive sizing, unmount disposes the instance, and reduced-motion preferences suppress animation. No fetching, database, provider, or Data Table dependency is owned.

Verify with `bun run packages:test charts-visualization` and `bun run capabilities:check`.
