import { runContract } from './contract'
if (!process.env.MEDUSA_FIXTURE_DATABASE_URL) throw new Error('Disposable fixture database required')
await runContract(process.env.MEDUSA_FIXTURE_DATABASE_URL)
