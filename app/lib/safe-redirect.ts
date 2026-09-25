const fallbackRedirect = '/app/projects'
const applicationOrigin = 'http://application.local'

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
    || /%(?:2f|5c)/i.test(value)) {
    return fallbackRedirect
  }

  try {
    const url = new URL(value, applicationOrigin)

    if (url.origin !== applicationOrigin) {
      return fallbackRedirect
    }

    return `${url.pathname}${url.search}${url.hash}`
  }
  catch {
    return fallbackRedirect
  }
}
