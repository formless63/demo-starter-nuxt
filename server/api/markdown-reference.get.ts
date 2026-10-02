import { parseMarkdown } from '@repo/nuxt-markdown-code/server'

export default defineEventHandler(() => parseMarkdown("# Markdown reference\n\n**Native Vue** and `inline code`.\n\n3. Third\n4. Fourth\n\n|Name|Value|\n|---|---|\n|Ada|42|\n\n[Safe link](https://example.com) [Unsafe](javascript:alert(1))\n\n![Image alt only](https://tracker.invalid/a.png)\n\n<script>unsafe()</script>\n\n```ts\nconst greeting = \"<script>\"\n```\n\n```unknown\nplain fallback\n```\n"))
