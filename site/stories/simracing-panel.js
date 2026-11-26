// A button box for a sim racing rig, made in seven turns. The prompts are short versions of the ones the project was
// made with; the sizes are the model's (96 mm wide at the end, the face leaning back 35° and turned 25° to the seat).
;(function () {
  'use strict'
  var POS = { x: 95, y: 0, z: 150 }

  // The box's frame: origin at the middle of its face, x across, z up the face, y into it (the face looks down -y).
  function panel(s, F) {
    var b = s.box
    return F.world().move(POS.x, POS.y, POS.z).turn('z', -b.yaw).turn('x', -b.lean)
  }
  function rect(u, v, w, h, y) { return [[u - w / 2, y, v - h / 2], [u + w / 2, y, v - h / 2], [u + w / 2, y, v + h / 2], [u - w / 2, y, v + h / 2]] }
  function rounded(w, h, r, y) {
    var pts = [], cs = [[w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, 90], [-w / 2 + r, -h / 2 + r, 180], [w / 2 - r, -h / 2 + r, 270]]
    cs.forEach(function (c) {
      for (var i = 0; i <= 4; i++) {
        var a = (c[2] + i * 22.5) * Math.PI / 180
        pts.push([c[0] + r * Math.cos(a), y, c[1] + r * Math.sin(a)])
      }
    })
    return pts
  }
  // The pictograms on the label plates, in a 10 × 5 box round (0, 0).
  var GLYPHS = [
    [[-3, -1.5], [-3, 1.5], [3, 1.5], [3, -1.5], [-3, -1.5]],
    [[-1, 2], [-2, 0], [2, 0], [1, -2]],
    [[0, 2], [-2.5, -2], [2.5, -2], [0, 2]],
    [[-3, 0], [-1, 0], [0, 2], [1, -2], [2, 0], [3, 0]],
    [[-2.5, -2], [-2.5, 2], [2.5, -2], [2.5, 2]]
  ]

  function scene(s, k) {
    var prims = [], F = k.Frame, b = s.box, P = panel(s, F)
    var w = b.w, h = b.h, d = b.d

    // The rig: the right arm of the cockpit, an 80 × 40 profile, and the upright at its front.
    if (s.rig) {
      var op = s.rig.g == null ? 1 : s.rig.g, W = F.world(), ro = { mat: 'rig', layer: 0, focus: false, op: op }
      prims.push(k.box(W, -20, 20, -320, 320, -80, 0, ro))
      prims.push(k.box(W, -20, 20, 150, 190, 0, 330, ro))
      ;[-24, -56].forEach(function (z) {
        prims.push(k.poly(W, [[20.2, -320, z], [20.2, 320, z]], { mat: 'rig', layer: 0, focus: false, op: op, normal: [1, 0, 0] }))
      })
      ;[-10, 10].forEach(function (x) {
        prims.push(k.poly(W, [[x, -320, 0.2], [x, 320, 0.2]], { mat: 'rig', layer: 0, focus: false, op: op, normal: [0, 0, 1] }))
      })
    }

    // The mount: first a flat blade, then an arm of three that locks.
    var back = P.at([0, d, -h * 0.18]), tight = !!(s.cam && s.cam.tight)
    if (s.blade) {
      var g = s.blade.g == null ? 1 : s.blade.g, Wb = F.world()
      prims.push(k.box(Wb, 20, 30, -38, 38, -70, -8, { mat: 'arm', layer: 1, op: Math.min(1, g * 2) }))
      var a = [25, 0, -8], fr = F.along(a, back, [0, 1, 0]), L = Math.hypot(back[0] - a[0], back[1] - a[1], back[2] - a[2])
      prims.push(k.box(fr, -4, 4, -26, 26, 0, L * g, { mat: 'arm', layer: 1 }))
    }
    if (s.joint) {
      var gj = s.joint.g == null ? 1 : s.joint.g, Wj = F.world(), jo = { mat: 'arm', layer: 1, op: Math.min(1, gj * 2), focus: !tight }
      // The base slides on the arm's slots; the link turns on a knuckle at each end; the head holds the box's side.
      prims.push(k.box(Wj, 20, 36, -45, 45, -76, -4, jo))
      var A = [44, 0, -26], Bk = P.at([-w / 2 - 13, d * 0.55, -h * 0.2])
      var fr2 = F.along(A, Bk, [0, 1, 0]), L2 = Math.hypot(Bk[0] - A[0], Bk[1] - A[1], Bk[2] - A[2])
      prims.push(k.box(Wj, 34, 44, -12, 12, -40, -14, jo))
      prims.push(k.box(fr2, -7, 7, -11, 11, 0, L2 * gj, { mat: 'arm', layer: 1, focus: !tight }))
      prims.push(k.cyl(Wj, [A[0], A[1] - 15, A[2]], [0, 1, 0], 15 * gj, 30, { mat: 'arm', layer: 1, n: 24, focus: !tight }))
      prims.push(k.cyl(Wj, [A[0], A[1] - 17, A[2]], [0, 1, 0], 5 * gj, 2, { mat: 'metal', layer: 1, n: 6, focus: !tight }))
      prims.push(k.cyl(Wj, [Bk[0], Bk[1] - 15, Bk[2]], [0, 1, 0], 15 * gj, 30, { mat: 'arm', layer: 1, n: 24 }))
      prims.push(k.cyl(Wj, [Bk[0], Bk[1] - 17, Bk[2]], [0, 1, 0], 5 * gj, 2, { mat: 'metal', layer: 1, n: 6 }))
      prims.push(k.box(P, -w / 2 - 7 * gj, -w / 2, 4, d - 4, -h * 0.38, h * 0.02, { mat: 'arm', layer: 1, op: Math.min(1, gj * 2) }))
    }

    // The box, its back lid a line round its sides.
    prims.push(k.box(P, -w / 2, w / 2, 0, d, -h / 2, h / 2, { mat: 'shell', layer: 2 }))
    if (d > 25) {
      var yl = d - 5
      prims.push(k.poly(P, [[w / 2 + 0.2, yl, -h / 2], [w / 2 + 0.2, yl, h / 2]], { cls: '', layer: 2, normal: [1, 0, 0] }))
      prims.push(k.poly(P, [[-w / 2 - 0.2, yl, -h / 2], [-w / 2 - 0.2, yl, h / 2]], { cls: '', layer: 2, normal: [-1, 0, 0] }))
      prims.push(k.poly(P, [[-w / 2, yl, h / 2 + 0.2], [w / 2, yl, h / 2 + 0.2]], { cls: '', layer: 2, normal: [0, 0, 1] }))
    }

    // The engraving: a soft border and a line round the screen.
    var ctrl = s.ctrl || {}, scr = ctrl.screen
    if (s.deco) {
      var gd = s.deco.g == null ? 1 : s.deco.g
      prims.push(k.poly(P, rounded(w - 12, h - 12, 7, -0.3), { cls: 'engrave', closed: true, layer: 3, normal: [0, -1, 0], reveal: gd }))
      if (scr) prims.push(k.poly(P.move(scr.u, 0, scr.v), rounded(scr.w + 8, scr.h + 8, 3, -0.3), { cls: 'engrave', closed: true, layer: 3, normal: [0, -1, 0], reveal: gd }))
    }

    // The controls.
    var gi = 0
    Object.keys(ctrl).forEach(function (id) {
      var c = ctrl[id], g = c.g == null ? 1 : c.g
      if (g <= 0.001) return
      var gr = Math.min(1, g * 1.6)
      if (c.k === 'screen') {
        prims.push(k.box(P, c.u - c.w / 2 * gr, c.u + c.w / 2 * gr, -1.5 * g, 0, c.v - c.h / 2 * gr, c.v + c.h / 2 * gr, { mat: 'screen', layer: 3 }))
        var gl = [[c.u - c.w / 2 + 5, -1.6 * g, c.v - c.h / 2 + 6], [c.u - c.w / 2 + 5 + (c.w - 10) * 0.62 * g, -1.6 * g, c.v - c.h / 2 + 6]]
        prims.push(k.poly(P, gl, { cls: 'glare', layer: 4, normal: [0, -1, 0] }))
        prims.push(k.poly(P, [[c.u - c.w / 2 + 5, -1.6 * g, c.v + 2], [c.u - c.w / 2 + 5 + 9 * g, -1.6 * g, c.v + 2]], { cls: 'glare', layer: 4, normal: [0, -1, 0] }))
        return
      }
      if (c.k === 'button') {
        prims.push(k.cyl(P, [c.u, 0, c.v], [0, -1, 0], 9.5 * gr, 2.5 * g, { mat: 'ring', layer: 4, n: 22 }))
        prims.push(k.cyl(P, [c.u, -2.5 * g, c.v], [0, -1, 0], 7 * gr, 5.5 * g, { mat: 'cap', layer: 4, n: 20 }))
      } else if (c.k === 'toggle') {
        prims.push(k.cyl(P, [c.u, 0, c.v], [0, -1, 0], 3.4 * gr, 5 * g, { mat: 'metal', layer: 4, n: 14 }))
        prims.push(k.cyl(P, [c.u, -5 * g, c.v], [0, -0.93, 0.37], 1.3, 12 * g, { mat: 'metal', layer: 4, n: 10 }))
      } else if (c.k === 'knob') {
        var kh = 15 * g, rot = (c.rot || 0) * Math.PI / 180
        prims.push(k.cyl(P, [c.u, 0, c.v], [0, -1, 0], 11 * gr, kh, { mat: 'knob', layer: 4, n: 28, seams: true }))
        prims.push(k.poly(P, [[c.u, -kh - 0.2, c.v], [c.u + 8 * Math.sin(rot), -kh - 0.2, c.v + 8 * Math.cos(rot)]], { cls: 'pointer', layer: 5, normal: [0, -1, 0] }))
      }
      // A label plate in a pocket under it.
      if (s.plates) {
        var gp = Math.min(g, s.plates.g == null ? 1 : s.plates.g)
        if (gp > 0.01) {
          var pv = c.v - (c.k === 'knob' ? 17 : c.k === 'toggle' ? 12 : 15)
          prims.push(k.poly(P, rect(c.u, pv, 15 * gp, 8 * gp, -0.4), { cls: 'plate', closed: true, fill: true, layer: 3, normal: [0, -1, 0] }))
          var gly = GLYPHS[gi % GLYPHS.length].map(function (q) { return [c.u + q[0] * gp, -0.6, pv + q[1] * gp * 0.8] })
          prims.push(k.poly(P, gly, { cls: 'glyph', layer: 3, normal: [0, -1, 0] }))
        }
      }
      gi++
    })

    // The floor: under the box alone, then under the rig.
    var minZ = Infinity
    prims.forEach(function (p) { if (p.o.focus) p.pts.forEach(function (q) { if (q[2] < minZ) minZ = q[2] }) })
    var rg = s.rig ? (s.rig.g == null ? 1 : s.rig.g) : 0
    return { prims: prims, grid: { z: (minZ - 1) * (1 - rg) + -80 * rg, step: 20, extent: 360, center: [POS.x - 40, 0] } }
  }

  // Layouts, in millimetres on the face from its middle (u across, v up).
  function buttons(us, vs) {
    var out = {}, n = 1
    vs.forEach(function (v) { us.forEach(function (u) { out['b' + (n < 10 ? '0' : '') + n++] = { k: 'button', u: u, v: v } }) })
    return out
  }
  function assign(o, more) { for (var key in more) o[key] = more[key]; return o }

  var start = {
    status: 'a 20 mm cube to start from',
    cam: { az: -58, el: 22 },
    box: { w: 20, h: 20, d: 20, lean: 0, yaw: 0 },
    ctrl: {}
  }

  var steps = [
    {
      you: 'A printable box for a sim racing button panel: 12 push buttons, 5 toggle switches and a small ESP32 touch screen. Sturdy, and facing me.',
      tools: [['read', 'brief.md'], ['edit', 'simracing_panel.py', '+142 -3']],
      reply: 'A box 180 × 110 mm and 40 deep, its face leaning back 20°. The screen on the left, five toggles over three rows of buttons.',
      rev: 3, checks: 2,
      change: function (s) {
        s.box = { w: 180, h: 110, d: 40, lean: 20, yaw: 0 }
        s.ctrl = assign({ screen: { k: 'screen', u: -56, v: 6, w: 46, h: 32 } }, buttons([-6, 18, 42, 66], [14, -10, -34]))
        ;[-6, 12, 30, 48, 66].forEach(function (u, i) { s.ctrl['t' + (i + 1)] = { k: 'toggle', u: u, v: 38 } })
      }
    },
    {
      you: 'Make it vertical instead.',
      tools: [['edit', 'simracing_panel.py', '+31 -28']],
      reply: 'Now 110 wide and 180 tall: the screen on top, the toggles under it, the buttons three across.',
      rev: 8, checks: 2,
      change: function (s) {
        s.box.w = 110; s.box.h = 180
        s.ctrl.screen = { k: 'screen', u: 0, v: 58, w: 46, h: 32 }
        assign(s.ctrl, buttons([-28, 0, 28], [0, -24, -48, -72]))
        ;[-36, -18, 0, 18, 36].forEach(function (u, i) { s.ctrl['t' + (i + 1)] = { k: 'toggle', u: u, v: 27 } })
      }
    },
    {
      you: 'Give this face some design, so it looks like a piece of a race car interior.',
      mark: { kind: 'pin', id: 'M1', ref: 'shell/F9', at: function (s) { return panel(s, TornoStory.Frame).at([34, 0, -84]) } },
      tools: [['look', 'shell/F9'], ['edit', 'simracing_panel.py', '+48 -2']],
      reply: 'Engraved a soft border and a line round the screen, cut 0.6 mm into the face.',
      rev: 12, checks: 3,
      change: function (s) { s.deco = { g: 1 } }
    },
    {
      you: 'It goes on the outside of the right arm of my rig, here. Above the shifter, turned towards me.',
      mark: { kind: 'pin', id: 'M2', ref: 'cockpit/F67', at: function () { return [20, -60, -40] } },
      tools: [['look', 'cockpit'], ['measure', 'cockpit/F67'], ['edit', 'simracing_panel.py', '+96 -11']],
      reply: 'A blade bolted to the arm with M8 slot nuts. The box sits 150 mm up, leans back 35° and turns 25° to the seat.',
      rev: 19, checks: 9, build: 1.8,
      change: function (s) {
        s.rig = { g: 1 }; s.blade = { g: 1 }
        s.box.lean = 35; s.box.yaw = 25
        s.cam = { az: -104, el: 26 }
      }
    },
    {
      you: 'The blade looks off and would be hard to print. Make an arm I can adjust, that locks once it is set.',
      tools: [['edit', 'simracing_panel.py', '+174 -61']],
      reply: 'A base, a link and a head. Each joint turns in 15° steps on face teeth and locks with one M8 bolt.',
      rev: 24, checks: 16, build: 1.8,
      change: function (s) { delete s.blade; s.joint = { g: 1 }; s.cam = { az: -96, el: 22 } }
    },
    {
      you: 'Use 9 buttons, 3 toggles and 2 rotary knobs. And small swappable label plates under each control.',
      tools: [['edit', 'simracing_panel.py', '+119 -40']],
      reply: 'Two knobs down the left, the screen under the toggles, and a 15 × 8 mm plate in a pocket under each control.',
      rev: 29, checks: 24, build: 1.8,
      change: function (s) {
        s.box.w = 118
        s.cam = { az: -108, el: 26, tight: 1 }
        ;['t4', 't5', 'b10', 'b11', 'b12'].forEach(function (id) { delete s.ctrl[id] })
        assign(s.ctrl, buttons([-30, 0, 30], [-6, -36, -66]))
        s.ctrl.screen = { k: 'screen', u: 22, v: 36, w: 44, h: 26 }
        ;[2, 22, 42].forEach(function (u, i) { s.ctrl['t' + (i + 1)] = { k: 'toggle', u: u, v: 72 } })
        s.ctrl.k1 = { k: 'knob', u: -36, v: 62, rot: 30 }
        s.ctrl.k2 = { k: 'knob', u: -36, v: 26, rot: -50 }
        s.plates = { g: 1 }
      }
    },
    {
      you: 'Too much empty space at the sides. Keep it under 100 mm wide.',
      mark: {
        kind: 'dim', id: 'M3', label: 'width', max: 100,
        value: function (s) { return s.box.w },
        at: function (s) {
          var P = panel(s, TornoStory.Frame), w = s.box.w, h = s.box.h
          return [P.at([-w / 2, 0, h / 2 + 14]), P.at([w / 2, 0, h / 2 + 14]), P.at([-w / 2, 0, h / 2 + 2]), P.at([w / 2, 0, h / 2 + 2])]
        }
      },
      tools: [['measure', 'M3'], ['edit', 'simracing_panel.py', '+22 -22']],
      reply: 'Narrowed to 96 mm with the controls closer together. M3 passes.',
      rev: 33, checks: 27, build: 1.8, hold: 3,
      change: function (s) {
        s.box.w = 96
        s.ctrl.k1.u = -28; s.ctrl.k2.u = -28
        assign(s.ctrl, buttons([-26, 0, 26], [-6, -36, -66]))
        s.ctrl.screen.u = 18; s.ctrl.screen.w = 40
        ;[2, 18, 34].forEach(function (u, i) { s.ctrl['t' + (i + 1)].u = u })
      }
    }
  ]

  TornoStory.add('simracing-panel', {
    name: 'simracing-panel',
    file: 'simracing_panel.py',
    intro: 'New project, simracing-panel. torno starts it as a 20 mm cube.',
    summary: 'A sim racing button box made in torno in seven prompts: a box with buttons, toggles and a screen; turned vertical; ' +
      'an engraved face; mounted on the rig; an adjustable arm; knobs and label plates; and narrowed to 96 mm, which the width check then passes.',
    maxScale: 2.3,
    start: start,
    steps: steps,
    scene: scene
  })
})()
