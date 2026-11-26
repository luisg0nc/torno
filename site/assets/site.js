// The landing page's motion: the dot going round the loop and the sections coming into view (the hero's story is
// story.js). With motion reduced, each is drawn once, in its last state.
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
