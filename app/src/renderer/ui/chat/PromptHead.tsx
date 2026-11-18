import { memo } from 'react'
import type { HeadBuilds } from './headKind'

/**
 * The head each prompt starts with (spec 2026-11-18, "The conversation"): "Prompt 14", the builds it made, and a hairline to
 * the right edge. A prompt waiting its turn says so instead; one that built nothing, once its turn is over, says "no build".
 */
export const PromptHead = memo(function PromptHead({ id, number, builds, queued, ended }: { id: string; number: number | undefined; builds: HeadBuilds | undefined; queued: boolean; ended: boolean }) {
  return (
    <div className="chat-phead" data-prompt={id} data-queued={queued ? '' : undefined} data-builds={builds && builds.kind !== 'none' ? builds.kind : undefined}>
      <span className="chat-phead-n">
        Prompt{number !== undefined && number > 0 && <> <span className="num">{number}</span></>}
      </span>
      {queued ? (
        <span className="chat-phead-note">queued</span>
      ) : builds?.kind === 'none' ? (
        ended && <span className="chat-phead-note">no build</span>
      ) : builds ? (
        <span className="chat-phead-to">
          {builds.from !== undefined && (
            <>
              <span className="num">{builds.from}</span> →{' '}
            </>
          )}
          {builds.kind === 'built' && <b className="chat-phead-new">{builds.to}</b>}
          {builds.kind === 'failed' && <b className="chat-phead-fail">failed</b>}
          {builds.kind === 'running' && '…'}
        </span>
      ) : null}
    </div>
  )
})
