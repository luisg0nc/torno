import { describe, expect, it } from 'vitest'
import { TOOLS } from './mcp/schemas'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DIMENSIONS_TEXT, FULL_PROMPT, SCANS_TEXT, SYSTEM_PROMPT, systemPrompt } from './prompt'
import { PROMPTS } from './mcp/prompts'
import { SETTLE, onboardPrompt } from './onboard'

// The whole text, as Claude Code is told it when it is not given torno's skills; with them, below.
describe('the system prompt', () => {
  it('says what each thing means that a prompt may say of a mark, and what its other lines are', () => {
    // As `contextFor` and `describeMark` write them.
    for (const said of ['(changed)', 'reopened by the user', '[not checked against rN]', '"Selected:"', '"Marks still open"']) expect(FULL_PROMPT).toContain(said)
  })

  it('says the build comes back with an edit, and still to look', () => {
    expect(SYSTEM_PROMPT).toContain('The build result of an edit comes back with what it did to the parts')
    expect(SYSTEM_PROMPT).toContain('mend it or say why.')
    expect(SYSTEM_PROMPT).not.toContain('Look at the result before saying it is done')
    expect(SYSTEM_PROMPT).not.toContain('After every edit, always check the build status with scene')
  })

  it('says that new marks and the dimensions that fail come with the prompt, as the tools that read them say', () => {
    expect(FULL_PROMPT).toContain('New marks arrive with the prompt')
    expect(FULL_PROMPT).toContain('with every prompt until they pass')
    expect(TOOLS.marks.description).toContain('new ones are told to you with the prompt, a line each')
    expect(TOOLS.add_mark.description).toContain('it is told to you again with every prompt for as long as it fails')
  })

  it('says the board is the person\'s brief, that its sizes and rules come with the first prompt, and that cards are added with add_card and never rearranged', () => {
    const sentence = "The board is the person's brief; its sizes and rules come with a conversation's first prompt. Add a plan or picture with mcp__torno__add_card; never rearrange their cards."
    expect(FULL_PROMPT).toContain(sentence)
    expect(SYSTEM_PROMPT).toContain(sentence)
  })

  it('names the tools as it is told to', () => {
    expect(systemPrompt((tool) => `torno.${tool}`)).toContain('torno.scene reports the build status')
    expect(systemPrompt((tool) => `torno.${tool}`)).not.toContain('mcp__torno__')
  })

  it('says of a mark told as changed that it may have been moved: one put somewhere else is told so too', () => {
    expect(FULL_PROMPT).toContain('(changed) is of a mark you were given before that the user has since changed or moved')
  })

  it('tells it to resolve the marks it acted on, but never a dimension of the user’s with an expected value', () => {
    expect(FULL_PROMPT).toContain('When you have acted on a mark and checked the result, call mcp__torno__resolve_mark with a line on what you did, except for a dimension of the user’s with an expected value: that is their check, it passes by itself and keeps being measured, and only they resolve it (a resolved one is no longer measured).')
  })

  it('names dimensions among the marks, and gives one example call each of the tools that read the part, as JSON that parses', () => {
    expect(FULL_PROMPT).toContain('placed shapes and dimensions, numbered')
    const calls = [...FULL_PROMPT.matchAll(/mcp__torno__(measure|check|section|add_mark) (\{.*?\})(?= is | returns | leaves | the wall|,? and )/g)].map((m) => [m[1], JSON.parse(m[2])])
    expect(calls).toEqual([
      ['measure', { kind: 'distance', a: 'plate/F2', b: 'plate/F4' }],
      ['check', { kind: 'clearance', a: 'lid', b: 'tub' }],
      ['section', { plane: { axis: 'x', at: 12 } }],
      ['add_mark', { kind: 'dimension', note: 'wall', measure: 'distance', a: 'plate/F2', b: 'plate/F4', expected: 8, tolerance: 0.1 }]
    ])
    expect(JSON.parse(FULL_PROMPT.match(/and (\{"kind": "thickness".*?\}\}) the wall/)![1])).toEqual({ kind: 'thickness', a: { ref: 'plate/F2', point: [10, 5, 6] } })
  })

  it('says what approximate looks like, what is refused between parts torno spread and what to do, which build the dimensions listed are of, and how to read them again', () => {
    for (const said of ['≈, "approximate" or "exact": false marks one that is not', 'are refused: ask in a layout that places them as assembled, and if the model has none, add one (def assembly(p))', '"Dimensions (measured on rN):"', 'once scene says the build is ok, read them again with mcp__torno__marks']) expect(FULL_PROMPT).toContain(said)
  })

  it('says what a scan is and that only the user aligns one, gives one example call each of the tools that ask about one, as JSON that parses, and when they are refused', () => {
    for (const named of ['mcp__torno__scans', 'mcp__torno__scan_clash', 'mcp__torno__scan_deviation']) expect(FULL_PROMPT).toContain(named)
    for (const said of [
      'a mesh of the real thing',
      'nothing taken from it is exact',
      // Who aligns, and that a layout added to the model has no alignment until they do.
      'that the user imported and aligns to one layout at a time with the Align tool (you cannot)',
      'refused where the scan is not aligned in the layout asked (the user aligns it there: an alignment is of one layout) and for a part torno moved for display',
      'a reading says first what puts the alignment in doubt',
      'no script that loads the scan',
      'pass its number in ignore to scan_clash, or in region to scan_deviation'
    ]) expect(FULL_PROMPT).toContain(said)
    const calls = [...FULL_PROMPT.matchAll(/mcp__torno__(scan_clash|scan_deviation) (\{[^}]*\})(?= says | how far )/g)].map((m) => [m[1], JSON.parse(m[2])])
    expect(calls).toEqual([
      ['scan_clash', { part: 'tub' }],
      ['scan_deviation', { part: 'plate', faces: ['plate/F5'] }]
    ])
    // What the schemas say is not said twice.
    expect(FULL_PROMPT).not.toContain('measure takes')
  })

  // #3: the convention the kernel loads a model by (loader.py `choose_model`, `_collect_scene`).
  it('states the model file contract: one file, Params with assembly and printables, else make_<part>, else top-level shapes', () => {
    for (const said of [
      'one model file (of several .py files, the one named after the folder, - and _ alike)',
      'a class Params (made with no arguments) with assembly(p) and/or printables(p) (or printable(p)), each returning a dict of part name to build123d shape, gives the layouts assembly (the parts as put together) and print (as printed, which torno may spread along X when parts overlap)',
      'Without those, Params with make_<part>(p) functions gives the layout main, a part per function, and failing that the solid shapes at the top level of the file are the parts of main.'
    ]) expect(FULL_PROMPT).toContain(said)
  })

  it('says what a named set is, how to write one in a ref, and that only the person accepts a proposal', () => {
    const sentence = "Named sets are the person's names for faces, edges, parts and strokes (scene lists them): write #deck, or block/#deck for one part's, in any ref; propose one with mcp__torno__add_set when a name would help, and only the person accepts it."
    expect(FULL_PROMPT).toContain(sentence)
    expect(SYSTEM_PROMPT).toContain(sentence)
    expect(systemPrompt((tool) => `torno.${tool}`)).toContain('propose one with torno.add_set when')
    expect(TOOLS.add_set.description).toContain('Only the person accepts a proposal')
  })

  it('says the working folder is the project, that common/ is the one place outside it to edit, and that a new project is made from the page', () => {
    const sentence = 'Edit only the folder you work in and common/ (shared by the workspace’s projects). Other projects are the person’s; a new project is made from torno’s page, not by creating a folder.'
    expect(FULL_PROMPT).toContain(sentence)
    expect(SYSTEM_PROMPT).toContain(sentence)
  })

  it('stays short', () => {
    // Raised from 6,250 in Milestone 5 (D12), for explode and the saved views; to 7,400 for the model file contract (#3); to 8,000 for the digest of a build (#108); to 8,300 for the board; to 8,400 for sketches; to 8,600 for reviews; to 8,900 for tracings; back to 8,800 once the board's sizes and rules came with the first prompt (#190, #249); to 9,100 for the project folder (#289).
    expect(FULL_PROMPT.length).toBeLessThan(9100)
  })

  it('says what a tracing is and how to trace a photo, and that a photo\'s numbers are never exact', () => {
    const sentence = "A tracing is the model laid flat in a plane at true scale over a photo: to trace the photo, look at it with mcp__torno__tracings and picture: true, then add layers in mm with mcp__torno__add_layer; a photo's numbers are never exact."
    expect(FULL_PROMPT).toContain(sentence)
    expect(SYSTEM_PROMPT).toContain(sentence)
    expect(systemPrompt((tool) => `torno.${tool}`)).toContain('look at it with torno.tracings and picture: true, then add layers in mm with torno.add_layer;')
    // After the named sets, before the marks of its own.
    expect(FULL_PROMPT.indexOf(sentence)).toBeGreaterThan(FULL_PROMPT.indexOf('Named sets are'))
    expect(FULL_PROMPT.indexOf(sentence)).toBeLessThan(FULL_PROMPT.indexOf('mcp__torno__add_mark leaves a mark of your own'))
    expect(TOOLS.tracings.description).toContain('picture')
  })

  it('says what a review is and to answer each of its items, and never to bring back what an earlier one removed', () => {
    const said = 'A review lists what the person doesn\'t want and wants on one build: answer each item by its id with mcp__torno__resolve_mark, and never bring back what an earlier review removed (mcp__torno__marks with review: "all").'
    expect(FULL_PROMPT).toContain(said)
    expect(SYSTEM_PROMPT).toContain(said)
    expect(systemPrompt((tool) => `torno_${tool}`, true)).toContain('with torno_resolve_mark, and never bring back what an earlier review removed (torno_marks with review: "all")')
  })

  it('says how literally to take a sketch, and that add_sketch shows a route or an outline', () => {
    expect(FULL_PROMPT).toContain('A sketch says how literally to take it (exact, rough or flow); follow it. Use mcp__torno__add_sketch to show the person a route or an outline.')
    expect(SYSTEM_PROMPT).toContain('A sketch says how literally to take it (exact, rough or flow); follow it.')
  })

  it('says how to read the digest that comes back with an edit: numbers of the B-rep, to be held to what was meant', () => {
    expect(FULL_PROMPT).toContain('("Changed since rN")')
    expect(FULL_PROMPT).toContain('("Check:"), from the B-rep, which a picture is not: adding material must raise a volume and a cut lower it; a part you did not mean to touch changing is a defect, and so is a part Check calls not valid, inside out, open or of more solids than meant: mend it or say why.')
    // What Check lists of an edit (faces renumbered, a part come or gone) is told, never called a defect.
    expect(FULL_PROMPT).not.toContain('anything under Check')
    expect(SYSTEM_PROMPT).toContain('Check:')
  })

  it('states the loop: numbers first with the tools that settle them, then one look with the marks, and the window and not a terminal', () => {
    for (const prompt of [SYSTEM_PROMPT, FULL_PROMPT]) {
      expect(prompt).toContain('After an edit, settle with numbers what they can settle (measure, check, section, diff): the size you changed, a wall, a clearance, a hole through. Then look once, at the view that shows the change, marks drawn; look again only for what it could not show.')
      expect(prompt).not.toContain('terminal')
      expect(prompt.indexOf('settle with numbers')).toBeLessThan(prompt.indexOf('Then look once'))
    }
    expect(SYSTEM_PROMPT).toContain('in torno’s window.')
    expect(SYSTEM_PROMPT).toContain('thin, overhang; bed is of the layout')
  })

  it('has /review look once or twice at all the open marks, not once at each', () => {
    const text = PROMPTS.review.text((tool) => `mcp__torno__${tool}`)
    expect(text).toContain('once or twice, at views that show all the open marks')
    expect(text).toContain('only where the numbers cannot settle it')
    expect(text).not.toContain('each mark points at')
  })

  it('says that explode is for display, right after what show is for', () => {
    expect(FULL_PROMPT).toContain('To see for yourself, use look. look and show take explode (0 to 1) to draw the parts apart; a picture says when it is exploded, and no position, ref or number is of an exploded part.')
  })

  it('says that scene lists the saved views, that look and show take one by its name, and how to propose one, as JSON that parses', () => {
    expect(FULL_PROMPT).toContain('of an exploded part. scene lists the views saved by name: look {"view": "Hinge side"} draws one and show {"view": "Hinge side"} puts it on the user\'s screen. They are the angles the user checks: for your look, take the one that shows the change. mcp__torno__save_view {"name": "Wall at the latch", "view": "front", "parts": ["tray"]} proposes a view of your own for them to keep. Measure before you state a size')
    const calls = [...FULL_PROMPT.matchAll(/(look|show|mcp__torno__save_view) (\{"(?:view|name)": [^}]*\})/g)].map((m) => [m[1], JSON.parse(m[2])])
    expect(calls).toEqual([
      ['look', { view: 'Hinge side' }],
      ['show', { view: 'Hinge side' }],
      ['mcp__torno__save_view', { name: 'Wall at the latch', view: 'front', parts: ['tray'] }]
    ])
  })

  // Final fix wave (I8, T9, C1).
  it('says the whole way for a part torno moved, and that a dimension never has an end on a scan', () => {
    for (const said of ['the user aligns it there: an alignment is of one layout', 'adding one if need be; the user then aligns the scan in it', 'A dimension is of the model: it never has an end on a scan.']) expect(FULL_PROMPT).toContain(said)
  })
})

