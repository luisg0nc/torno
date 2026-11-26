---
paths:
  - "app/src/main/rename.ts"
  - "app/src/main/rename.test.ts"
  - "app/src/main/notices.ts"
  - "app/src/shared/rename.ts"
  - "app/src/shared/rename.test.ts"
  - "app/src/renderer/state/rename.ts"
  - "app/src/renderer/ui/Layers.tsx"
  - "kernel/src/torno_kernel/names.py"
  - "kernel/tests/test_names.py"
  - "app/e2e/rename.spec.ts"
---

# Renaming a part by hand (#359)

The person renames a part in the Parts tab (the pencil on its row, or `F2` on its name: `part.rename`) and torno writes the new
name into the model. With Go back (`goback`) it is the one place torno writes the model; `workspace-writes` says what it may
write (the fifth exception).

## The kernel (`kernel/src/torno_kernel/names.py`)

- `part_sites` is a query of the live worker (`queries.run`, `names.query`): the worker keeps which files its build was made from
  (`kept["source",]`: `dir`, `model`, `uses`) and the loaded module (`torno_model_<stem>` in `sys.modules`) says the convention.
  It reads the project's own `.py` files (recursively, none hidden, of an environment or `__pycache__`; 200 files and 1 MB a file
  at most) and the files the build imported from elsewhere (`uses`) by the AST. **It never writes**: it answers `sites` (`file`
  from the workspace with `/`, `line`, `start` and `end` in bytes of the file, `old` and `new` text) and `files` (the SHA-256 of
  each file named), or `refused` with a sentence.
- Under `assembly(p)` / `printables(p)` / `references(p)`, a site is a string literal equal to the name inside one of the
  contract's functions of the model file (`assembly`, `printables`, `printable`, `references`, `groups`, `tags`, `checks`) where a
  part's name stands: a key or value of a dict or a dict comprehension, an index, an item of a list, tuple or set, a side of a
  comparison, a keyword's value. At least one must be in `assembly`, `printables` or `references`. Refused: the name equal to a
  literal anywhere else (another function, the module's top, another own file, a file of `uses`), a literal that starts with
  `name/` or names `layout:name` (a ref), a literal inside an f-string, an f-string where a part's name stands whose plain pieces
  could make the name (`f"sh{x}"`), a name built from a variable (no site in the defining functions), and a span that does not
  read back as the literal (`ast.literal_eval`).
- Under `make_<part>(p)`, the sites are the `def` of `make_<name>` at the top of the model file (its name's bytes, found by the
  tokens), every `Name` `make_<name>` in own files and the literals as above. The new name must be a Python name and
  `make_<new>` must not be a name the model has; `x.make_<name>`, an import of it or a literal `"make_<name>"` is refused.
- A model of top-level shapes is refused (the part is a variable). The new literal keeps the old one's quotes when the name fits
  in them, else is `repr`.

## Main (`app/src/main/rename.ts`, `object:renamePart`)

- `renamePart(obj, { from, to }, deps)`: refused while the session is `working`, `needs_input` or has prompts untaken
  (`Sessions.busyWith(id, 'rename')`), while a build runs, before a build worked, for a part the last build lacks, and for a name
  `partNameRefusal` refuses (`shared/rename.ts`, the window's rule too: trimmed, not empty, not the same, 60 characters, one line,
  no `/` or `:`, not starting with `#` or `@`, not `M<n>`, not a part's, reference's or group's name of the build, `namesTaken`).
  Then the kernel is asked (`Builds.query(id, 'part_sites')`) and every site checked before the first write: an own `.py`
  (`ownFile` of `goback.ts`), a plain file inside the project by real path (`unfit`), the file's SHA-256 the kernel's, the old text
  at every span, spans that do not overlap. Each file is written whole (`writeFileAtomic`); a failure stops there and says which
  were written. The build is the watcher's, as of any save (the project is the one on screen; a `rebuild` asked as well was started over by the watcher's burst 300 ms later, two builds for one rename), so it is kept with the cause `person`. Then `follow` and the notice.
- **What follows the part** (`follow` in `ipc.ts`): each store renames in one change of its own, by `renamedIn` of
  `shared/rename.ts` (strings under `part`, `parts`, `cuts`; refs under `ref`, `refs`, `edge`, `between`, `face`, `vertex`,
  `centre`, `touches`, renamed by `renamedRef`; the keys of `frame`): `MarkStore.renamePart`, `SetStore.renamePart`,
  `TracingStore.renamePart`, `ScanStore.renamePart`. Never a comment, a name or a label. The window moves what it keeps by the
  part's name (`actions.partRenamed`: layers, saved views' `hidden`, the selection, the agent's show, `marksOnPart`), saved with the
  scene file. The history's kept builds keep the old name: they were made with it.
- **The notice** (`.torno/renamed.json`, ignored by git: `{ renames: [{ from, to, files, at }] }`, six at most): kept until a
  prompt carries it, as Go back's. A rename of a name renamed since the agent was told is folded into it, and one that puts a name
  back removes it. `takeRenameNotice` gives `{ text, done }` ("The person renamed the part shell to front case in model.py; keep
  the new name.", at most `RENAME_LIMIT`, 600 characters); `notices.ts` `takeNotices` joins it to Go back's for `index.ts`'s
  `contextFor` (first in the context, besides `CONTEXT_LIMIT`), and `done` runs once the answer has left. The chat also gets a
  quiet note at once.

## The window (`ui/Layers.tsx`, `state/rename.ts`)

- `renameActions.start(part)` makes the row's name a field (`RenameField`, `.layer-rename-field`): Enter asks main, Esc or leaving it
  puts it away; what main refused is said under it (`.layer-rename-why`, `role="alert"`) until the text changes. The window never
  writes the model: it sends the two names.
