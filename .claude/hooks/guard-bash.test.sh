#!/usr/bin/env bash
# Cases for guard-bash.sh: `bash .claude/hooks/guard-bash.test.sh` prints FAIL lines and exits 1 on any.
cd "$(dirname "$0")" || exit 2
fails=0
check() {
  local want=$1 c=$2 rc
  printf '%s' "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":$(jq -Rn --arg c "$c" '$c')}}" | ./guard-bash.sh >/dev/null 2>&1
  rc=$?
  if [ "$rc" != "$want" ]; then fails=$((fails+1)); echo "FAIL want $want got $rc :: $(printf '%s' "$c" | tr '\n' ' ' | head -c 90)"; fi
}

# blocked: uv sync (the rule is `uv run --no-sync`)
check 2 'uv sync'
check 2 'uv sync --frozen'
check 2 'cd kernel && uv sync'
check 2 '(cd kernel; uv sync)'
check 2 'uv --project kernel sync'
check 2 'uv pip sync requirements.txt'
check 2 'sudo uv sync'
check 2 'env UV_PROJECT_ENVIRONMENT=/tmp/x uv sync'
check 2 'out=$(uv sync 2>&1)'
check 2 'git status; uv sync'

# blocked: the real claude CLI, run by hand, by a test or by the evals
check 2 'claude'
check 2 'claude -p "hello"'
check 2 'cd app && claude --print hi'
check 2 'echo hi | claude -p'
check 2 'npx claude -p hi'
check 2 'npx @anthropic-ai/claude-code -p hi'
check 2 'claude auth status'
check 2 'TORNO_AGENT_CMD=claude pnpm test:e2e'
check 2 'export TORNO_AGENT_CMD=/usr/local/bin/claude'
check 2 'TORNO_EVAL_AGENT="claude --model sonnet" TORNO_EVAL=1 pnpm -C app eval'
check 2 'pnpm -C app eval'
check 2 'TORNO_EVAL=1 pnpm -C app run eval'
check 2 'cd app && pnpm eval'
check 2 'node app/evals/run.mjs'
check 2 'cd app && node evals/run.mjs --case lid'

# blocked: broad kills (the person's torno, Electron, node and python run on this desktop)
check 2 'killall electron'
check 2 'killall -9 node'
check 2 'pkill electron'
check 2 'pkill -f electron'
check 2 'pkill -9 -f "python"'
check 2 "pkill -f 'torno'"
check 2 'git status && pkill node'
check 2 'pkill -u "$USER"'
check 2 'kill -9 -1'
check 2 'sudo pkill claude'

# allowed
check 0 'uv run --no-sync pytest -q'
check 0 'cd kernel && uv run --no-sync python scripts/build123d_api.py --check'
check 0 '(cd kernel && uv run pytest -q)'
check 0 'echo "never run uv sync here"'
check 0 'git commit -m "Say why uv sync and claude -p are refused" -- CLAUDE.md'
check 0 $'cat > notes.md <<EOF\nuv sync\nclaude -p hi\npkill electron\nkillall node\nEOF'
check 0 $'cat > a.md <<\'X\'\n- `pnpm -C app eval` spends the subscription\nX\ngit status'
check 0 'grep -rn "claude" app/src'
check 0 'git log --oneline | grep claude'
check 0 'claude --version'
check 0 'ls ~/.claude && cat CLAUDE.md'
check 0 'gh pr create --title "Rules" --body "no claude -p, no uv sync"'
check 0 'TORNO_AGENT_CMD="node app/test/fake-agent.mjs" pnpm test:e2e'
check 0 'TORNO_EVAL_AGENT="node app/test/fake-agent.mjs" TORNO_EVAL=1 pnpm -C app eval'
check 0 'pnpm -C app exec vitest run src/evals.test.ts'
check 0 'pnpm test && pnpm test:kernel'
check 0 'pkill -f "node app/test/fake-agent.mjs"'
check 0 'pkill -P 12345'
check 0 'kill 12345'
check 0 'pgrep -af electron'
check 0 'bash .claude/hooks/guard-bash.test.sh'

if [ "$fails" = 0 ]; then echo "guard-bash: all cases pass"; exit 0; fi
exit 1
