import { Children, type ReactElement, type ReactNode, isValidElement } from 'react'

/** Every element of a tree as a component returned it (its children are not rendered: a component in it is one element), the first is the root. */
export function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  const found: ReactElement<Record<string, unknown>>[] = []
  const walk = (one: ReactNode): void => {
    for (const child of Children.toArray(one)) {
      if (!isValidElement<Record<string, unknown>>(child)) continue
      found.push(child)
      walk(child.props.children as ReactNode)
    }
  }
  walk(node)
  return found
}

/** The text a tree says: what is in its elements, with their text joined as it would be read. */
export function textOf(node: ReactNode): string {
  const out: string[] = []
  const walk = (one: ReactNode): void => {
    for (const child of Children.toArray(one)) {
      if (typeof child === 'string' || typeof child === 'number') out.push(String(child))
      else if (isValidElement<{ children?: ReactNode }>(child)) walk(child.props.children)
    }
  }
  walk(node)
  return out.join('')
}

/** The buttons of a tree whose text is exactly `label` (spaces trimmed), each as the element it is. */
export function buttonsLabelled(node: ReactNode, label: string): ReactElement<Record<string, unknown>>[] {
  return elementsOf(node).filter((el) => el.type === 'button' && textOf(el.props.children as ReactNode).trim() === label)
}
