import { refsIn } from '../../../shared/chat'
import { useSetSlugs } from '../../state/sets'
import { RefChip } from './RefChip'

/** Text as it is, but for its refs, which are chips. For the monospace text of a tool's input and result. A `#deck` is a chip when the project has a named set of that name. */
export function RefText({ text }: { text: string }) {
  const slugs = useSetSlugs()
  return (
    <>
      {refsIn(text, slugs).map((piece, n) => (piece.ref !== undefined ? <RefChip key={n} value={piece.ref} prose /> : piece.text))}
    </>
  )
}
