/* ===== Lightbox: fullscreen image viewer with zoom =====
   Click a case image → opens fit-to-screen.
   Click / wheel / pinch → zoom; drag → pan; Esc / × / backdrop → close. */
(function () {
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('.band img'));
  if (!thumbs.length) return;

  // ----- Build overlay -----
  var lb = document.createElement('div');
  lb.className = 'lb';
  lb.setAttribute('role', 'dialog');
  lb.setAttribute('aria-modal', 'true');
  lb.setAttribute('aria-label', 'Просмотр изображения');
  lb.innerHTML =
    '<button class="lb__close" type="button" aria-label="Закрыть">' +
    '<svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">' +
    '<path d="M2 2L20 20M20 2L2 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>' +
    '</svg></button>' +
    '<img class="lb__img" alt="" draggable="false" />';
  document.body.appendChild(lb);

  var img = lb.querySelector('.lb__img');
  var closeBtn = lb.querySelector('.lb__close');
  var lastFocus = null;

  // ----- Transform state -----
  var scale = 1, tx = 0, ty = 0;
  var MIN = 1, MAX = 5;

  function apply() {
    img.style.transform = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')';
    img.classList.toggle('lb__img--zoomed', scale > 1.01);
  }

  function clampPan() {
    var w = img.offsetWidth * scale;
    var h = img.offsetHeight * scale;
    var mx = Math.max(0, (w - lb.clientWidth) / 2);
    var my = Math.max(0, (h - lb.clientHeight) / 2);
    tx = Math.min(mx, Math.max(-mx, tx));
    ty = Math.min(my, Math.max(-my, ty));
  }

  function zoomAt(px, py, next) {
    next = Math.min(MAX, Math.max(MIN, next));
    var cx = lb.clientWidth / 2;
    var cy = lb.clientHeight / 2;
    tx = px - cx - (px - cx - tx) * (next / scale);
    ty = py - cy - (py - cy - ty) * (next / scale);
    scale = next;
    if (scale <= 1.001) { scale = 1; tx = 0; ty = 0; }
    clampPan();
    apply();
  }

  function reset() {
    scale = 1; tx = 0; ty = 0;
    apply();
  }

  // ----- Open / close -----
  function open(src, alt) {
    lastFocus = document.activeElement;
    img.src = src;
    img.alt = alt || '';
    reset();
    lb.classList.add('lb--open');
    document.body.classList.add('lb-lock');
    closeBtn.focus();
  }

  function close() {
    lb.classList.remove('lb--open');
    document.body.classList.remove('lb-lock');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  thumbs.forEach(function (t) {
    t.setAttribute('tabindex', '0');
    t.setAttribute('role', 'button');
    t.addEventListener('click', function () { open(t.currentSrc || t.src, t.alt); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(t.currentSrc || t.src, t.alt);
      }
    });
  });

  closeBtn.addEventListener('click', close);
  lb.addEventListener('click', function (e) {
    if (e.target === lb) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && lb.classList.contains('lb--open')) close();
  });

  // ----- Wheel zoom (also blocks the page's inertial scroll) -----
  lb.addEventListener('wheel', function (e) {
    if (!lb.classList.contains('lb--open')) return;
    e.preventDefault();
    e.stopPropagation();
    img.classList.remove('lb__img--anim');
    var delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    zoomAt(e.clientX, e.clientY, scale * Math.exp(-delta * 0.002));
  }, { passive: false });

  // ----- Pointer: drag to pan + pinch to zoom -----
  var active = new Map();
  var movedDist = 0;
  var lastPinchDist = 0;

  img.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    img.setPointerCapture(e.pointerId);
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedDist = 0;
    if (active.size === 2) {
      var pts = Array.from(active.values());
      lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    }
  });

  img.addEventListener('pointermove', function (e) {
    if (!active.has(e.pointerId)) return;
    var prev = active.get(e.pointerId);
    var dx = e.clientX - prev.x;
    var dy = e.clientY - prev.y;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    movedDist += Math.abs(dx) + Math.abs(dy);

    if (active.size === 1) {
      if (scale > 1.01) {
        img.classList.remove('lb__img--anim');
        tx += dx;
        ty += dy;
        clampPan();
        apply();
      }
    } else if (active.size === 2) {
      var pts = Array.from(active.values());
      var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      var midX = (pts[0].x + pts[1].x) / 2;
      var midY = (pts[0].y + pts[1].y) / 2;
      if (lastPinchDist > 0) {
        img.classList.remove('lb__img--anim');
        zoomAt(midX, midY, scale * (dist / lastPinchDist));
      }
      lastPinchDist = dist;
    }
  });

  function endPointer(e) {
    active.delete(e.pointerId);
    if (active.size < 2) lastPinchDist = 0;
  }
  img.addEventListener('pointerup', endPointer);
  img.addEventListener('pointercancel', endPointer);

  // ----- Click on the image: toggle zoom (ignored after a drag) -----
  img.addEventListener('click', function (e) {
    if (movedDist > 8) return;
    img.classList.add('lb__img--anim');
    if (scale > 1.01) {
      reset();
    } else {
      zoomAt(e.clientX, e.clientY, 2.5);
    }
  });

  // Keep the pan inside bounds when the window resizes
  window.addEventListener('resize', function () {
    if (!lb.classList.contains('lb--open')) return;
    clampPan();
    apply();
  });
})();
