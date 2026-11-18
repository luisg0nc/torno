import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { EDGES, drawAskedBox } from './askedBox'

/** A 2D context that keeps the lines and the text drawn on it. */
function canvas() {
  const lines: Array<{ from: [number, number]; to: [number, number]; dash: number[]; stroke: string }> = []
  const texts: string[] = []
  let from: [number, number] = [0, 0]
  let to: [number, number] = [0, 0]
  let dash: number[] = []
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    save() {},
    restore() {},
    beginPath() {},
    setLineDash(d: number[]) {
      dash = d
    },
    moveTo(x: number, y: number) {
      from = [x, y]
    },
    lineTo(x: number, y: number) {
      to = [x, y]
    },
    stroke() {
      lines.push({ from, to, dash, stroke: this.strokeStyle })
    },
    measureText: (t: string) => ({ width: t.length * 6 }),
    roundRect() {},
    fill() {},
    fillText(t: string) {
      texts.push(t)
    }
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, lines, texts }
}

const camera = new THREE.PerspectiveCamera(40, 1, 1, 1000)
camera.position.set(0, -300, 100)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()
const size = { width: 400, height: 400 }
const colours = { accent: '#2255cc', paper: '#ffffff' }

describe('drawAskedBox', () => {
  it('draws the twelve edges of the box, dashed, in the accent, and says its size', () => {
    const { ctx, lines, texts } = canvas()
    drawAskedBox(ctx, { min: [-50, -50, 0], max: [50, 50, 20], label: '100 × 100 × 20 mm' }, camera, size, colours)
    expect(EDGES).toHaveLength(12)
    // The twelve edges are dashed; the plate of its size is outlined whole.
    const dashed = lines.filter((l) => l.dash.length > 0)
    expect(dashed).toHaveLength(12)
    expect(dashed.every((l) => l.stroke === '#2255cc')).toBe(true)
    expect(texts).toEqual(['100 × 100 × 20 mm'])
  })

  it('draws nothing for none', () => {
    const { ctx, lines, texts } = canvas()
    drawAskedBox(ctx, null, camera, size, colours)
    expect(lines).toHaveLength(0)
    expect(texts).toHaveLength(0)
  })

  it('leaves out the edges that are behind the camera', () => {
    const { ctx, lines } = canvas()
    drawAskedBox(ctx, { min: [-50, -900, 0], max: [50, -800, 20], label: 'x' }, camera, size, colours)
    expect(lines).toHaveLength(0)
  })
})
