import { createJobsBoss, resolveJobsConfig } from '../modules/jobs/runtime/server/boss'

const config = resolveJobsConfig()
const boss = createJobsBoss(config)

try {
  await boss.start()
  const report = await boss.detectSchemaDrift()
  if (!report.ok) {
    console.error('[jobs] pg-boss schema drift detected', JSON.stringify(report, null, 2))
    process.exitCode = 1
  }
  else {
    console.info(`[jobs] pg-boss schema ${config.schema} is current`)
  }
}
finally {
  await boss.stop({ graceful: false })
}
