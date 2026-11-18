import { type AskAnswer, type AskEnd, type AskRequest, type OpenAsk, answerOf } from '../shared/ask'

/**
 * The questions of the agents that wait for the person (`ask`): at most one for each object. Main keeps them, tells
 * the window the list every time it changes, and is told the answer; the one who asked is waiting on `ask`.
 * A question ends when it is answered, when its signal fires (the agent gave it up, or the time was up), when the
 * window goes, and with its session.
 */
export class Asks {
  private readonly list = new Map<number, { ask: OpenAsk; done: (result: AskAnswer | AskEnd) => void }>()
  private next = 1

  constructor(
    /** Tells the window the questions that are open now. */
    private readonly told: (asks: OpenAsk[]) => void,
    /** A question opened for an object: its session shows `needs_input` until the returned function is called. */
    private readonly hold: (objectId: string) => () => void = () => () => {}
  ) {}

  /** The questions open now, oldest first. */
  open(): OpenAsk[] {
    return [...this.list.values()].map((one) => one.ask)
  }

  /** Whether an object has a question open. */
  has(objectId: string): boolean {
    return this.open().some((ask) => ask.objectId === objectId)
  }

  /** The question an object waits on, if it has one open. */
  of(objectId: string): OpenAsk | undefined {
    return this.open().find((ask) => ask.objectId === objectId)
  }

  /** Puts a question and waits for what ends it. The caller checks that the object has none open. */
  ask(objectId: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer | AskEnd> {
    return new Promise((resolve) => {
      const id = this.next++
      const release = this.hold(objectId)
      const finish = (result: AskAnswer | AskEnd): void => {
        if (!this.list.delete(id)) return
        signal?.removeEventListener('abort', aborted)
        release()
        this.told(this.open())
        resolve(result)
      }
      const aborted = (): void => finish({ kind: 'ended', why: 'aborted' })
      this.list.set(id, { ask: { ...request, id, objectId, since: Date.now() }, done: finish })
      if (signal?.aborted) return aborted()
      signal?.addEventListener('abort', aborted, { once: true })
      this.told(this.open())
    })
  }

  /** The window's answer to question `id`. One that is late, twice, or not an answer to that question, does nothing. */
  answer(id: number, value: unknown): void {
    const one = this.list.get(id)
    if (!one) return
    const answer = answerOf(value, one.ask.options.length)
    if (!answer || (answer.kind === 'pick' && !one.ask.pick)) return
    one.done(answer)
  }

  /** The window or the session is gone: nobody can answer what is open (of one object, or of all). */
  end(objectId?: string): void {
    for (const { ask, done } of [...this.list.values()]) if (objectId === undefined || ask.objectId === objectId) done({ kind: 'ended', why: 'closed' })
  }
}
