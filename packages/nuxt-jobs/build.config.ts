import { defineBuildConfig } from 'unbuild'

export default defineBuildConfig({
  entries: [
    { builder: 'rollup', input: 'src/cli/commands', name: 'cli' },
    { builder: 'rollup', input: 'src/cli/bin', name: 'bin', declaration: false },
  ],
})
