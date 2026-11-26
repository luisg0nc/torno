import { type KeyboardEvent, type MutableRefObject, createContext, memo, useContext, useEffect, useRef, useState } from 'react'
import { type ChatAnswer, type ChatItem, TORNO_TOOL_PREFIX } from '../../../shared/chat'
import { pressed, which } from '../../../shared/keys'
import { numbered } from '../numbered'
import { giveKeysBack } from '../typing'
import { type Question, answerFor, describeInput, questionsOf } from './ask'
import { Diff } from './Diff'
import { Markdown } from './markdown'
import { Takeover, WaitsBelow } from './AskTakeover'
import { ShelfOffer } from './ShelfOffer'
import { type ShelfOffer as Offer, answersIn, shelfOffer } from './offerLines'
import { isEditable } from './typing'
import { useChatPlace } from './place'

type Ask = Extract<ChatItem, { kind: 'ask' }>

/** The session whose transcript is drawn: a card answers to it. */
export const AskSession = createContext<string | undefined>(undefined)

/** The sentence the agent was told when nothing was typed (main's): not repeated on a card that is done. */
const DENIED = 'The person denied this.'

const toolName = (name: string): string => (name.startsWith(TORNO_TOOL_PREFIX) ? `torno · ${name.slice(TORNO_TOOL_PREFIX.length)}` : name)

/** How long a card waits for main to take its answer before it lets the person answer again. */
const ANSWER_WAIT_MS = 10_000

type Answering = { answering: boolean; answer: (a: ChatAnswer) => void }

function useAnswer(item: Ask): Answering {
  const session = useContext(AskSession)
  const [answering, setAnswering] = useState(false)
  // Main ends the ask with the answer; should nothing change within moments, the buttons are the person's again.
  useEffect(() => {
    if (!answering) return
    const timer = setTimeout(() => setAnswering(false), ANSWER_WAIT_MS)
    return () => clearTimeout(timer)
  }, [answering])
  return {
    answering: answering && item.state === 'open',
    answer(a) {
      if (!session || item.state !== 'open') return
      setAnswering(true)
      window.torno.chat.answer(session, item.requestId, a)
    }
  }
}

/** What to do instead, typed on the card as the reason for a refusal; Enter refuses with it, Escape gives the keys back. */
function Reason({ value, onChange, onKeep }: { value: string; onChange: (v: string) => void; onKeep: () => void }) {
  return (
    <input
      type="text"
      className="chat-ask-reason"
      aria-label="Tell Claude Code what to do instead (optional)"
      placeholder="Tell Claude Code what to do instead (optional)"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return
        if (pressed(e, 'field.keep')) {
          e.preventDefault()
          onKeep()
        } else if (pressed(e, 'field.leave')) {
          e.preventDefault()
          giveKeysBack(e.currentTarget)
        }
      }}
    />
  )
}

/** What the card says once it is done: how it was answered. */
function Outcome({ item, said }: { item: Ask; said: Record<'allowed' | 'denied', string> }) {
  if (item.state === 'open') return null
  // The CLI gave it up when the turn was stopped (`why`), or the session ended with it open.
  const word = item.state === 'ended' ? (item.why !== undefined ? `Cancelled: ${item.why}` : 'Not answered: the session ended') : said[item.state]
  const reason = item.state === 'denied' && item.answer && item.answer !== DENIED ? item.answer : undefined
  return (
    <p className="chat-ask-outcome">
      {word}
      {reason && <>: {numbered(reason)}</>}
    </p>
  )
}

function Permission({ item, answering, answer }: { item: Ask } & Answering) {
  const [reason, setReason] = useState('')
  const open = item.state === 'open'
  const [all, setAll] = useState(false)
  const where = useChatPlace()
  const shown = describeInput(item.toolName, item.input, all, where)
  const deny = (): void => answer({ allow: false, message: reason.trim() })
  return (
    <>
      <h4 className="chat-ask-title">
        Claude Code {open ? 'asks' : 'asked'} to use <span className="num">{toolName(item.toolName)}</span>
      </h4>
      {item.description !== undefined && <p className="chat-ask-why selectable">{numbered(item.description)}</p>}
      {(shown.lead !== undefined || shown.body !== '' || shown.hunks !== undefined) && (
        <div className="chat-ask-input selectable">
          {shown.lead !== undefined && <p className="chat-ask-lead" title={shown.full}>{shown.lead}</p>}
          {shown.hunks !== undefined && <Diff hunks={shown.hunks} />}
          {shown.body !== '' && <pre>{shown.body}</pre>}
          {shown.more > 0 && (
            <button type="button" className="chat-more" onClick={() => setAll(true)}>
              Show all {numbered(shown.hunks !== undefined ? `${shown.more} more changed lines` : `${shown.more} more lines`)}
            </button>
          )}
        </div>
      )}
      {item.blockedPath !== undefined && (
        <p className="chat-ask-path selectable">
          Path <span className="chat-ask-lead">{item.blockedPath}</span>
        </p>
      )}
      {open ? (
        <div className="chat-ask-actions">
          <Reason value={reason} onChange={setReason} onKeep={deny} />
          <button type="button" className="button" disabled={answering} onClick={deny}>
            Deny
          </button>
          {item.suggestions && (
            <button type="button" className="button" disabled={answering} title="Allow this, and the rule Claude Code suggests, until this session ends" onClick={() => answer({ allow: true, always: true })}>
              Allow for this session
            </button>
          )}
          <button type="button" className="button button-primary" disabled={answering} onClick={() => answer({ allow: true })}>
            Allow
          </button>
        </div>
      ) : (
        <Outcome item={item} said={{ allowed: 'Allowed', denied: 'Denied' }} />
      )}
    </>
  )
}