// #4: Claude Code is given torno's skills (`resources/agent-plugin`), and its prompt leaves to them what they say.
describe("Claude Code's prompt, with the skills", () => {
  const skill = (name: string) => readFileSync(join(__dirname, '../../resources/agent-plugin/skills', name, 'SKILL.md'), 'utf8')

  it('is the whole text without the scans and the dimensions, noticeably shorter', () => {
    expect(systemPrompt((tool) => `mcp__torno__${tool}`, true)).toBe(SYSTEM_PROMPT)
    expect(SYSTEM_PROMPT.length).toBeLessThan(8100)
    expect(FULL_PROMPT.length - SYSTEM_PROMPT.length).toBeGreaterThan(1000)
    for (const sentence of [...SCANS_TEXT, ...DIMENSIONS_TEXT]) {
      expect(FULL_PROMPT).toContain(sentence)
      expect(SYSTEM_PROMPT).not.toContain(sentence)
    }
  })

  it('names each skill, and keeps what every prompt needs to be read: dimensions listed, scans, refs, the contract', () => {
    for (const named of ['torno:torno-model', 'torno:build123d', 'torno:scans', 'torno:dimensions', 'torno:printing']) expect(SYSTEM_PROMPT).toContain(named)
    // #6: when to ask the reviewer subagent Claude Code is given with --agents; the whole text, of a session without the skills, does not name it.
    expect(SYSTEM_PROMPT).toContain('After a change of several steps, before saying it is done, have the torno-reviewer subagent check it')
    expect(FULL_PROMPT).not.toContain('torno-reviewer')
    for (const said of ['"Dimensions (measured on rN):" with every prompt until they pass', 'A scan (S1, S2)', 'nothing taken from it is exact', 'New marks arrive with the prompt', 'a class Params (made with no arguments)', 'mcp__torno__measure {"kind": "distance"']) expect(SYSTEM_PROMPT).toContain(said)
  })

  // #333: the window shows each value of Params with a unit, so a new model says which are angles.
  it('says, in the prompt and the model skill, which unit a field of Params is shown in and how a model declares another', () => {
    for (const prompt of [SYSTEM_PROMPT, FULL_PROMPT]) expect(prompt).toContain('A float of Params is shown in mm, an int bare: else say so in its field metadata, {"unit": "deg"}.')
    const model = skill('torno-model').replace(/\s+/g, ' ')
    for (const said of ['**Units.**', 'metadata={"unit": "deg"}', '`"count"`', 'a `float` is shown in mm and an `int` with no unit', 'A float that is an angle, a count, a ratio or a per cent must say so']) expect(model).toContain(said)
  })

  it('whose skills say, to the letter, what the prompt no longer does', () => {
    for (const sentence of SCANS_TEXT) expect(skill('scans')).toContain(sentence)
    for (const sentence of DIMENSIONS_TEXT) expect(skill('dimensions')).toContain(sentence)
  })

  // #111, #324: the rule is in the skill, and the first prompt of a new project (`onboard.ts`) names it there; the system prompt has no room for it.
  it('whose model skill settles what would make the first build wrong, not only sizes, before the first model and for a later feature', () => {
    const model = skill('torno-model').replace(/\s+/g, ' ')
    expect(model).toContain('## Before the first model')
    for (const said of SETTLE) expect(model).toContain(said)
    for (const said of ['A size has a source when the person gave it', 'or another project says it', 'Ask the person in one round, before you build, with `AskUserQuestion`, only what would change the build', 'put a sketch of each choice in its option (`preview`)', 'labelled as typical', '"build with assumptions"', 'What does not decide fit (a fillet, a chamfer, a wall) is an assumption they can change afterwards in `Params`, not a question', 'If nothing would change the build, ask nothing', 'built as assumed', 'a new feature that depends on something not given']) expect(model).toContain(said)
    // How many questions and options is the schema of AskUserQuestion, not the skill's to say.
    expect(model).not.toMatch(/at most 4 questions|2 to 4 options/)
  })

  it('whose model skill does not ask again for a size the person gave, in the first prompt or as a size card of the board', () => {
    const model = skill('torno-model').replace(/\s+/g, ' ')
    for (const said of ['the person gave it, in the first prompt or as a size card on the board (read them with `mcp__torno__board` when the prompt does not say them)', 'A size the person gave is not asked again']) expect(model).toContain(said)
  })

  it('whose section the first prompt of a new project names, with the same things to settle', () => {
    const { text } = onboardPrompt({ name: 'x', description: 'A thing.', items: [], scans: [], objects: [] }, undefined, true)
    const named = text.match(/the (torno-model) skill says under "([^"]+)"/)
    expect(named).not.toBeNull()
    expect(skill(named![1])).toContain(`## ${named![2]}`)
    for (const said of SETTLE) expect(text).toContain(said)
  })
})

