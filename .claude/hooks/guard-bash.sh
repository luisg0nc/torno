#!/usr/bin/env bash
# PreToolUse guard for Bash: refuses the commands the CLAUDE.md files forbid in prose.
# Reads the tool call as JSON on stdin; prints a deny decision and exits 2 to block, exits 0 to allow.
# Every rule matches a command in COMMAND POSITION (start of line, or after ; & | ( $( ), so a heredoc,
# an echo or a commit message that merely mentions `uv sync` passes. `guard-bash.test.sh` holds the cases.
set -u
cmd=$(jq -r '.tool_input.command // empty' 2>/dev/null) || exit 0
[ -z "$cmd" ] && exit 0

# Drop heredoc bodies (`<<EOF` ... `EOF`): they are data, not commands.
cmd=$(printf '%s\n' "$cmd" | awk '
  t != "" { if ($0 == t || $0 ~ ("^[ \t]*" t "$")) t = ""; next }
  {
    if (match($0, /<<-?[ \t]*["'"'"']?[A-Za-z_][A-Za-z0-9_]*["'"'"']?/)) {
      s = substr($0, RSTART, RLENGTH); sub(/<<-?[ \t]*["'"'"']?/, "", s); sub(/["'"'"']$/, "", s); t = s
    }
    print
  }')

# The decision goes to stdout as JSON and the reason to stderr too, which is what Claude Code reads on exit 2.
deny() {
  printf '%s\n' "$1" >&2
  jq -n --arg r "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
  exit 2
}
# Command position, then what may stand before the command itself: keywords, sudo, env and assignments,
# and the runners that run another command (npx, npm exec, pnpm dlx/exec, exec, command, nohup, time, timeout).
P='(^|[;&|(]|\$\()\s*((then|do|else|!)\s+)*(sudo\s+)?(env\s+)?(\w+=("[^"]*"|'"'"'[^'"'"']*'"'"'|\S*)\s+)*(sudo\s+)?((npx|bunx)\s+(-y\s+)?|npm\s+exec\s+|pnpm\s+(dlx|exec)\s+|exec\s+|command\s+|nohup\s+|time\s+|timeout\s+\S+\s+)*'
E='(?=[\s;&|)]|$)'
has() { printf '%s\n' "$cmd" | grep -Pq "$1"; }
line() { printf '%s\n' "$cmd" | grep -P "$1"; }

# 1. uv sync. The rule (root CLAUDE.md, rule workspace-writes) is `uv run --no-sync`: in a workspace uv would make
#    a .venv of its own, and torno's own kernel environment is made by the app ("Make it now"), not by hand.
if has "${P}uv(\s+(-{1,2}[\w-]+(=\S+)?(\s+[^-\s;&|]\S*)?|pip))*\s+sync${E}"; then
  deny "Never run uv sync here: use uv run --no-sync (root CLAUDE.md, Global invariants; .claude/rules/workspace-writes.md). torno's own kernel environment is made by the app's \"Make it now\", not by hand."
fi

# 2. The real claude CLI. No test runs it, and no agent runs it for a test or a check: it spends the person's
#    subscription and depends on their login and settings. `claude --version` alone is harmless.
if line "${P}(\S*/)?claude(-code)?${E}" | grep -Pvq "claude\s+(--version|-v)\s*($|[;&|)])"; then
  deny "Never run the real claude CLI from here: tests and checks use the stand-in, TORNO_AGENT_CMD=\"node app/test/fake-agent.mjs\" (root CLAUDE.md, Never run a real agent CLI from tests). A check against the real CLI is done by hand by the person."
fi
if has "\bTORNO_(AGENT_CMD|EVAL_AGENT)=[\"']?(\S*/)?claude\b"; then
  deny "TORNO_AGENT_CMD and TORNO_EVAL_AGENT never name the real claude: use the stand-in, \"node app/test/fake-agent.mjs\"."
fi

# 3. The evals drive the real claude unless TORNO_EVAL_AGENT names the stand-in.
if line "${P}(pnpm\s+(-C\s+\S+\s+)?(run\s+)?eval${E}|node\s+(\S*/)?evals/run\.mjs)" | grep -Fvq 'fake-agent.mjs'; then
  deny "The evals spend the person's subscription. An agent runs them only with the stand-in: TORNO_EVAL_AGENT=\"node app/test/fake-agent.mjs\" TORNO_EVAL=1 pnpm -C app eval (rule e2e-stand-in-agent)."
fi

# 4. Broad kills. The person's own torno, Electron, node, python and Claude Code run on this desktop.
KILL="Never kill by a broad name or for a whole user: the person's torno, Electron, node, python and Claude Code run on this desktop. Kill the process you started, by its pid (kill <pid>, pkill -P <pid>) or by its full command line."
if has "${P}killall${E}"; then deny "$KILL"; fi
if has "${P}kill\s+(-\S+\s+)*-1\s*($|[;&|)])"; then deny "$KILL"; fi
while IFS= read -r seg; do
  [ -z "$seg" ] && continue
  if printf '%s\n' "$seg" | grep -Pq '\s-[uUG]\b|--(e?uid|group)\b'; then deny "$KILL"; fi
  pat=$(printf '%s\n' "$seg" | sed -E 's/^pkill//; s/[[:space:]]+-[A-Za-z0-9-]+//g; s/["'"'"']//g; s/^[[:space:]]+//; s/[[:space:]]+$//')
  if [ -z "$pat" ] || printf '%s\n' "$pat" | grep -Piq '^(electron|node|python3?|uv|claude|torno(-app)?|vitest|playwright|chrome|chromium|xvfb-run|xvfb|pnpm|npm|bash|sh|zsh|code)$'; then
    deny "$KILL"
  fi
done < <(printf '%s\n' "$cmd" | grep -oP "${P}\Kpkill\b[^;&|\n)]*")

exit 0