function Plan({ item, answering, answer }: { item: Ask } & Answering) {
  const [reason, setReason] = useState('')
  const open = item.state === 'open'
  const plan = typeof (item.input as { plan?: unknown } | null)?.plan === 'string' ? (item.input as { plan: string }).plan : ''
  const keep = (): void => answer({ allow: false, message: reason.trim() || 'The person wants to keep planning.' })
  return (
    <>
      <h4 className="chat-ask-title">Claude Code {open ? 'asks' : 'asked'} to leave plan mode</h4>
      {plan !== '' && (
        <div className="chat-ask-plan selectable">
          <Markdown text={plan} />
        </div>
      )}
      {open ? (
        <div className="chat-ask-actions">
          <Reason value={reason} onChange={setReason} onKeep={keep} />
          <button type="button" className="button" disabled={answering} onClick={keep}>
            Keep planning
          </button>
          <button type="button" className="button button-primary" disabled={answering} onClick={() => answer({ allow: true })}>
            Approve plan
          </button>
        </div>
      ) : (
        <Outcome item={item} said={{ allowed: 'Approved', denied: 'Kept planning' }} />
      )}
    </>
  )
}

/** One question: a list of rows, each a key, a label and its description small and muted beneath, and a row of its own for anything else. */
function QuestionView({ question, offer, picked, other, onPick, onOther, disabled, keyed, onAdvance }: { question: Question; offer: Offer | null; picked: string[]; other: string; onPick: (label: string) => void; onOther: (text: string) => void; disabled: boolean; keyed: boolean; onAdvance: () => void }) {
  return (
    <fieldset className="chat-ask-question" disabled={disabled} data-offer={offer ? 'shelf' : undefined}>
      <legend>
        <span className="chat-ask-text">{numbered(offer ? offer.title : question.question)}</span>
      </legend>
      {offer && <ShelfOffer offer={offer} />}
      <div className="chat-ask-options" role="group" aria-label={offer ? offer.title : question.question} data-offer={offer ? 'shelf' : undefined}>
        {question.options.map((option, n) =>
          offer ? (
            <button key={option.label} type="button" className={`button${n === 0 ? ' button-primary' : ''}`} title={option.description !== '' ? option.description : undefined} aria-pressed={picked.includes(option.label)} aria-keyshortcuts={keyed && n < KEYED ? String(n + 1) : undefined} onClick={() => onPick(option.label)}>
              {numbered(option.label)}
            </button>
          ) : (
            <button key={option.label} type="button" className="chat-ask-option" data-multi={question.multi ? '' : undefined} aria-pressed={picked.includes(option.label)} aria-keyshortcuts={keyed && n < KEYED ? String(n + 1) : undefined} onClick={() => onPick(option.label)}>
              <span className="ask-key num" aria-hidden="true">
                {keyed && n < KEYED ? n + 1 : ''}
              </span>
              <span className="chat-ask-words">
                <span className="chat-ask-label">{numbered(option.label)}</span>
                {option.description !== '' && <span className="chat-ask-desc">{numbered(option.description)}</span>}
              </span>
            </button>
          )
        )}
        <input
          type="text"
          className="chat-ask-other"
          aria-label={`Other answer to ${question.question}`}
          placeholder={offer ? 'or answer in your words' : 'Other'}
          value={other}
          onChange={(e) => onOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return
            if (pressed(e, 'field.keep')) {
              e.preventDefault()
              onAdvance()
            } else if (pressed(e, 'field.leave')) {
              e.preventDefault()
              giveKeysBack(e.currentTarget)
            }
          }}
        />
      </div>
    </fieldset>
  )
}

/** The most options of a question that have a key (`ask.option`). */
const KEYED = 9

