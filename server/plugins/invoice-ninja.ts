import { closeInvoiceNinjaResources } from '../invoice-ninja/application'
export default defineNitroPlugin(nitro => { nitro.hooks.hook('close', closeInvoiceNinjaResources) })
