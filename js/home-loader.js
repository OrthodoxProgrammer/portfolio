(function () {
  var root = document.documentElement;
  var storageKey = 'portfolio:home-loaded';

  // This script runs in the head, before CSS or the loader can be painted.
  try {
    if (sessionStorage.getItem(storageKey) === '1') {
      root.classList.add('home-ready');
      return;
    }
  } catch (error) {
    // Storage can be unavailable; loading the page must still work.
  }
  root.classList.add('home-loading');
  // Run the minimum display time alongside loading, not after it.
  var minimumDuration = new Promise(function (resolve) {
    setTimeout(resolve, 2000);
  });

  function imageReady(image) {
    // Wait for decoding too, so downloaded images are ready to be displayed.
    if (typeof image.decode === 'function') return image.decode();
    if (image.complete) return Promise.resolve();
    return new Promise(function (resolve) {
      function settled() {
        image.removeEventListener('load', settled);
        image.removeEventListener('error', settled);
        resolve();
      }
      image.addEventListener('load', settled);
      image.addEventListener('error', settled);
    });
  }

  function waitForContent() {
    var loader = document.getElementById('loader');
    var percent = document.getElementById('pct');
    var images = Array.prototype.filter.call(document.images, function (image) {
      // The modal placeholder has no source until a case is selected.
      return image.currentSrc || image.getAttribute('src') || image.getAttribute('srcset');
    });
    var resources = images.map(imageReady);
    // DOMContentLoaded follows the page's blocking stylesheets and scripts.
    // Analytics is intentionally not a dependency of the visible content.
    resources.push(Promise.resolve());
    resources.push(document.fonts ? document.fonts.ready : Promise.resolve());
    var settled = 0;

    var displayed = 0;
    var ready = false;
    var previousFrame = performance.now();

    function finishLoading() {
      try {
        sessionStorage.setItem(storageKey, '1');
      } catch (error) {
        // The current page can still finish without persistent session state.
      }
      root.classList.remove('home-loading');
      root.classList.add('home-ready');
      document.dispatchEvent(new Event('home:ready'));
    }

    function animateProgress(timestamp) {
      // About 50 percentage points per second, at most one point per frame.
      // Do not skip numbers after a slow frame or returning to a background tab.
      var elapsed = Math.min(20, Math.max(0, timestamp - previousFrame));
      previousFrame = timestamp;
      var target = ready ? 100 : Math.min(99, Math.floor(settled / resources.length * 100));
      displayed = Math.min(target, displayed + elapsed * 0.05);
      var value = Math.floor(displayed);
      if (percent) percent.textContent = value;
      if (loader) loader.setAttribute('aria-valuenow', String(value));
      if (ready && displayed >= 100) {
        finishLoading();
      } else {
        requestAnimationFrame(animateProgress);
      }
    }

    var contentReady = Promise.all(resources.map(function (resource) {
      // A missing image or font must not leave the whole site behind a loader.
      return resource.then(function () { settled += 1; }, function () { settled += 1; });
    }));
    Promise.all([contentReady, minimumDuration]).then(function () {
      ready = true;
    });
    requestAnimationFrame(animateProgress);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForContent, { once: true });
  } else {
    waitForContent();
  }
})();