function Questions({ item, answering, answer, keyed: onKey }: { item: Ask } & Answering & { keyed: MutableRefObject<((n: number) => void) | null> }) {
  const questions = questionsOf(item.input)
  /** The questions that offer a part to the shelf (#354): drawn as a table with buttons for answers. */
  const offers = questions.map(shelfOffer)
  const [picks, setPicks] = useState<string[][]>(() => questions.map(() => []))
  const [others, setOthers] = useState<string[]>(() => questions.map(() => ''))
  const open = item.state === 'open'
  const set = <T,>(list: T[], at: number, value: T): T[] => list.map((one, n) => (n === at ? value : one))
  const answers = questions.map((q, n) => answerFor(q, picks[n] ?? [], others[n] ?? ''))
  const complete = questions.length > 0 && answers.every((a) => a !== undefined)
  function pick(at: number, label: string): void {
    const now = picks[at] ?? []
    // One of a single choice; any number of a multiple one. A choice takes back what was written beside it.
    setPicks(set(picks, at, questions[at].multi ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : [label]))
    setOthers(set(others, at, ''))
    // A single choice is the answer to it: the next question comes, unless it is the only one.
    if (!questions[at].multi && summary) setStep(at + 1)
    // The offer of a shelf part is answered by its buttons: a choice is the answer, as there is no Submit to press.
    else if (!questions[at].multi && offers[at] !== null) answer({ allow: true, updatedInput: { answers: { [questions[at].question]: label } } })
  }
  function write(at: number, text: string): void {
    setOthers(set(others, at, text))
    if (text.trim() !== '') setPicks(set(picks, at, []))
  }
  function submit(): void {
    if (!complete) return
    answer({ allow: true, updatedInput: { answers: Object.fromEntries(questions.map((q, n) => [q.question, answers[n] as string])) } })
  }
  // One question at a time; with more than one, a last step reads the answers back before they are sent.
  const [step, setStep] = useState(0)
  const summary = questions.length > 1
  const last = summary ? questions.length : questions.length - 1
  const at = Math.min(step, last)
  const onSummary = summary && at === questions.length
  const go = (n: number): void => setStep(Math.max(0, Math.min(last, n)))
  // The keys 1 to 9 act on the question in view: a choice is picked (and the next question comes), a multiple one toggled.
  onKey.current = (n) => {
    const label = questions[at]?.options[n]?.label
    if (open && !answering && label !== undefined) pick(at, label)
  }
  const [reason, setReason] = useState('')
  if (questions.length === 0) {
    // Nothing to choose among that this window can draw: it says so, and the request can be refused.
    const deny = (): void => answer({ allow: false, message: reason.trim() || 'The person could not be shown the question.' })
    return (
      <>
        <h4 className="chat-ask-title">Claude Code {open ? 'asks' : 'asked'} a question</h4>
        <p className="chat-ask-why">The question could not be shown.</p>
        {open ? (
          <div className="chat-ask-actions">
            <Reason value={reason} onChange={setReason} onKeep={deny} />
            <button type="button" className="button" disabled={answering} onClick={deny}>
              Deny
            </button>
          </div>
        ) : (
          <Outcome item={item} said={{ allowed: 'Answered', denied: 'Declined' }} />
        )}
      </>
    )
  }
  return (
    <>
      <h4 className="chat-ask-title">Claude Code {open ? 'asks' : 'asked'} {questions.length === 1 ? 'a question' : 'some questions'}</h4>
      {open ? (
        <>
          {summary && (
            <div className="chat-ask-steps">
              <span className="chat-ask-step num">{onSummary ? 'Review' : `${at + 1} of ${questions.length}`}</span>
              {!onSummary && questions[at].header !== '' && <span className="chat-ask-header">{numbered(questions[at].header)}</span>}
              <span className="chat-ask-dots" aria-hidden="true">
                {answers.map((a, n) => (
                  <i key={n} data-state={n === at ? 'now' : a !== undefined ? 'done' : 'todo'} />
                ))}
              </span>
            </div>
          )}
          {!summary && questions[0].header !== '' && (
            <div className="chat-ask-steps">
              <span className="chat-ask-header">{numbered(questions[0].header)}</span>
            </div>
          )}
          {onSummary ? (
            <ul className="chat-ask-recap">
              {questions.map((q, n) => (
                <li key={n}>
                  <button type="button" className="chat-ask-recap-row" disabled={answering} onClick={() => go(n)} aria-label={`Change the answer to ${q.question}`}>
                    <span className="chat-ask-recap-q">{numbered(q.question)}</span>
                    <span className="chat-ask-recap-a" data-empty={answers[n] === undefined ? '' : undefined}>
                      {answers[n] === undefined ? 'Not answered' : numbered(answers[n] as string)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <QuestionView key={at} question={questions[at]} offer={offers[at]} picked={picks[at] ?? []} other={others[at] ?? ''} onPick={(label) => pick(at, label)} onOther={(t) => write(at, t)} disabled={answering} keyed onAdvance={() => (summary ? go(at + 1) : submit())} />
          )}
          <div className="chat-ask-actions">
            {summary && (
              <button type="button" className="button" disabled={at === 0 || answering} onClick={() => go(at - 1)}>
                Back
              </button>
            )}
            {summary && !onSummary && (
              <button type="button" className="button" disabled={answering} onClick={() => go(at + 1)}>
                {answers[at] === undefined ? 'Skip' : 'Next'}
              </button>
            )}
            {(!summary || onSummary) && (offers[0] === null || summary || (others[0] ?? '').trim() !== '') && (
              <button type="button" className="button button-primary" disabled={!complete || answering} onClick={submit}>
                {summary ? 'Send answers' : 'Submit'}
              </button>
            )}
          </div>
        </>
      ) : offers.every((o) => o !== null) && item.state !== 'denied' ? (
        <Held offers={offers as Offer[]} answers={answersIn(questions.map((q) => q.question), item.answer ?? '')} item={item} />
      ) : (
        <>
          {item.answer && <pre className="chat-ask-answers selectable">{numbered(item.answer)}</pre>}
          <Outcome item={item} said={{ allowed: 'Answered', denied: 'Declined' }} />
        </>
      )}
    </>
  )
}

/** Offers of the shelf once done: each as the open card drew it (title and table) and, beneath, what was answered, in the line a card says it with; no raw text. */
function Held({ offers, answers, item }: { offers: Offer[]; answers: Array<string | undefined>; item: Ask }) {
  return (
    <>
      {offers.map((offer, n) => (
        <div key={n} className="chat-ask-held" data-offer="shelf">
          <p className="chat-ask-text selectable">{numbered(offer.title)}</p>
          <ShelfOffer offer={offer} />
          {item.state === 'allowed' && answers[n] !== undefined && (
            <p className="chat-ask-outcome selectable">Answered: {numbered(answers[n] as string)}</p>
          )}
        </div>
      ))}
      {(item.state === 'ended' || answers.every((a) => a === undefined)) && <Outcome item={item} said={{ allowed: 'Answered', denied: 'Declined' }} />}
    </>
  )
}

/**
 * A request of the agent's to the person: to use a tool (Allow, Allow for this session when the CLI suggested a rule, Deny with a
 * reason), a plan to leave plan mode with, or the questions of `AskUserQuestion`. While it is open it takes the foot of the chat
 * (`where` "foot": `Takeover`, which has the focus once unless the person is writing) and the transcript holds a line for it; once
 * answered or ended it is the card in the transcript that says how it was answered. Its buttons are ordinary buttons.
 */
export const AskCard = memo(function AskCard({ item, where = 'log' }: { item: Ask; where?: 'log' | 'foot' }) {
  const { answering, answer } = useAnswer(item)
  /** What the keys 1 to 9 do, set by the question being drawn. */
  const keyed = useRef<((n: number) => void) | null>(null)
  // Open, the transcript holds only a line: the request is at the foot.
  if (item.state === 'open' && where === 'log') return <WaitsBelow />
  const body = item.toolName === 'AskUserQuestion' ? <Questions item={item} answering={answering} answer={answer} keyed={keyed} /> : item.toolName === 'ExitPlanMode' ? <Plan item={item} answering={answering} answer={answer} /> : <Permission item={item} answering={answering} answer={answer} />
  const props = {
    'aria-label': 'Request from Claude Code',
    'data-kind': 'ask',
    'data-state': item.state,
    'data-tool': item.toolName,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      // The keys 1 to 9 choose among the options of a question, anywhere but in a field.
      if (where === 'foot' && item.state === 'open' && item.toolName === 'AskUserQuestion' && !e.nativeEvent.isComposing && !isEditable(e.target as HTMLElement)) {
        const n = which(e, 'ask.option')
        if (n >= 0) {
          e.preventDefault()
          // The press is this block's: the view's own keys for the same digits do not hear it.
          e.nativeEvent.stopPropagation()
          keyed.current?.(n)
          return
        }
      }
      // The card itself in focus, not a button or a field in it: those keep their own Enter. Questions are chosen, not allowed.
      if (e.target !== e.currentTarget || e.nativeEvent.isComposing || item.state !== 'open' || item.toolName === 'AskUserQuestion' || answering) return
      if (pressed(e, 'chat.allow')) {
        e.preventDefault()
        answer({ allow: true })
      }
    }
  }
  return where === 'foot' ? (
    <Takeover ask="request" focusKey={item.requestId} className="chat-ask" {...props}>
      {body}
    </Takeover>
  ) : (
    <section className="chat-item chat-ask" tabIndex={-1} {...props}>
      {body}
    </section>
  )
})
