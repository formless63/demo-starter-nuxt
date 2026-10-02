import { closeMedusaResources } from '../medusa/application'
export default defineNitroPlugin(app => app.hooks.hook('close', closeMedusaResources))