// #50: which wins for seeing the build is one line of the skill and one of the first prompt of a session (`instructionsLine`); the system prompt has no room for it.
describe('the model skill and a CLAUDE.md that names another way to see the build', () => {
  const model = readFileSync(join(__dirname, '../../resources/agent-plugin/skills/torno-model/SKILL.md'), 'utf8').replace(/\s+/g, ' ')

  it('says torno\'s tools are current for the build, and a CLAUDE.md is followed on how to model', () => {
    for (const said of ['## A CLAUDE.md that names another way to see the build', 'What torno\'s tools say of the build is current', 'names another viewer, report or export step', 'Follow its advice on how to model, not on how to see the build']) expect(model).toContain(said)
  })

  it('has it in the first prompt of a session, not in the system prompt', () => {
    expect(SYSTEM_PROMPT).not.toContain('CLAUDE.md')
    expect(FULL_PROMPT).not.toContain('CLAUDE.md')
  })
})

// #119: every tool a prompt or a skill names is a tool torno has, so that a name that is not one (`scan_section` was) is caught here.
describe('the tools the prompts and the skills name', () => {
  const named = (text: string): string[] => [...text.matchAll(/mcp__torno__([A-Za-z_]+)/g)].map((m) => m[1])
  const skillsDir = join(__dirname, '../../resources/agent-plugin/skills')
  const skills = ['torno-model', 'scans', 'dimensions', 'build123d'].map((name) => readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8'))
  const asClaude = (tool: string) => `mcp__torno__${tool}`

  it('names only tools of TOOLS, in the system prompt, the prompts of MCP and the skills', () => {
    const texts = [SYSTEM_PROMPT, FULL_PROMPT, systemPrompt((tool) => `torno.${tool}`), ...skills, ...Object.values(PROMPTS).map((p) => p.text(asClaude, '256x256x256'))]
    const names = texts.flatMap(named)
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => !(name in TOOLS))).toEqual([])
  })
})
