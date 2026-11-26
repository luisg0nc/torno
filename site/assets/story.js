// torno stories: a part made in a few turns of the loop, drawn the way the landing page draws its bracket.
// A story is a start state, a list of steps (what you said, what Claude Code did, how the model changed) and a scene
// that turns a state into solids. The engine types the prompts, tweens each state into the next and draws them in
// SVG, with the camera fitted to the part. With motion reduced it shows the last state and the whole conversation.
;(function () {
  'use strict'
  var NS = 'http://www.w3.org/2000/svg', RAD = Math.PI / 180
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  function svg(name, attrs, parent) {
    var e = document.createElementNS(NS, name)
    for (var k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }
  function html(tag, cls, parent, text) {
    var e = document.createElement(tag)
    if (cls) e.className = cls
    if (text != null) e.textContent = text
    if (parent) parent.appendChild(e)
    return e
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x }
  function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
  function clone(o) { return JSON.parse(JSON.stringify(o)) }

  // Vectors are [x, y, z] in millimetres, Z up.
  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
  function mul(a, k) { return [a[0] * k, a[1] * k, a[2] * k] }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
  function norm(a) { var l = Math.sqrt(dot(a, a)) || 1; return [a[0] / l, a[1] / l, a[2] / l] }

  // A frame: an origin and three unit axes, all in world coordinates.
  function Frame(o, x, y, z) { this.o = o; this.x = x; this.y = y; this.z = z }
  Frame.world = function () { return new Frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]) }
  Frame.prototype.at = function (p) {
    var o = this.o, x = this.x, y = this.y, z = this.z
    return [o[0] + x[0] * p[0] + y[0] * p[1] + z[0] * p[2], o[1] + x[1] * p[0] + y[1] * p[1] + z[1] * p[2], o[2] + x[2] * p[0] + y[2] * p[1] + z[2] * p[2]]
  }
  Frame.prototype.dir = function (v) {
    var x = this.x, y = this.y, z = this.z
    return [x[0] * v[0] + y[0] * v[1] + z[0] * v[2], x[1] * v[0] + y[1] * v[1] + z[1] * v[2], x[2] * v[0] + y[2] * v[1] + z[2] * v[2]]
  }
  Frame.prototype.move = function (x, y, z) { return new Frame(this.at([x, y, z]), this.x, this.y, this.z) }
  // Turned about one of its own axes, right-handed, in degrees.
  Frame.prototype.turn = function (axis, deg) {
    var c = Math.cos(deg * RAD), s = Math.sin(deg * RAD)
    var k = axis === 'x' ? ['y', 'z'] : axis === 'y' ? ['z', 'x'] : ['x', 'y']
    var u = this[k[0]], v = this[k[1]], f = new Frame(this.o, this.x, this.y, this.z)
    f[k[0]] = add(mul(u, c), mul(v, s))
    f[k[1]] = add(mul(u, -s), mul(v, c))
    return f
  }
  // From a to b along z, its y as close to `hint` as it can be.
  Frame.along = function (a, b, hint) {
    var z = norm(sub(b, a)), y = norm(sub(hint, mul(z, dot(hint, z))))
    return new Frame(a, cross(y, z), y, z)
  }

  // Solids. `o` is { mat, layer, focus, op }: what it is made of (a class), the layer it is drawn in (lower first;
  // within a layer, farther first), whether the camera frames it, and its opacity.
  function opts(o) {
    o = o || {}
    return { mat: o.mat || 'part', layer: o.layer || 0, focus: o.focus !== false, op: o.op == null ? 1 : o.op, n: o.n, seams: o.seams, cls: o.cls }
  }
  function centroid(ps) {
    var c = [0, 0, 0]
    for (var i = 0; i < ps.length; i++) c = add(c, ps[i])
    return mul(c, 1 / ps.length)
  }
  function box(f, x0, x1, y0, y1, z0, z1, o) {
    var p = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]].map(function (q) { return f.at(q) })
    var face = function (a, b, c, d, n) { return { p: [p[a], p[b], p[c], p[d]], n: f.dir(n) } }
    return {
      kind: 'box', o: opts(o), pts: p, c: centroid(p),
      faces: [face(0, 3, 2, 1, [0, 0, -1]), face(4, 5, 6, 7, [0, 0, 1]), face(0, 1, 5, 4, [0, -1, 0]),
        face(2, 3, 7, 6, [0, 1, 0]), face(3, 0, 4, 7, [-1, 0, 0]), face(1, 2, 6, 5, [1, 0, 0])]
    }
  }
  // A cylinder on `axis` (local, unit), its bottom centred at c (local), r round and h long.
  function cyl(f, c, axis, r, h, o) {
    o = opts(o)
    var n = o.n || 20, a = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
    var u = norm(cross(axis, a)), v = cross(axis, u)
    var bot = [], top = [], ns = []
    for (var i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2, rad = add(mul(u, Math.cos(t)), mul(v, Math.sin(t)))
      var t2 = ((i + 0.5) / n) * Math.PI * 2
      bot.push(f.at(add(c, mul(rad, r))))
      top.push(f.at(add(add(c, mul(rad, r)), mul(axis, h))))
      ns.push(f.dir(add(mul(u, Math.cos(t2)), mul(v, Math.sin(t2)))))
    }
    var all = bot.concat(top)
    return { kind: 'cyl', o: o, pts: all, c: centroid(all), bot: bot, top: top, ns: ns, axis: f.dir(axis) }
  }
  // A flat outline on a face: drawn only when `normal` (local) faces the camera; `reveal` 0 to 1 draws it in.
  function poly(f, pts, o) {
    var p = pts.map(function (q) { return f.at(q) })
    var pr = opts(o)
    pr.closed = !!(o && o.closed); pr.fill = !!(o && o.fill); pr.reveal = o && o.reveal != null ? o.reveal : 1
    return { kind: 'poly', o: pr, pts: p, c: centroid(p), n: o && o.normal ? f.dir(o.normal) : null }
  }

  // Tweens one state into the next. Numbers go between; a key only one side has comes or goes by its `g` (0 to 1),
  // the ones in one map one after the other; anything else changes at half way.
  function tween(a, b, t) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      var out = {}, keys = Object.keys(a), k, i
      for (k in b) if (!(k in a)) keys.push(k)
      var moving = keys.filter(function (q) { return !(q in a) || !(q in b) })
      var s = moving.length > 1 ? Math.min(0.04, 0.22 / moving.length) : 0
      for (i = 0; i < keys.length; i++) {
        k = keys[i]
        if (k in a && k in b) { out[k] = tween(a[k], b[k], t); continue }
        // What goes leaves in the first 60 % of the build; what comes arrives in the last 38 %, once the rest has moved.
        var j = moving.indexOf(k), t0 = k in b ? 0.62 : 0, span = k in b ? 0.38 : 0.6
        var tt = clamp((t - t0 - j * s) / (span - (moving.length - 1) * s), 0, 1)
        var v = k in b ? b[k] : a[k]
        if (v && typeof v === 'object') {
          out[k] = Object.assign({}, v)
          out[k].g = (v.g == null ? 1 : v.g) * (k in b ? tt : 1 - tt)
        } else if (k in b ? tt > 0 : tt < 1) out[k] = v
      }
      return out
    }
    return t < 0.5 ? a : b
  }

  // Numbers shown: four significant digits at most, as the window shows them.
  function fmt(v) { return String(Number(v.toPrecision(4))) }

  function play(root, story) {
    var W = 640, H = 460
    // The states after each step.
    var states = [clone(story.start)]
    story.steps.forEach(function (st, i) {
      var s = clone(states[i])
      if (st.change) st.change(s)
      states.push(s)
    })

    // When each thing happens, in seconds from the start.
    var t = 1.1
    story.steps.forEach(function (st) {
      var T = { start: t }
      T.type0 = t + (st.mark ? 0.6 : 0.25)
      T.type1 = T.type0 + clamp(st.you.length / 42, 0.7, 2.8)
      var x = T.type1 + 0.55
      T.tools = (st.tools || []).map(function () { var at = x; x += 0.5; return at })
      T.build0 = x + 0.1
      T.build1 = T.build0 + (st.build || 1.5)
      T.reply = T.build1 + 0.3
      T.end = T.reply + (st.hold || 2.4)
      st.T = T
      t = T.end
    })
    var total = t, HOLD = 3.5, LOOP = total + HOLD

    // The figure.
    root.classList.add('story')
    var view = html('div', 'story-view', root)
    var head = html('div', 'story-head', view)
    var name = html('span', 'story-name num', head, story.name)
    var rev = html('span', 'story-rev num', head, '')
    var status = html('span', 'story-status', head)
    html('span', 'story-dot', status)
    var statusText = html('span', '', status, '')
    var pause = html('button', 'story-pause', head, 'Pause')
    pause.type = 'button'
    if (still) pause.hidden = true
    void name
    var s = svg('svg', { class: 'story-svg', viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' }, view)
    var defs = svg('defs', {}, s)
    var gid = 'story-fade-' + Math.random().toString(36).slice(2, 8)
    var rg = svg('radialGradient', { id: gid + 'g', cx: '50%', cy: '55%', r: '55%' }, defs)
    svg('stop', { offset: '0.4', 'stop-color': '#fff' }, rg)
    svg('stop', { offset: '1', 'stop-color': '#000' }, rg)
    var mask = svg('mask', { id: gid, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: W, height: H }, defs)
    svg('rect', { x: 0, y: 0, width: W, height: H, fill: 'url(#' + gid + 'g)' }, mask)
    var gridPath = svg('path', { class: 'story-grid', mask: 'url(#' + gid + ')' }, s)
    var model = svg('g', { class: 'story-model' }, s)
    var marksG = svg('g', { class: 'story-marks' }, s)
    var readout = html('p', 'story-readout', view, '')
    var chat = html('div', 'story-chat', root)
    var log = html('div', 'story-log', chat)
    var ticks = html('div', 'story-ticks', root)
    var tickFills = story.steps.map(function (st, i) {
      var b = html('button', 'story-tick', ticks)
      b.type = 'button'
      b.setAttribute('aria-label', 'Step ' + (i + 1) + ': ' + st.you)
      b.addEventListener('click', function () { clock = st.T.start - 0.01; playing = true; pause.textContent = 'Pause'; kick() })
      return html('span', '', b)
    })
    if (story.summary) html('p', 'story-sr', root, story.summary)

    // The conversation, as events at their times; going back clears it and plays them again at once.
    var events = [], typers = [], ei = 0, lastClock = -1
    events.push({ t: 0, run: function () { html('p', 'story-row story-note', log, story.intro || '') } })
    story.steps.forEach(function (st, i) {
      var T = st.T, agent = null, tools = null, buildLine = null
      events.push({ t: T.start, run: function () {
        agent = tools = buildLine = null
        var row = html('div', 'story-row story-you', log)
        html('span', 'story-who', row, 'You')
        var p = html('p', 'story-msg', row)
        if (st.mark) {
          var chip = html('span', 'story-chip num ' + (st.mark.kind === 'dim' ? 'dim' : 'pin'), p, st.mark.id)
          void chip
          if (st.mark.ref) html('span', 'ref', p, st.mark.ref)
          p.appendChild(document.createTextNode(' '))
        }
        var typed = html('span', '', p, '')
        var caret = html('span', 'story-caret', p)
        typers.push({ span: typed, caret: caret, text: st.you, t0: T.type0, t1: T.type1, done: false })
      } })
      ;(st.tools || []).forEach(function (tool, j) {
        events.push({ t: T.tools[j], run: function () {
          if (!agent) {
            agent = html('div', 'story-row story-agent', log)
            html('span', 'story-who', agent, 'Claude')
            tools = html('ul', 'story-tools', agent)
          }
          var li = html('li', '', tools)
          html('span', 'story-tool num', li, tool[0])
          if (tool[1]) html('span', 'num story-arg' + (/\//.test(tool[1]) ? ' ref' : ''), li, tool[1])
          if (tool[2]) {
            var m = /^\+(\d+) -(\d+)$/.exec(tool[2])
            if (m) { html('span', 'num story-plus', li, '+' + m[1]); html('span', 'num story-minus', li, '−' + m[2]) }
          }
        } })
      })
      events.push({ t: T.build0, run: function () {
        if (!agent) { agent = html('div', 'story-row story-agent', log); html('span', 'story-who', agent, 'Claude') }
        buildLine = html('p', 'story-build num', agent, 'building r' + st.rev)
      } })
      events.push({ t: T.build1, run: function () {
        buildLine.textContent = ''
        buildLine.classList.add('ok')
        html('span', 'story-tickmark', buildLine, '')
        buildLine.appendChild(document.createTextNode('r' + st.rev + ' built, ' + st.checks + (st.checks === 1 ? ' check passes' : ' checks pass')))
      } })
      events.push({ t: T.reply, run: function () { html('p', 'story-reply', agent, st.reply) } })
      void i
    })
    events.sort(function (a, b) { return a.t - b.t })

    function syncChat(c) {
      if (c < lastClock) {
        log.textContent = ''
        typers = []; ei = 0
        log.classList.add('instant')
        requestAnimationFrame(function () { requestAnimationFrame(function () { log.classList.remove('instant') }) })
      }
      lastClock = c
      while (ei < events.length && events[ei].t <= c) events[ei++].run()
      for (var i = 0; i < typers.length; i++) {
        var ty = typers[i]
        if (ty.done) continue
        var n = Math.round(ty.text.length * clamp((c - ty.t0) / (ty.t1 - ty.t0), 0, 1))
        ty.span.textContent = ty.text.slice(0, n)
        if (n >= ty.text.length) { ty.done = true; ty.caret.remove() }
      }
    }

    // The model at a time: the last state built, or one being built.
    function stateAt(c) {
      for (var i = 0; i < story.steps.length; i++) {
        var T = story.steps[i].T
        if (c < T.build0) return { s: states[i], step: i, building: false }
        if (c < T.build1) return { s: tween(states[i], states[i + 1], ease((c - T.build0) / (T.build1 - T.build0))), step: i, building: true }
      }
      return { s: states[states.length - 1], step: story.steps.length - 1, building: false }
    }

    // Drawing.
    var pool = [], used = 0
    function emit(d, cls, style) {
      var e = pool[used]
      if (!e) { e = svg('path', {}, model); pool.push(e); e._d = e._c = e._s = null }
      if (e._d !== d) { e.setAttribute('d', d); e._d = d }
      if (e._c !== cls) { e.setAttribute('class', cls); e._c = cls }
      if (e._s !== style) { e.setAttribute('style', style); e._s = style }
      used++
    }
    var cam = { cx: 0, cy: 0, scale: 0, ready: false }, LIGHT = norm([-0.35, -0.55, 0.85])
    function basis(az, el) {
      var c = [Math.cos(el * RAD) * Math.cos(az * RAD), Math.cos(el * RAD) * Math.sin(az * RAD), Math.sin(el * RAD)]
      var r = norm(cross([0, 0, 1], c)), u = cross(c, r)
      return { c: c, r: r, u: u }
    }
    function proj(B, p) { return [W / 2 + (dot(p, B.r) - cam.cx) * cam.scale, H / 2 - (dot(p, B.u) - cam.cy) * cam.scale] }
    function pathOf(B, pts, closed) {
      var out = ''
      for (var i = 0; i < pts.length; i++) {
        var q = proj(B, pts[i])
        out += (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)
      }
      return out + (closed ? 'Z' : '')
    }
    function shade(n) { return 'calc(' + ((1 - (dot(n, LIGHT) * 0.5 + 0.5)) * 34).toFixed(1) + '% * var(--shade-k, 1))' }
    function style(k, op) { return '--k:' + k + (op < 1 ? ';opacity:' + op.toFixed(3) : '') }

    function draw(prims, grid, B) {
      used = 0
      var list = prims.map(function (p) { return { p: p, d: dot(p.c, B.c) } })
      list.sort(function (a, b) { return a.p.o.layer - b.p.o.layer || a.d - b.d })
      for (var i = 0; i < list.length; i++) {
        var p = list[i].p, o = p.o, mat = ' m-' + o.mat, j
        if (o.op <= 0.002) continue
        if (p.kind === 'box') {
          var fs = p.faces.filter(function (f) { return dot(f.n, B.c) > 1e-4 })
          for (j = 0; j < fs.length; j++) emit(pathOf(B, fs[j].p, true), 'f' + mat, style(shade(fs[j].n), o.op))
        } else if (p.kind === 'cyl') {
          var n = p.bot.length, vis = [], lines = ''
          for (j = 0; j < n; j++) vis.push(dot(p.ns[j], B.c) > 0)
          var capUp = dot(p.axis, B.c) > 0
          for (j = 0; j < n; j++) {
            if (!vis[j]) continue
            var k2 = (j + 1) % n
            emit(pathOf(B, [p.bot[j], p.bot[k2], p.top[k2], p.top[j]], true), 'f side' + mat, style(shade(p.ns[j]), o.op))
            lines += pathOf(B, [capUp ? p.bot[j] : p.top[j], capUp ? p.bot[k2] : p.top[k2]])
            if (o.seams) lines += pathOf(B, [p.bot[j], p.top[j]])
            if (vis[j] !== vis[(j + n - 1) % n]) lines += pathOf(B, [p.bot[j], p.top[j]])
            if (vis[j] !== vis[k2]) lines += pathOf(B, [p.bot[k2], p.top[k2]])
          }
          var cap = capUp ? p.top : p.bot.slice().reverse()
          emit(pathOf(B, cap, true), 'f' + mat, style(shade(capUp ? p.axis : mul(p.axis, -1)), o.op))
          if (lines) emit(lines, 'ln' + mat, style('0%', o.op))
        } else if (p.kind === 'poly') {
          if (p.n && dot(p.n, B.c) <= 0) continue
          var d = pathOf(B, p.pts, o.closed), st = style('0%', o.op)
          if (o.reveal < 1) {
            var L = 0, prev = null
            var pts = o.closed ? p.pts.concat([p.pts[0]]) : p.pts
            for (j = 0; j < pts.length; j++) {
              var q = proj(B, pts[j])
              if (prev) L += Math.hypot(q[0] - prev[0], q[1] - prev[1])
              prev = q
            }
            L = Math.ceil(L) + 1
            st += ';stroke-dasharray:' + L + ' ' + L + ';stroke-dashoffset:' + (L * (1 - o.reveal)).toFixed(1)
          }
          emit(d, 'pl ' + (o.cls || '') + mat + (o.fill ? ' filled' : ''), st)
        }
      }
      for (var e = used; e < pool.length; e++) if (pool[e]._d !== '') { pool[e].setAttribute('d', ''); pool[e]._d = '' }
      // The floor: a grid every `step` mm round `center`.
      if (grid) {
        var gd = '', st2 = grid.step || 20, ex = grid.extent || 300, cx = grid.center[0], cy = grid.center[1], z = grid.z
        for (var g = -ex; g <= ex + 1e-6; g += st2) {
          gd += pathOf(B, [[cx + g, cy - ex, z], [cx + g, cy + ex, z]]) + pathOf(B, [[cx - ex, cy + g, z], [cx + ex, cy + g, z]])
        }
        gridPath.setAttribute('d', gd)
      }
    }

    // The camera: the angle the state asks for, swaying a little, fitted to the solids it frames.
    var sway = 0
    function fit(prims, B, dt) {
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
      prims.forEach(function (p) {
        if (!p.o.focus || p.o.op < 0.5) return
        p.pts.forEach(function (q) {
          var x = dot(q, B.r), y = dot(q, B.u)
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
        })
      })
      if (!isFinite(x0)) return
      var sc = Math.min((W * 0.72) / Math.max(x1 - x0, 1), (H * 0.7) / Math.max(y1 - y0, 1), story.maxScale || 3)
      var tx = (x0 + x1) / 2, ty = (y0 + y1) / 2
      if (!cam.ready || dt === 0) { cam.cx = tx; cam.cy = ty; cam.scale = sc; cam.ready = true; return }
      var a = 1 - Math.exp(-dt * 3.2)
      cam.cx += (tx - cam.cx) * a; cam.cy += (ty - cam.cy) * a; cam.scale += (sc - cam.scale) * a
    }

    // Marks: a pin or a dimension, shown from its step's start to the next step's.
    var markEls = {}
    function markEl(m) {
      if (markEls[m.id]) return markEls[m.id]
      var g = svg('g', { class: 'story-mark ' + m.kind }, marksG), e = { g: g }
      if (m.kind === 'pin') {
        e.stem = svg('line', { class: 'pin-stem' }, g)
        e.head = svg('circle', { class: 'pin-head', r: 8 }, g)
        e.ref = svg('text', { class: 'pin-ref' }, g)
        e.ref.textContent = m.id
      } else {
        e.e1 = svg('line', { class: 'dim-ext' }, g)
        e.e2 = svg('line', { class: 'dim-ext' }, g)
        e.line = svg('line', { class: 'dim-line' }, g)
        e.t1 = svg('path', { class: 'dim-end' }, g)
        e.t2 = svg('path', { class: 'dim-end' }, g)
        e.text = svg('text', { class: 'dim-text' }, g)
      }
      markEls[m.id] = e
      return e
    }
    function setLine(l, a, b) { l.setAttribute('x1', a[0].toFixed(1)); l.setAttribute('y1', a[1].toFixed(1)); l.setAttribute('x2', b[0].toFixed(1)); l.setAttribute('y2', b[1].toFixed(1)) }
    function drawMarks(c, s, B) {
      var lines = []
      story.steps.forEach(function (st, i) {
        var m = st.mark
        if (!m) return
        var from = st.T.start, to = i + 1 < story.steps.length ? story.steps[i + 1].T.start : LOOP
        var op = clamp((c - from) / 0.35, 0, 1) * clamp((to - c) / 0.35, 0, 1)
        var e = markEl(m)
        e.g.style.opacity = op.toFixed(3)
        if (op <= 0) return
        if (m.kind === 'pin') {
          var a = proj(B, m.at(s)), h = [a[0] + 22, a[1] - 34]
          setLine(e.stem, a, h)
          e.head.setAttribute('cx', h[0].toFixed(1)); e.head.setAttribute('cy', h[1].toFixed(1))
          e.ref.setAttribute('x', h[0].toFixed(1)); e.ref.setAttribute('y', h[1].toFixed(1))
          lines.push('<span class="story-chip num pin">' + m.id + '</span> pin on <span class="ref">' + m.ref + '</span>')
        } else {
          var ends = m.at(s), p1 = proj(B, ends[0]), p2 = proj(B, ends[1]), q1 = proj(B, ends[2]), q2 = proj(B, ends[3])
          setLine(e.e1, q1, p1); setLine(e.e2, q2, p2); setLine(e.line, p1, p2)
          var ang = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]), ca = Math.cos(ang), sa = Math.sin(ang)
          var tick = function (p, dir) {
            var bx = p[0] - ca * 8 * dir, by = p[1] - sa * 8 * dir
            return 'M' + p[0].toFixed(1) + ' ' + p[1].toFixed(1) + 'L' + (bx - sa * 3.5).toFixed(1) + ' ' + (by + ca * 3.5).toFixed(1) + 'L' + (bx + sa * 3.5).toFixed(1) + ' ' + (by - ca * 3.5).toFixed(1) + 'Z'
          }
          e.t1.setAttribute('d', tick(p1, -1)); e.t2.setAttribute('d', tick(p2, 1))
          var v = m.value(s), ok = m.max == null || v <= m.max + 1e-9
          var mx = (p1[0] + p2[0]) / 2 + sa * 14, my = (p1[1] + p2[1]) / 2 - ca * 14
          e.text.setAttribute('x', mx.toFixed(1)); e.text.setAttribute('y', my.toFixed(1))
          e.text.setAttribute('transform', 'rotate(' + (ang / RAD).toFixed(2) + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ')')
          e.text.textContent = fmt(v) + ' mm'
          e.g.classList.toggle('pass', ok)
          lines.push('<span class="story-chip num dim">' + m.id + '</span> ' + m.label + ' <span class="num">' + fmt(v) +
            '</span> mm, at most <span class="num">' + fmt(m.max) + '</span> mm: <span class="verdict' + (ok ? ' pass' : '') + '">' + (ok ? 'passes' : 'fails') + '</span>')
        }
      })
      return lines
    }

    var lastHead = '', lastRead = ''
    function render(c, dt) {
      syncChat(c)
      var at = stateAt(c), sNow = at.s
      var camS = sNow.cam || { az: -60, el: 24 }
      var B = basis(camS.az + Math.sin(sway) * 4, camS.el + Math.sin(sway * 0.7) * 1.2)
      var out = story.scene(sNow, kit)
      fit(out.prims, B, dt)
      draw(out.prims, out.grid, B)
      var fade = clamp(c / 0.5, 0, 1) * clamp((LOOP - c) / 0.6, 0, 1)
      model.style.opacity = gridPath.style.opacity = fade.toFixed(3)
      log.style.opacity = (clamp((LOOP - c) / 0.6, 0, 1)).toFixed(3)
      var lines = drawMarks(c, sNow, B)

      // The head: the last revision built and what is going on.
      var st = story.steps[at.step], T = st.T, built = null, text, mode
      for (var i = story.steps.length - 1; i >= 0; i--) if (c >= story.steps[i].T.build1) { built = story.steps[i]; break }
      if (c >= T.type1 && c < T.build0) { mode = 'working'; text = 'Claude Code is working' }
      else if (at.building) { mode = 'working'; text = 'building r' + st.rev }
      else if (built) { mode = 'ok'; text = built.checks + ' checks pass' }
      else { mode = ''; text = story.start.status || 'new project' }
      var key = mode + text + (built ? built.rev : '')
      if (key !== lastHead) {
        lastHead = key
        status.className = 'story-status ' + mode
        statusText.textContent = text
        rev.textContent = built ? 'r' + built.rev : 'r1'
      }
      var read = lines.join('<br>') || (built ? '<span class="num">' + story.file + '</span>, r' + built.rev + ': ' + built.checks + ' checks pass' : '<span class="num">' + story.file + '</span>: ' + (story.start.status || ''))
      if (read !== lastRead) { readout.innerHTML = read; lastRead = read }
      story.steps.forEach(function (stp, i) {
        tickFills[i].style.width = (clamp((c - stp.T.start) / (stp.T.end - stp.T.start), 0, 1) * 100).toFixed(1) + '%'
      })
    }

    var kit = { Frame: Frame, box: box, cyl: cyl, poly: poly, add: add, sub: sub, mul: mul, norm: norm }

    var clock = 0, last = null, inView = true, playing = true, running = false
    // `?t=12.5` holds the story still at that second, to look at one moment of it while writing one.
    var seek = /[?&]t=([\d.]+)/.exec(location.search)
    if (seek && !still) { clock = Math.min(+seek[1], LOOP - 0.7); playing = false; pause.textContent = 'Play' }
    root.storySeek = function (t) { clock = t; lastClock = Infinity; cam.ready = false; playing = false; pause.textContent = 'Play'; kick() }
    root.storyTimes = story.steps.map(function (st) { return st.T })
    // Recording (app/scripts/record-story.mjs): the page stops its own clock and is stepped a frame at a time, the CSS
    // animations of the conversation stepped with it, the camera still.
    var recording = false
    root.storyRecord = function () {
      recording = true; playing = false; clock = 0; lastClock = Infinity; cam.ready = false; sway = 0
      root.classList.add('recording')
      render(0, 0)
      return LOOP
    }
    root.storyAdvance = function (dt) {
      clock += dt
      render(clock, dt)
      document.getAnimations().forEach(function (a) {
        if (a.storyT0 == null) a.storyT0 = clock
        a.pause()
        a.currentTime = (clock - a.storyT0) * 1000
      })
    }
    if (still) {
      clock = total
      render(clock, 0)
      return
    }
    pause.addEventListener('click', function () {
      playing = !playing
      pause.textContent = playing ? 'Pause' : 'Play'
      if (playing) kick()
    })
    new IntersectionObserver(function (es) { inView = es[0].isIntersecting; if (inView) kick() }, { threshold: 0.15 }).observe(root)
    document.addEventListener('visibilitychange', kick)
    function kick() { if (!running) { running = true; last = null; requestAnimationFrame(frame) } }
    function frame(now) {
      var dt = last == null ? 0 : Math.min((now - last) / 1000, 0.1)
      last = now
      if (recording) { running = false; return }
      var live = playing && inView && !document.hidden
      if (live) {
        clock += dt
        sway += dt * (Math.PI * 2 / 28)
        if (clock >= LOOP) { clock = 0; cam.ready = false }
      }
      render(clock, live ? dt : 0)
      if (live || !cam.ready) requestAnimationFrame(frame)
      else running = false
    }
    render(0, 0)
    kick()
  }

  // A story file registers itself by name; each <figure data-story="name"> on the page plays it.
  var registry = {}
  function register(name, story) { registry[name] = story }
  function start() {
    document.querySelectorAll('[data-story]').forEach(function (el) {
      var story = registry[el.getAttribute('data-story')]
      if (story && !el.storyTimes) play(el, story)
    })
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else setTimeout(start)

  window.TornoStory = { add: register, play: play, Frame: Frame }
})()
