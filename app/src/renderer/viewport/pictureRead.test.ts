import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Encoder, pixelsOfAsync } from './picture'

/** A renderer that only says what was asked of it: the encoder draws, and the pixels come back one way or the other. */
function fake() {
  const calls: string[] = []
  const renderer = {
    setRenderTarget: () => void calls.push('target'),
    render: () => void calls.push('render'),
    readRenderTargetPixels: () => void calls.push('read sync'),
    readRenderTargetPixelsAsync: async (_t: unknown, _x: number, _y: number, _w: number, _h: number, buffer: Uint8Array) => {
      calls.push('read async')
      buffer[0] = 7
      return buffer
    }
  }
  return { calls, renderer: renderer as unknown as THREE.WebGLRenderer }
}

describe('pixelsOfAsync', () => {
  it('reads the encoded target back without a synchronous readPixels, so the window is never made to wait for the GPU', async () => {
    const { calls, renderer } = fake()
    const encoder = new Encoder()
    const drawn = new THREE.WebGLRenderTarget(4, 3)
    const encoded = new THREE.WebGLRenderTarget(4, 3, { depthBuffer: false })
    const pixels = await pixelsOfAsync(renderer, encoder, drawn, encoded, { alpha: true })
    expect(calls).toEqual(['target', 'render', 'read async'])
    expect(pixels).toHaveLength(4 * 3 * 4)
    expect(pixels[0]).toBe(7)
  })
})
