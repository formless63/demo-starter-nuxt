import { closeTransferResources } from '../transfers/application'
export default defineNitroPlugin((app) => { app.hooks.hook('close', closeTransferResources) })
