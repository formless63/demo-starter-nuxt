import { closeNotificationDeliveryDatabase } from '../notifications/delivery'
export default defineNitroPlugin((nitro) => { nitro.hooks.hook('close', closeNotificationDeliveryDatabase) })
