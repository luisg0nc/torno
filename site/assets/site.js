// The landing page's motion: the bracket in the hero, measured and rebuilt with Claude Code walking on it, the dot going
// round the loop, and the sections coming into view. With motion reduced, each is drawn once, in its last state.
;(function () {
  'use strict'
  document.documentElement.classList.add('js')
  var still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  var NS = 'http://www.w3.org/2000/svg'

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name)
    for (var k in attrs) e.setAttribute(k, attrs[k])
    if (parent) parent.appendChild(e)
    return e
  }

  // Seen from +x +y, Z up, millimetres; S pixels to the millimetre.
  var S = 5, CX = 158, CY = 178, C30 = Math.cos(Math.PI / 6), S30 = 0.5
  function P(x, y, z) {
    return [CX + (x - y) * C30 * S, CY + (x + y) * S30 * S - z * S]
  }
  function d(points, close) {
    return points.map(function (p, i) { var q = P(p[0], p[1], p[2]); return (i ? 'L' : 'M') + q[0].toFixed(2) + ' ' + q[1].toFixed(2) }).join('') + (close ? 'Z' : '')
  }

  // An L bracket: a base 24 deep, an upright 26 high, both `t` thick, 36 wide, with two holes in the base.
  var W = 36, D = 24, H = 26, WANT = 3
  function bracket(t) {
    var prof = [[0, 0], [D, 0], [D, t], [t, t], [t, H], [0, H]]
    var at = function (x) { return prof.map(function (p) { return [x, p[0], p[1]] }) }
    var far = at(0), near = at(W)
    var paths = []
    paths.push({ cls: 'face', d: d([[0, t, t], [W, t, t], [W, t, H], [0, t, H]], true) })
    paths.push({ cls: 'face', d: d([[0, t, t], [W, t, t], [W, D, t], [0, D, t]], true) })
    paths.push({ cls: 'hidden', d: d([far[5], far[0], far[1]]) })
    paths.push({ cls: '', d: d([far[1], far[2], far[3], far[4], far[5]]) })
    paths.push({ cls: '', d: d(near, true) })
    for (var i = 1; i < 6; i++) paths.push({ cls: '', d: d([far[i], near[i]]) })
    ;[12, 24].forEach(function (hx) {
      var pts = []
      for (var a = 0; a <= 32; a++) {
        var u = (a / 32) * Math.PI * 2
        pts.push([hx + 3.5 * Math.cos(u), (t + D) / 2 + 2 + 3.5 * Math.sin(u), t])
      }
      paths.push({ cls: 'hole', d: d(pts, true) })
    })
    return paths
  }

  var part = document.getElementById('part')
  if (part) {
    var grid = part.querySelector('.grid'), edges = part.querySelector('.edges')
    for (var g = -12; g <= 48; g += 6) {
      var a1 = P(g, -12, 0), a2 = P(g, 40, 0), b1 = P(-12, g, 0), b2 = P(48, g, 0)
      el('line', { x1: a1[0], y1: a1[1], x2: a2[0], y2: a2[1] }, grid)
      el('line', { x1: b1[0], y1: b1[1], x2: b2[0], y2: b2[1] }, grid)
    }
    var nodes = []
    bracket(2).forEach(function (p, i) {
      var n = el('path', { d: p.d, class: p.cls }, edges)
      if (p.cls === 'hidden') n.setAttribute('opacity', '0.3'), n.setAttribute('stroke-dasharray', '3 4')
      nodes.push(n)
    })
    var dimLine = part.querySelector('.dim-line'), dimText = part.querySelector('.dim-text'), dim = part.querySelector('.dim')
    var stem = part.querySelector('.pin-stem'), head = part.querySelector('.pin-head'), ref = part.querySelector('.pin-ref')
    var wallOut = document.querySelector('[data-wall]'), verdict = document.querySelector('[data-verdict]')
    var measured = document.querySelector('[data-measured]')

    // Claude Code itself, drawn from its pixel mark (in the units of a 640 px drawing, its feet at y 533): it walks in,
    // measures the wall from on top of it, hops down and works while the wall is rebuilt.
    var agent = el('g', { class: 'agent', 'aria-hidden': 'true' }, part)
    var pulse = el('ellipse', { class: 'agent-pulse', rx: 0, ry: 0 }, agent)
    var critter = el('g', { class: 'critter' }, agent)
    el('rect', { x: 80, y: 133, width: 480, height: 322 }, critter)
    el('rect', { x: 0, y: 292, width: 640, height: 82 }, critter)
    var legs = [120, 200, 400, 480].map(function (x) { return el('rect', { x: x, y: 450, width: 40, height: 83 }, critter) })
    var eyes = [160, 440].map(function (x) { return el('rect', { class: 'critter-eye', x: x, y: 215, width: 40, height: 77 }, critter) })

    var render = function (t) {
      var ps = bracket(t)
      for (var i = 0; i < ps.length; i++) nodes[i].setAttribute('d', ps[i].d)
      var l1 = P(W, 0, H + 3), l2 = P(W, t, H + 3)
      dimLine.setAttribute('x1', l1[0]); dimLine.setAttribute('y1', l1[1])
      dimLine.setAttribute('x2', l2[0]); dimLine.setAttribute('y2', l2[1])
      dimText.setAttribute("x", l2[0] - 20); dimText.setAttribute("y", l2[1] - 12)
      dimText.textContent = t.toFixed(3) + ' mm'
      var base = P(W / 2, t, H * 0.62), top = [base[0] + 26, base[1] - 34]
      stem.setAttribute('x1', base[0]); stem.setAttribute('y1', base[1])
      stem.setAttribute('x2', top[0]); stem.setAttribute('y2', top[1])
      head.setAttribute('cx', top[0]); head.setAttribute('cy', top[1])
      ref.setAttribute('x', top[0]); ref.setAttribute('y', top[1])
      wallOut.textContent = t.toFixed(3)
      var ok = t >= WANT - 1e-9
      verdict.textContent = ok ? 'passes' : 'fails'
      verdict.classList.toggle('pass', ok)
    }
    var showDim = function (on) {
      dim.style.opacity = on ? '1' : '0'
      measured.style.opacity = on ? '1' : '0'
    }
    // Where it stands: off the far end of the wall, on the wall's top edge (to measure it), on the base in front of the
    // wall (to edit it), off the front of the base.
    var SIZE = 0.075
    var offIn = function (t) { return P(-30, t / 2, H) }
    var onEdge = function (t) { return P(W * 0.24, t / 2, H) }
    var onBase = function (t) { return P(W * 0.66, t + 7, t) }
    var offOut = function (t) { return P(W * 0.66 + 20, D + 18, t) }
    var mix = function (a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k] }
    // `walk` steps its legs, `work` bobs it, `tap` (seconds since) sends a ring out from its feet, `lift` raises it.
    var pose = function (at, op, o) {
      o = o || {}
      var step = o.walk ? Math.floor(o.walk / 0.11) % 2 : -1
      legs.forEach(function (l, i) { l.setAttribute('height', step >= 0 && (i % 2) === step ? 58 : 83) })
      var bob = o.work ? -Math.abs(Math.sin(o.work * 11)) * 3 : 0
      var blink = (o.clock % 3.1) < 0.12
      eyes.forEach(function (e) { e.setAttribute('height', blink ? 12 : 77); e.setAttribute('y', blink ? 250 : 215) })
      var y = at[1] + bob - (o.lift || 0)
      critter.setAttribute('transform', 'translate(' + at[0].toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + SIZE + ') translate(-320 -533)')
      agent.style.opacity = op.toFixed(3)
      var k = o.tap == null ? 1 : Math.max(0, Math.min(1, o.tap / 0.6))
      pulse.setAttribute('cx', at[0].toFixed(1)); pulse.setAttribute('cy', at[1].toFixed(1))
      pulse.setAttribute('rx', (6 + 16 * k).toFixed(1)); pulse.setAttribute('ry', (3 + 8 * k).toFixed(1))
      pulse.style.opacity = (k < 1 ? 0.8 * (1 - k) : 0).toFixed(3)
    }

    if (still) {
      render(WANT)
      part.classList.add('marked')
      showDim(true)
      agent.style.opacity = '0'
    } else {
      render(2)
      showDim(false)
      pose(offIn(2), 0, { clock: 0 })
      nodes.forEach(function (n, i) {
        if (n.classList.contains('face') || n.classList.contains('hidden')) return
        n.style.setProperty('--len', Math.ceil(n.getTotalLength()) + 1)
        n.style.setProperty('--delay', (i * 0.06).toFixed(2) + 's')
      })
      part.classList.add('drawing')
      var visible = true
      new IntersectionObserver(function (es) { visible = es[0].isIntersecting }).observe(part)
      var ease = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2 }
      var span = function (c, a, b) { return ease(Math.max(0, Math.min(1, (c - a) / (b - a)))) }
      // Drawn in the first 1.6 s, your pin at 2 s, then a turn every 10 s from there: Claude Code walks in, measures
      // the wall (its dimension, M2, fails), hops down and edits it, the wall rebuilds to 3 mm and passes; it walks
      // off, and the wall goes back to 2 mm for the next turn.
      var clock = 0, last = null
      part.heroSeek = function (sec) { clock = sec * 1000 } // to look at one moment while changing it
      var frame = function (now) {
        if (last !== null && visible) clock += Math.min(now - last, 100)
        last = now
        var s = clock / 1000
        if (s > 2.4 && part.classList.contains('drawing')) {
          part.classList.remove('drawing')
          nodes.forEach(function (n) { n.style.removeProperty('--len') })
        }
        if (s > 2) part.classList.add('marked')
        var c = s < 2 ? -1 : (s - 2) % 10
        var t = 2
        if (c >= 2.7 && c < 4.1) t = 2 + span(c, 2.7, 4.1)
        else if (c >= 4.1 && c < 7.6) t = 3
        else if (c >= 7.6 && c < 8.4) t = 3 - span(c, 7.6, 8.4)
        if (visible) {
          render(t)
          showDim(c >= 1.45 && c < 7.4)
          var o = { clock: s }
          if (c < 0.5 || c >= 5.4) pose(offIn(t), 0, o)
          else if (c < 1.3) { o.walk = c; pose(mix(offIn(t), onEdge(t), span(c, 0.5, 1.3)), span(c, 0.5, 0.8), o) }
          else if (c < 1.9) { o.tap = c - 1.4; pose(onEdge(t), 1, o) }
          else if (c < 2.4) { var k = (c - 1.9) / 0.5; o.lift = Math.sin(Math.PI * k) * 22; pose(mix(onEdge(t), onBase(t), span(c, 1.9, 2.4)), 1, o) }
          else if (c < 4.4) { o.work = c - 2.4; if (c < 3.1) o.tap = c - 2.45; pose(onBase(t), 1, o) }
          else { o.walk = c; pose(mix(onBase(t), offOut(t), span(c, 4.4, 5.4)), 1 - span(c, 4.9, 5.4), o) }
        }
        requestAnimationFrame(frame)
      }
      requestAnimationFrame(frame)
    }
  }

  // The loop: four steps on a ring, the dot going round in eight seconds while the ring is in view.
  var ring = document.getElementById('ring')
  if (ring) {
    var R = 120, LAP = 8000, C = 2 * Math.PI * R
    var nodeG = ring.querySelector('.ring-nodes'), dot = ring.querySelector('.ring-dot'), trail = ring.querySelector('.ring-trail')
    var steps = document.querySelectorAll('.steps li')
    var marks = []
    for (var k = 0; k < 4; k++) {
      var ang = -Math.PI / 2 + (k * Math.PI) / 2
      var gk = el('g', {}, nodeG)
      el('circle', { cx: 160 + R * Math.cos(ang), cy: 160 + R * Math.sin(ang), r: 18 }, gk)
      var tx = el('text', { x: 160 + R * Math.cos(ang), y: 160 + R * Math.sin(ang) }, gk)
      tx.textContent = String(k + 1)
      marks.push(gk)
    }
    trail.setAttribute('stroke-dasharray', C.toFixed(1))
    var light = function (on) {
      for (var j = 0; j < 4; j++) {
        marks[j].classList.toggle('on', j === on)
        if (steps[j]) steps[j].classList.toggle('on', j === on)
      }
    }
    if (still) {
      dot.setAttribute('opacity', '0')
      trail.setAttribute('stroke-dashoffset', '0')
    } else {
      var inView = false, t0 = 0, prev = null
      new IntersectionObserver(function (es) { inView = es[0].isIntersecting }, { threshold: 0.3 }).observe(ring)
      var spin = function (now) {
        if (prev !== null && inView) t0 += Math.min(now - prev, 100)
        prev = now
        if (inView) {
          var p = (t0 % LAP) / LAP
          var a = -Math.PI / 2 + p * Math.PI * 2
          dot.setAttribute('cx', (160 + R * Math.cos(a)).toFixed(2))
          dot.setAttribute('cy', (160 + R * Math.sin(a)).toFixed(2))
          trail.setAttribute('stroke-dashoffset', (C * (1 - p)).toFixed(1))
          light(Math.floor(p * 4 + 0.08) % 4)
        }
        requestAnimationFrame(spin)
      }
      requestAnimationFrame(spin)
    }
  }

  // Sections come into view once.
  var reveals = document.querySelectorAll('.reveal')
  if (still || !('IntersectionObserver' in window)) {
    reveals.forEach(function (r) { r.classList.add('seen') })
  } else {
    var ob = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('seen'); ob.unobserve(e.target) } })
    }, { rootMargin: '0px 0px -10% 0px' })
    reveals.forEach(function (r) { ob.observe(r) })
  }
})()

// Copy button for the commands: shown only where the Clipboard API is there; else the text stays to select.
;(function () {
  var btn = document.querySelector('.copy')
  if (!btn || !navigator.clipboard || !navigator.clipboard.writeText) return
  btn.hidden = false
  btn.addEventListener('click', function () {
    var el = document.getElementById(btn.getAttribute('data-copy'))
    var done = function (t) { btn.textContent = t; setTimeout(function () { btn.textContent = 'Copy' }, 1800) }
    navigator.clipboard.writeText(el.textContent).then(function () { done('Copied') }, function () {
      var r = document.createRange(); r.selectNodeContents(el)
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r)
      done('Select and copy')
    })
  })
})()
