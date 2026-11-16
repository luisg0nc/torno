import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { hint, pressed } from '../../../shared/keys'
import { MAX_PDF_BYTES, MAX_PHOTO_BYTES, MAX_STEP_BYTES, moduleName, MOST_REFERENCES, objectNameProblem, PDF_FORMATS, STEP_FORMATS } from '../../../shared/objectName'
import { MAX_SIZES } from '../../../shared/size'
import { actions, store, useStore } from '../../state/store'
import { draftHas, onboard, onboarding, sizeProblem, useOnboard, type Stroke } from '../../state/onboard'
import { Confirm } from '../Confirm'
import { numbered } from '../numbered'
import { Readiness } from '../Readiness'
import { isScan, NO_PATH } from '../scanDrop'
import { TYPING, giveKeysBack } from '../typing'
import { Doodle } from './Doodle'
import { HEIC_REASON, prepareImage } from './images'
import { DraftPaneLive } from './DraftPane'
import { LinksSlot } from './LinksSlot'
import { makeObject, reason } from './make'
import { ObjectMenu, ReferenceCards } from './ReferenceItems'
import { RulesSlot } from './RulesSlot'
import { SessionChoice } from './SessionChoice'
import { Slot, SlotWords } from './Slot'
import { SizesSlot } from './SizesSlot'

/** Brings the page of a new object up over what is shown, and goes on with the draft there is. */
export function openNewObject(): void {
  const s = store.getState()
  if (!s.workspace || s.page === 'new') return
  onboarding.begin(s.page === 'objects' ? 'objects' : 'object')
  actions.showPage('new')
}

/** Back to where the page was opened from; with no object open, the page of objects. */
function leaveNewObject(): void {
  actions.showPage(onboard.getState().from === 'object' && store.getState().objectId !== null ? 'object' : 'objects')
}

const IMAGE_ENDINGS = ['.png', '.jpg', '.jpeg', '.webp']
const isImage = (name: string): boolean => IMAGE_ENDINGS.some((end) => name.toLowerCase().endsWith(end))
const isStep = (name: string): boolean => STEP_FORMATS.some((end) => name.toLowerCase().endsWith(end))
const isPdf = (name: string): boolean => PDF_FORMATS.some((end) => name.toLowerCase().endsWith(end))
const basename = (path: string): string => path.split(/[\\/]/).pop() || path
/** Elements of the page that ask something of their own, or lie over it: the page leaves its keys to them. */
const LAYER = '[role="dialog"], [role="alertdialog"], [role="menu"]'

