import { closeStripeResources } from '../stripe/application'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeStripeResources) })
