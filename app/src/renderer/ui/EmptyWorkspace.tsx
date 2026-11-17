import { Logo } from './Logo'
import { Readiness } from './Readiness'

/**
 * A folder with no object in it: it leads with making one (and the example, to look around), says what torno is
 * good for, and keeps the way for a person who already has models, and the note on `pyproject.toml`, in a fold.
 * torno runs no `uv` command here: the note names them for the person to run.
 */
export function EmptyWorkspace({ name, hasProject, hasExample, onNew, onExample }: { name: string; hasProject: boolean; hasExample: boolean; onNew: () => void; onExample: () => void }) {
  return (
    <div className="show-empty">
      <Logo />
      <h3>Make your first project</h3>
      <p>Say what it is, add photos or a doodle, and Claude Code writes the model.</p>
      <p className="show-empty-where">No projects in {name} yet.</p>
      <button type="button" className="button button-primary show-empty-new" onClick={onNew}>
        New project
      </button>
      {hasExample && (
        <p className="show-empty-example">
          or{' '}
          <button type="button" className="show-empty-link" title="A small project of torno's own, copied to a temporary folder: nothing of the repository is opened or written" onClick={onExample}>
            open the example to look around
          </button>
        </p>
      )}
      <Readiness variant="block" />
      <p className="show-empty-scope">Works best for printed parts and small assemblies. Organic shapes are hard.</p>
      <details className="show-empty-fold">
        <summary>Already have build123d models?</summary>
        <p>
          Make a folder with a Python model in it, for example <span className="num">part/part.py</span>, and it appears here.
        </p>
        {!hasProject && (
          <p>
            This folder has no <span className="num">pyproject.toml</span>: models are built with torno's own build123d. For your own packages, make it a uv project (<span className="num">uv init</span>, <span className="num">uv add build123d</span>, <span className="num">uv sync</span>) and open it again.
          </p>
        )}
      </details>
    </div>
  )
}
