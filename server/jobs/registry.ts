import { invoiceNinjaService } from '../invoice-ninja/application'
import { stripeService } from '../stripe/application'
import { medusaService } from '../medusa/application'
import { transferService } from '../transfers/application'
import { defineJobRegistry } from '@repo/nuxt-jobs/server'
import { webhookJobs } from '../webhooks/registry'
import { notificationJobs } from '../notifications/delivery'
import { starterEchoJob } from './tasks/starter-echo'

export const jobRegistry = defineJobRegistry(starterEchoJob, webhookJobs.delivery, notificationJobs.delivery, transferService.runJob, invoiceNinjaService.operationJob, invoiceNinjaService.receiptJob, stripeService.runJob, stripeService.inboxJob, medusaService.operationJob, medusaService.inboxJob)
