import { createPayload, type I18nConfig } from '@repo/nuxt-internationalization/runtime'
const config: I18nConfig = {
  defaultLocale: 'en', fallbackLocale: 'en', timeZone: 'UTC',
  locales: {
    en: { direction: 'ltr', messages: { title: 'Hello {name}', items_one: '{count} item', items_other: '{count} items', fallback: 'English fallback', malicious: '<img src=x onerror=alert(1)>', unicode: 'Line\r\nNext\0\ud800' } },
    de: { direction: 'ltr', messages: { title: 'Hallo {name}', items_one: '{count} Eintrag', items_other: '{count} Einträge', malicious: '<img src=x onerror=alert(1)>', unicode: 'Line\r\nNext\0\ud800' } },
    ar: { direction: 'rtl', messages: { title: 'مرحباً {name}', items_zero: 'صفر', items_one: 'واحد', items_two: 'اثنان', items_few: '{count} قليل', items_many: '{count} كثير', items_other: '{count} آخر', malicious: '<img src=x onerror=alert(1)>', unicode: 'Line\r\nNext\0\ud800' } },
  },
}
export default defineEventHandler(event => createPayload(config, getQuery(event).locale, [
  { id: 'price', kind: 'number', value: 1234.5, preset: 'currency' },
  { id: 'date', kind: 'date', value: Date.UTC(2026, 0, 2, 15, 4), preset: 'dateTime' },
]))