interface Source {
  path: string
  name: string
  bytes: () => Promise<Uint8Array>
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** The slots that open to an editor of their own, and stay open while they are empty. */
type Opened = 'sizes' | 'links' | 'rules'

/**
 * The page of a new project, in place of the viewport: its name; "What are we making?" (the brief and the photos with
 * their notes); a tile for each other thing the person has (a sketch, bought parts, scans, other projects, sizes,
 * links and PDFs, rules), which becomes its cards or rows once something is in it; and, at the right, what Claude gets
 * first and the buttons that make the project. Nothing is written until Start (`makeObject`). The draft is the window's
 * (`state/onboard.ts`); a dropped file is taken by its path, and a picture is scaled here for the prompt.
 */
export function NewObject({ onOpen }: { onOpen: (id: string) => Promise<void> }) {
  const workspace = useStore((s) => s.workspace)!
  const draft = useOnboard((s) => s.draft)
  const choice = useOnboard((s) => s.choice)
  const ids = workspace.objects.map((o) => o.id)
  const wsName = basename(workspace.root)
  const page = useRef<HTMLElement>(null)
  const nameField = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'start' | 'make' | null>(null)
  const [reading, setReading] = useState(0)
  const [said, setSaid] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [madeAlready, setMadeAlready] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  const [dragging, setDragging] = useState(false)
  /** The board: closed, or open on a new doodle (`uid: null`) or on one to change. */
  const [board, setBoard] = useState<{ uid: string | null } | null>(null)
  const boardOpen = useRef(false)
  boardOpen.current = board !== null
  const asked = useRef(false)
  asked.current = asking
  const [opened, setOpened] = useState<readonly Opened[]>([])
  /** The slot whose first field takes the focus once it is on the page. */
  const [focusSlot, setFocusSlot] = useState<string | null>(null)

  /** Every entry of the workspace folder, as main reads it: a folder that is no object, a file, is a name taken too. */
  const [taken, setTaken] = useState<string[]>([])
  const refreshTaken = useCallback((): void => void window.torno.objects.taken().then(setTaken, () => {}), [])
  useEffect(refreshTaken, [refreshTaken])
  const working = busy !== null
  const busyNow = useRef(false)
  busyNow.current = working

  const nameProblem = draft.name === '' ? null : objectNameProblem(draft.name, [...new Set([...ids, ...taken])])
  const sizeIssue = draft.sizes.some((s) => sizeProblem(s) !== null)
  const ready = draft.name !== '' && nameProblem === null && draft.description.trim() !== '' && !sizeIssue
  const files = draft.photos.length + draft.doodles.length + draft.steps.length + draft.pdfs.length
  const module = moduleName(draft.name)
  const isOpen = (slot: Opened): boolean => opened.includes(slot)
  const open = (slot: Opened): void => {
    setOpened((now) => (now.includes(slot) ? now : [...now, slot]))
    setFocusSlot(slot)
  }

  // The first field of a slot that was just asked for takes the focus.
  useEffect(() => {
    if (focusSlot === null) return
    const fields = page.current?.querySelectorAll<HTMLElement>(`[data-slot="${focusSlot}"] [data-first]`)
    fields?.[fields.length - 1]?.focus()
    setFocusSlot(null)
  }, [focusSlot, draft.sizes.length, opened])

  // The page takes the focus when it comes, and gives it back to where it was when it goes.
  useEffect(() => {
    const before = document.activeElement
    nameField.current?.focus()
    return () => {
      const now = document.activeElement
      if (before instanceof HTMLElement && before.isConnected && (now === null || now === document.body || !now.isConnected)) before.focus()
    }
  }, [])

  const leave = useCallback((): void => {
    // While the object is made nothing can drop the draft.
    if (busyNow.current) return
    if (draftHas(onboard.getState().draft)) setAsking(true)
    else leaveNewObject()
  }, [])

  // The keys are the page's while it is up: Escape leaves it, S sketches, and no tool of the view under it is handed a key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      const here = target !== null && page.current!.contains(target)
      // The board has its own keys and the sheet of keys is asked for here as everywhere; what asks something of its own keeps its keys.
      if (boardOpen.current) return
      if (!here && target?.closest(`${TYPING}, input, ${LAYER}`)) return
      if (here && target.closest(LAYER)) return
      if (pressed(e, 'keys') && !target?.closest(TYPING)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (target?.closest(TYPING) && here) {
        // In a field the keys are the field's, but for Escape: it leaves the field, and the page when there is nothing in it to lose.
        if (!pressed(e, 'new.back')) return
        e.preventDefault()
        e.stopPropagation()
        if (busyNow.current) return
        if (draftHas(onboard.getState().draft)) giveKeysBack(target as HTMLElement)
        else leaveNewObject()
        return
      }
      e.stopPropagation()
      if (pressed(e, 'new.back')) {
        e.preventDefault()
        if (!asked.current) leave()
      } else if (pressed(e, 'new.sketch')) {
        e.preventDefault()
        if (!asked.current && !busyNow.current && onboard.getState().draft.doodles.length < MOST_REFERENCES.doodles) setBoard({ uid: null })
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [leave])

  /** Takes pictures in: each is read, scaled for the prompt and drawn small; one that cannot be read is said, the others go in. */
  async function takePhotos(sources: Source[]): Promise<void> {
    setSaid(null)
    const epoch = onboarding.epoch()
    setReading((n) => n + sources.length)
    const problems: string[] = []
    const ready: Parameters<typeof onboarding.addPhotos>[0] = []
    for (const source of sources) {
      try {
        const prepared = await prepareImage(await source.bytes(), source.name)
        const detail =
          prepared.from.width === prepared.width && prepared.from.height === prepared.height
            ? `${prepared.from.width} × ${prepared.from.height}`
            : `${prepared.from.width} × ${prepared.from.height}, sent at ${prepared.width} × ${prepared.height}`
        ready.push({ path: source.path, file: source.name, image: prepared.image, url: URL.createObjectURL(new Blob([prepared.image as BlobPart], { type: prepared.type })), detail })
      } catch (e) {
        problems.push(reason(e))
      }
      setReading((n) => n - 1)
    }
    // The draft was thrown away while these were being read: they are not put back into it.
    if (onboarding.epoch() !== epoch) {
      for (const item of ready) URL.revokeObjectURL(item.url)
      return
    }
    const { left, same } = onboarding.addPhotos(ready)
    if (left > 0) problems.push(`${plural(left, 'photo was', 'photos were')} left out: at most ${MOST_REFERENCES.photos}.`)
    if (same > 0) problems.push(`${plural(same, 'photo is', 'photos are')} there already.`)
    if (problems.length > 0) setSaid(problems.join(' '))
  }

  async function addPhotos(): Promise<void> {
    const paths = await window.torno.objects.pickPhotos().catch(() => [] as string[])
    await takePhotos(paths.map((path) => ({ path, name: basename(path), bytes: () => window.torno.objects.readPhoto(path) })))
  }

  async function addScan(): Promise<void> {
    const path = await window.torno.objects.pickScan().catch(() => null)
    if (path === null) return
    setSaid(onboarding.addScan({ path, file: basename(path) }) ? null : scanRefused(path))
  }
  async function addStep(): Promise<void> {
    const path = await window.torno.objects.pickStep().catch(() => null)
    if (path === null) return
    setSaid(onboarding.addStep({ path, file: basename(path) }) ? null : stepRefused(path))
  }
  async function addPdf(): Promise<void> {
    const path = await window.torno.objects.pickPdf().catch(() => null)
    if (path === null) return
    setSaid(onboarding.addPdf({ path, file: basename(path) }))
  }
  const stepRefused = (path: string): string => (onboard.getState().draft.steps.some((s) => s.path === path) ? `${basename(path)} is there already.` : `At most ${MOST_REFERENCES.steps} bought parts.`)
  const scanRefused = (path: string): string => (onboard.getState().draft.scans.some((s) => s.path === path) ? `${basename(path)} is there already.` : `At most ${MOST_REFERENCES.scans} scans.`)

  /** Files taken in, by what they are: pictures are photos, `.step` and `.stp` bought parts, `.pdf` PDFs, the formats of a scan scans. */
  function taking(list: readonly File[]): void {
    const pictures: Source[] = []
    const problems: string[] = []
    for (const file of list) {
      const path = window.torno.objects.pathOf(file)
      if (isStep(file.name)) {
        // The size first: a file over the cap is never copied, whatever else is said of it.
        if (file.size > MAX_STEP_BYTES) problems.push(`${file.name} is over ${MAX_STEP_BYTES / (1024 * 1024)} MB.`)
        else if (!path) problems.push(`${file.name}: ${NO_PATH}`)
        else if (!onboarding.addStep({ path, file: file.name, size: file.size })) problems.push(stepRefused(path))
      } else if (isPdf(file.name)) {
        if (file.size > MAX_PDF_BYTES) problems.push(`${file.name} is over ${MAX_PDF_BYTES / (1024 * 1024)} MB.`)
        else if (!path) problems.push(`${file.name}: ${NO_PATH}`)
        else {
          const why = onboarding.addPdf({ path, file: file.name, size: file.size })
          if (why !== null) problems.push(why)
        }
      } else if (isScan(file.name)) {
        if (!path) problems.push(`${file.name}: ${NO_PATH}`)
        else if (!onboarding.addScan({ path, file: file.name, size: file.size })) problems.push(scanRefused(path))
      } else if (isImage(file.name)) {
        // The size first: a file over the cap is never read, whatever else is said of it.
        if (file.size > MAX_PHOTO_BYTES) problems.push(`${file.name} is over ${MAX_PHOTO_BYTES / (1024 * 1024)} MB.`)
        else if (!path) problems.push(`${file.name}: ${NO_PATH}`)
        else pictures.push({ path, name: file.name, bytes: async () => new Uint8Array(await file.arrayBuffer()) })
      } else if (/\.(heic|heif)$/i.test(file.name)) problems.push(`${file.name}: ${HEIC_REASON}`)
      else problems.push(`${file.name} is neither a picture, a STEP file, a PDF nor a scan.`)
    }
    setSaid(problems.length > 0 ? problems.join(' ') : null)
    if (pictures.length > 0) void takePhotos(pictures).then(() => problems.length > 0 && setSaid((now) => [...problems, ...(now ? [now] : [])].join(' ')))
  }
  const dropped = (list: FileList): void => taking([...list])
  const carriesFiles = (e: DragEvent): boolean => [...e.dataTransfer.types].includes('Files')

  // An image pasted anywhere on the page is taken as a dropped one is: a picture has to be a file on the disk (a copied file is; a screenshot is not).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/') || isImage(f.name))
      if (pasted.length === 0 || boardOpen.current || asked.current || busyNow.current) return
      e.preventDefault()
      // A picture with no name is one the system made on the spot: it is named by its kind.
      taking(pasted.map((f) => (f.name === '' || f.name === 'image.png' ? new File([f], `pasted.${f.type.split('/')[1] ?? 'png'}`, { type: f.type }) : f)))
    }
    window.addEventListener('paste', onPaste, true)
    return () => window.removeEventListener('paste', onPaste, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function create(start: boolean): Promise<void> {
    if (working || !ready) return
    setBusy(start ? 'start' : 'make')
    setProblem(null)
    const root = store.getState().workspace?.root
    const outcome = await makeObject(
      onboard.getState().draft,
      {
        create: (req) => window.torno.objects.create(req),
        onboard: async (id, d) => {
          const told = await window.torno.objects.onboard(id, d)
          // The session was started by main: this window learns of it as it does when it is asked for one.
          if (told.sessionId !== null) {
            const info = await window.torno.session.current(id).catch(() => null)
            if (info?.running && !store.getState().sessions[id]) actions.setSession(id, info.running)
          }
          return told
        },
        listed: async () => {
          const info = await window.torno.workspace.current().catch(() => null)
          if (info) actions.refreshWorkspace(info)
          return info?.objects.map((o) => o.id) ?? []
        },
        open: async (id) => {
          await onOpen(id)
          // Another object chosen meanwhile supersedes this one: it is not shown, and is said not to be.
          if (store.getState().objectId !== id) throw new Error('not shown')
        },
        sameWorkspace: () => store.getState().workspace?.root === root,
        folderOf: (id) => `${root}/${id}`,
        discard: () => onboarding.discard(),
        hold: (id, held) => onboarding.hold(id, held)
      },
      onboard.getState().choice,
      start
    )
    if (outcome.kind === 'refused') setProblem(outcome.message)
    else if (outcome.kind === 'made') setMadeAlready(outcome.message)
    else if (outcome.kind === 'done' && outcome.shown === false) {
      // The object is made and listed, and another is on show: back to the page of objects, where it is.
      actions.showPage('objects')
    }
    setBusy(null)
    refreshTaken()
  }

  const editing = board?.uid ? draft.doodles.find((d) => d.uid === board.uid) : undefined
  const free = (kind: keyof typeof MOST_REFERENCES): boolean => draft[kind].length < MOST_REFERENCES[kind]
  const otherIds = ids.filter((id) => !draft.objects.some((o) => o.id === id))
  const addAnother = (what: string, onClick: () => void, off: boolean) => (
    <button type="button" className="button button-quiet" aria-label={`${what}, add another`} disabled={working || off} onClick={onClick}>
      Add another
    </button>
  )

  return (
    <>
    <section
      ref={page}
      className="show new-object"
      aria-label="New project"
      tabIndex={-1}
      data-dragging={dragging ? '' : undefined}
      onDragOver={(e) => {
        if (!carriesFiles(e) || working) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false)
      }}
      onDrop={(e) => {
        setDragging(false)
        if (!carriesFiles(e) || working) return
        e.preventDefault()
        dropped(e.dataTransfer.files)
      }}
    >
      <div className="new-layout">
        <div className="new-column">
          <header className="new-head">
            <div className="new-head-words">
              <h2>New project</h2>
              <p className="new-lead">Nothing is written until you start.</p>
            </div>
            <button type="button" className="button" disabled={working} title={`Leave this page (${hint('new.back')})`} onClick={leave}>
              Discard
            </button>
          </header>

          {madeAlready !== null && (
            <p className="new-problem" role="alert">
              {numbered(madeAlready)} It is not made again.
            </p>
          )}

          <div className="new-field">
            <label htmlFor="new-name">Name</label>
            <input id="new-name" ref={nameField} className="new-input num" type="text" value={draft.name} spellCheck={false} autoComplete="off" disabled={working} aria-invalid={nameProblem !== null} aria-describedby="new-name-help" onChange={(e) => onboarding.setName(e.target.value)} />
            <p id="new-name-help" className="new-help" data-tone={nameProblem ? 'fail' : undefined}>
              {nameProblem ?? "The folder's name: letters, digits, - _ (no dots)"}
            </p>
          </div>

          <section className="new-brief" aria-labelledby="new-making">
            <h3 className="new-label" id="new-making">
              What are we making?
            </h3>
            <p className="new-help">Drop anything that says what it is. Every card goes to Claude with the first prompt, and stays on the project&apos;s board after.</p>
            <label className="new-sub" htmlFor="new-what">
              What is it?
            </label>
            <textarea
              id="new-what"
              className="new-input new-what"
              rows={5}
              value={draft.description}
              disabled={working}
              placeholder="A clip that holds a 6 mm cable to the edge of a desk, printed in PETG…"
              onChange={(e) => onboarding.setDescription(e.target.value)}
            />
            <p className="new-help">What it is for, what it must fit or hold, how it will be made.</p>
            <ReferenceCards draft={draft} kinds={['photos']} label="Photos" onEditDoodle={() => {}} />
            <div className="new-add">
              <button type="button" className="button" disabled={working || !free('photos')} onClick={() => void addPhotos()}>
                Add photos…
              </button>
            </div>
          </section>

          <div className="slots" role="group" aria-label="What else you have">
            <Slot
              id="sketch"
              icon="sketch"
              title="Sketch it"
              hint="A doodle on a grid, or over a photo"
              filled={draft.doodles.length > 0}
              tile={
                <button type="button" className="slot-tile" disabled={working || !free('doodles')} onClick={() => setBoard({ uid: null })}>
                  <SlotWords icon="sketch" title="Sketch it" hint="A doodle on a grid, or over a photo" />
                </button>
              }
              add={addAnother('Sketch it', () => setBoard({ uid: null }), !free('doodles'))}
            >
              <ReferenceCards draft={draft} kinds={['doodles']} label="Sketches" onEditDoodle={(key) => setBoard({ uid: key })} />
            </Slot>

            <Slot
              id="steps"
              icon="part"
              title="Bought parts"
              hint="A vendor's STEP, kept as an obstacle"
              filled={draft.steps.length > 0}
              tile={
                <button type="button" className="slot-tile" disabled={working || !free('steps')} title="A vendor's STEP file of a screw, a bearing, a board: copied into reference/ for Claude to place as a bought part" onClick={() => void addStep()}>
                  <SlotWords icon="part" title="Bought parts" hint="A vendor's STEP, kept as an obstacle" />
                </button>
              }
              add={addAnother('Bought parts', () => void addStep(), !free('steps'))}
            >
              <ReferenceCards draft={draft} kinds={['steps']} label="Bought parts" onEditDoodle={() => {}} />
            </Slot>

            <Slot
              id="scans"
              icon="scan"
              title="Scans"
              hint="A 3D scan of where it goes"
              filled={draft.scans.length > 0}
              tile={
                <button type="button" className="slot-tile" disabled={working || !free('scans')} onClick={() => void addScan()}>
                  <SlotWords icon="scan" title="Scans" hint="A 3D scan of where it goes" />
                </button>
              }
              add={addAnother('Scans', () => void addScan(), !free('scans'))}
            >
              <ReferenceCards draft={draft} kinds={['scans']} label="Scans" onEditDoodle={() => {}} />
            </Slot>

            <Slot
              id="objects"
              icon="project"
              title="Other projects"
              hint="Parts from this workspace it must fit"
              filled={draft.objects.length > 0}
              tile={
                <ObjectMenu ids={otherIds} disabled={working || !free('objects')} onChoose={(id) => void onboarding.addObject(id)} className="slot-tile" label="Other projects">
                  <SlotWords icon="project" title="Other projects" hint="Parts from this workspace it must fit" />
                </ObjectMenu>
              }
              add={
                <ObjectMenu ids={otherIds} disabled={working || !free('objects')} onChoose={(id) => void onboarding.addObject(id)} className="button button-quiet" label="Other projects, add another">
                  Add another
                </ObjectMenu>
              }
            >
              <ReferenceCards draft={draft} kinds={['objects']} label="Other projects" onEditDoodle={() => {}} />
            </Slot>

            <Slot
              id="sizes"
              icon="size"
              title="Sizes I know"
              hint="Measured, from a datasheet, or a guess"
              filled={draft.sizes.length > 0 || isOpen('sizes')}
              tile={
                <button
                  type="button"
                  className="slot-tile"
                  disabled={working}
                  onClick={() => {
                    setSaid(onboarding.addSize())
                    open('sizes')
                  }}
                >
                  <SlotWords icon="size" title="Sizes I know" hint="Measured, from a datasheet, or a guess" />
                </button>
              }
              add={
                <button
                  type="button"
                  className="button button-quiet"
                  disabled={working || draft.sizes.length >= MAX_SIZES}
                  onClick={() => {
                    setSaid(onboarding.addSize())
                    setFocusSlot('sizes')
                  }}
                >
                  + add a size
                </button>
              }
            >
              <SizesSlot sizes={draft.sizes} disabled={working} />
            </Slot>

            <Slot
              id="links"
              icon="link"
              title="Links and PDFs"
              hint="A datasheet, a forum thread"
              filled={draft.links.length + draft.pdfs.length > 0 || isOpen('links')}
              tile={
                <button type="button" className="slot-tile" disabled={working} onClick={() => open('links')}>
                  <SlotWords icon="link" title="Links and PDFs" hint="A datasheet, a forum thread" />
                </button>
              }
            >
              <LinksSlot draft={draft} disabled={working} onAddPdf={() => void addPdf()} onSaid={setSaid} />
            </Slot>

            <Slot
              id="rules"
              icon="rules"
              title="Rules"
              hint="Printer, material, min wall"
              filled={draft.rules !== '' || isOpen('rules')}
              tile={
                <button type="button" className="slot-tile" disabled={working} onClick={() => open('rules')}>
                  <SlotWords icon="rules" title="Rules" hint="Printer, material, min wall" />
                </button>
              }
            >
              <RulesSlot rules={draft.rules} disabled={working} onRefused={setSaid} />
            </Slot>
          </div>

          <p className="new-help new-reading" role="status">
            {reading > 0 && <>Reading {numbered(plural(reading, 'picture', 'pictures'))}… </>}
          </p>
          {said !== null && (
            <p className="new-help" data-tone="warn" role="status">
              {numbered(said)}
            </p>
          )}
          <p className="new-hint">
            Drop files anywhere · paste an image · <span className="num">{hint('new.sketch')}</span> sketch
          </p>
        </div>

        <aside className="new-side" aria-label="The first prompt">
          <DraftPaneLive />
          <div className="new-will-block">
            <p className="new-will">
              {ready ? (
                <>
                  Makes <span className="num">{wsName}/{draft.name}/</span> with <span className="num">{module}.py</span> (a placeholder to be replaced), <span className="num">brief.md</span>
                  {files > 0 && (
                    <>
                      {' '}and <span className="num">reference/</span> ({numbered(plural(files, 'file', 'files'))})
                    </>
                  )}
                  , and lays what you gave out on its board.
                  {draft.scans.length > 0 && <> {draft.scans.length === 1 ? 'The scan is' : 'The scans are'} imported into the project, not copied, once Claude starts.</>}
                </>
              ) : sizeIssue && draft.name !== '' && nameProblem === null && draft.description.trim() !== '' ? (
                'Finish or remove the sizes that are not whole.'
              ) : (
                'Give it a name and say what it is to start.'
              )}
            </p>
          </div>
          <div className="new-foot">
            {/* What is missing, before the folder is made: the object is made without it, and the agent cannot start in it. */}
            <Readiness variant="missing" />
            {problem !== null && (
              <p className="new-problem" role="alert">
                {numbered(problem)}
              </p>
            )}
            <SessionChoice choice={choice} disabled={working} onChange={onboarding.setChoice} />
            <button type="button" className="button button-primary new-start" disabled={!ready || working || reading > 0} onClick={() => void create(true)}>
              {busy === 'start' ? 'Starting…' : 'Start: make the project and ask Claude'}
            </button>
            <button type="button" className="button button-quiet new-make" disabled={!ready || working || reading > 0} onClick={() => void create(false)}>
              {busy === 'make' ? 'Making…' : 'Or make it without starting Claude'}
            </button>
          </div>
        </aside>
      </div>

      {asking && (
        <div className="new-confirm">
          <Confirm
            label="Discard this new project?"
            accept="Discard"
            cancel="Keep editing"
            onCancel={() => {
              setAsking(false)
              nameField.current?.focus()
            }}
            onAccept={() => {
              setAsking(false)
              onboarding.discard()
              leaveNewObject()
            }}
          >
            Discard this new project? What you wrote and gave is not kept anywhere else.
          </Confirm>
        </div>
      )}

    </section>
    {/* Over the page, not in its scroll: the board is a sheet of its own. */}
    {board !== null && (
      <Doodle
        initial={editing?.strokes ?? []}
        photos={draft.photos}
        over={editing?.over}
        onCancel={() => setBoard(null)}
        onDone={(strokes: Stroke[], png: Uint8Array, over: string | undefined) => {
          const item = { strokes, png, url: URL.createObjectURL(new Blob([png as BlobPart], { type: 'image/png' })), ...(over === undefined ? {} : { over }) }
          if (board.uid) onboarding.replaceDoodle(board.uid, item)
          else onboarding.addDoodle(item)
          setBoard(null)
        }}
      />
    )}
    </>
  )
}
