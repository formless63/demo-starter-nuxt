import { getEmail } from '@repo/nuxt-email/server'
import type { EmailMessage, EmailSecurity } from '@repo/nuxt-email/server'
import { getLogger, getMeter, withSpan } from '@repo/nuxt-observability/server'

// Application-owned telemetry; the Email package has no Observability dependency.
export function runEmailOperation<T>(operation: 'send' | 'verify', security: EmailSecurity, action: () => Promise<T>, recipients?: number) {
  return withSpan(`email.${operation}`, async () => {
    const start = performance.now()
    let outcome = 'success'
    try { return await action() }
    catch (error) { outcome = 'error'; throw error }
    finally {
      const attributes = { 'app.email.operation': operation, 'app.email.outcome': outcome, 'app.email.security': security }
      const duration = (performance.now() - start) / 1000
      getMeter().createHistogram(`app.email.${operation}.duration`, { unit: 's' }).record(duration, attributes)
      if (recipients !== undefined) getMeter().createHistogram('app.email.send.recipients').record(recipients, attributes)
      getLogger().info({ operation, outcome, security, duration }, 'email.operation')
    }
  })
}
export function sendObservedEmail(message: EmailMessage) {
  const email = getEmail()
  return runEmailOperation('send', email.security, () => email.send(message), message.to.length + (message.cc?.length ?? 0) + (message.bcc?.length ?? 0))
}
export function verifyObservedEmail() {
  const email = getEmail()
  return runEmailOperation('verify', email.security, () => email.verify())
}
