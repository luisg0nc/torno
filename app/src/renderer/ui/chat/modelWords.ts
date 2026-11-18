/** The model as the header's button says it: the id without the `claude-` every Claude model's has, `opus-5-5`. The whole id is the button's name. */
export function modelShown(id: string): string {
  return id.replace(/^claude-/, '')
}
