import { createJobsBoss, resolveJobsConfig } from '../modules/jobs/runtime/server/boss'

const config = resolveJobsConfig()
const boss = createJobsBoss(config, true)

try {
  await boss.start()
  console.info(`[jobs] pg-boss schema ${config.schema} migrated successfully`)
}
finally {
  await boss.stop({ graceful: false })
}
