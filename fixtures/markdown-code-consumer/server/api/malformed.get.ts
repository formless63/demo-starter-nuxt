import { normalizeMarkdownDocument } from '@repo/nuxt-markdown-code/server'
import { malformedDocument } from '../../.fixture/grammar'
export default defineEventHandler(() => normalizeMarkdownDocument(malformedDocument))
