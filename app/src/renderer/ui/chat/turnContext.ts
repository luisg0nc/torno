import { createContext } from 'react'

/**
 * The id of the turn that the Undo fallback of "Go back to before this prompt" is offered on, or none: the last turn of a
 * live chat whose session is idle, with no prompt of the person's after it (`ChatPane` works it out). Only a project whose
 * build was not kept (no copy to put back) is asked to undo, and only there.
 */
export const UndoableTurn = createContext<string | undefined>(undefined)

/** Whether the session is at rest: a Go back is refused while Claude works (main says so too). */
export const ChatIdle = createContext(false)

/** The numbers of the person's prompts in the chat, by the id of their `user` item: how a Go back names the prompts it undoes. */
export const PromptNumbers = createContext<Map<string, number>>(new Map())
