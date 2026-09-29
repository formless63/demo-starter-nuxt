#!/usr/bin/env node
import { runJobsCli } from './commands'

runJobsCli().catch((error) => {
  console.error('[jobs] command failed', error)
  process.exit(1)
})
