import { closeEmail, EmailError, resolveEmailConfig } from '@repo/nuxt-email/server'
import { sendObservedEmail, verifyObservedEmail } from '../server/utils/observed-email'

try {
  const command = Bun.argv[2]
  if (command === 'check') {
    await verifyObservedEmail()
    console.info('[email] transport verified; no message sent')
  }
  else if (command === 'smoke') {
    const config = resolveEmailConfig()
    const local = ['127.0.0.1', 'localhost'].includes(config.host) && config.port === 1025 && config.security === 'opportunistic' && !config.user
    const target = Bun.argv[3] ?? (local ? 'smoke@example.test' : undefined)
    if (!target) throw new EmailError('configuration')
    const result = await sendObservedEmail({ to: [{ address: target }], subject: 'SMTP smoke test', text: 'One intentional SMTP smoke message.' })
    console.info(`[email] one send completed: ${result.outcome}`)
    if (result.outcome !== 'accepted') process.exitCode = 1
  }
  else throw new EmailError('configuration')
}
catch (error) {
  console.error('[email]', error instanceof EmailError ? error.toJSON() : { code: 'unknown' })
  process.exitCode = 1
}
finally { closeEmail() }
