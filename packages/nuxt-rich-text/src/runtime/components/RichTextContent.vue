<script lang="ts">
import { defineComponent, h, type PropType } from 'vue'
import { parseRichTextDocument, type RichTextDocument } from '../document'
import { renderRichTextNode } from '../render'
export default defineComponent({
  props: { value: { type: Object as PropType<RichTextDocument>, required: true }, label: { type: String, default: undefined } },
  setup: props => () => {
    try { return h('section', { 'aria-label': props.label, style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, [renderRichTextNode(parseRichTextDocument(props.value))]) }
    catch { return h('p', { role: 'alert' }, 'Invalid rich-text document.') }
  },
})
</script>
