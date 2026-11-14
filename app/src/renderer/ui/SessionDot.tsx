import { SIGN_SAID, type Sign } from './sessionSign'

/**
 * The sign of a session away from its pane: the status line's dot, still. A session at work is the quiet dot; one
 * that needs the person is the warning colour, a little larger, and says so in words where `word` is set (a row of
 * the list), or in the words given (a place that names another object's); the toggle of the dock has no room,
 * so it is the larger dot, and its label says it. The element that holds it names the state for a screen reader: the
 * dot is no more than a picture of it.
 */
export function SessionDot({ sign, word = false }: { sign: Sign; word?: boolean | string }) {
  return (
    <span className="session-sign" data-sign={sign} aria-hidden="true">
      <span className="status-dot" />
      {word !== false && sign === 'needs_input' && <span className="session-sign-word">{word === true ? SIGN_SAID.needs_input : word}</span>}
    </span>
  )
}
