/**
 * A PDFjs wrapper that performs lazy-rendering of PDF pages, supports scroll,
 * zoom, full screen, and basic page navigation.
 */

// Set the workerSrc. This needs to match the version used in the root page.
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.3.122/pdf.worker.min.js';

const minScale = 0.1;
const initialScale = 1;
const maxScale = 100;

function getUrlFromQuery(query) {
  return new URLSearchParams(query.slice(1)).get('pdf');
}

function loadPDF(url) {
  return pdfjsLib.getDocument({
    url,
    cMapPacked: true,
    enableXfa: true,
  }).promise;
}

function debounce(f) {
  let timeout;
  let finalArgs;
  return (...args) => {
    finalArgs = args;
    if (timeout) {
      return;
    }
    timeout = setTimeout(() => {
      f(...finalArgs);
      timeout = undefined;
    }, 150);
  };
}

function drawPage(container) {
  if (!container || container.hasRendered) {
    return;
  }
  container.hasRendered = true;
  container.promise = container.pg.draw();
  return container.promise;
}

function lazyDrawPage(ctx, pdfPage) {
  const { scale, eventBus } = ctx;
  const { pageNumber } = pdfPage;
  const container = document.createElement('div');
  container.id = `pg-${pageNumber}`;
  container.classList.add('pdfViewer', 'singlePageView', 'pdf-page');

  const view = new pdfjsViewer.PDFPageView({
    container,
    scale,
    eventBus,
    id: pageNumber,
    defaultViewport: pdfPage.getViewport({ scale }),
  });

  // Associate the actual page with the view, and draw it.
  view.setPdfPage(pdfPage);
  container.pg = view;
  container.hasRendered = false;
  container.defaultSize = pdfPage.defaultSize;

  if (pageNumber === ctx.currentPage) {
    drawPage(container);
  }

  return container;
}

function drawVisiblePages({ main }) {
  const maxTop = innerHeight + scrollY;
  const promises = [];
  for (let i = 0; i < main.children.length; ++i) {
    const el = main.children[i];
    const y = el.offsetTop;
    const bottom = y + el.offsetHeight;
    if (y > maxTop) {
      return;
    }
    if (bottom >= scrollY) {
      // We'll render the one before and after, too, to minimize flicker
      // on scroll.
      promises.push(
        drawPage(el),
        drawPage(main.children[i - 1]),
        drawPage(main.children[i + 1])
      );
    }
  }
  return Promise.all(promises);
}

async function redraw(ctx, scrollTop) {
  const { pages } = ctx;
  ctx.scrollTop = scrollTop;
  ctx.redrawCount = (ctx.redrawCount || 0) + 1;
  if (ctx.redrawCount > 1) {
    return;
  }
  const children = pages.map((pg) => lazyDrawPage(ctx, pg));
  await Promise.all(children.map((x) => x.promise));
  const redrawCount = ctx.redrawCount;
  ctx.redrawCount = 0;
  if (redrawCount > 1) {
    redraw(ctx, ctx.scrollTop);
  } else {
    ctx.appliedScale = ctx.scale;
    window.scrollTo({ top: scrollTop });
    ctx.main.replaceChildren(...children);
    drawVisiblePages(ctx);
  }
}

function attachPageBehavior(ctx) {
  const { doc, main, toolbar } = ctx;
  const txtPg = document.querySelector('.txt-pdf-page-num');
  const goToPage = (n) => {
    const { doc, main, toolbar } = ctx;
    ctx.currentPage = Math.max(1, Math.min(doc.numPages, n));
    const pageEl = main.children[ctx.currentPage - 1];
    window.scrollTo({ top: pageEl.offsetTop - toolbar.offsetHeight });
  };
  const pageInput = (e) => {
    goToPage(parseInt(txtPg.value, 10));
    e.target.focus();
  };
  txtPg.addEventListener('click', (e) => txtPg.select());
  txtPg.addEventListener('blur', pageInput);
  txtPg.addEventListener('keydown', (e) => {
    if (e.code === 'Enter') {
      pageInput(e);
    }
  });

  document.querySelectorAll('.pdf-toolbar button[data-page]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const direction = btn.dataset.page;
      goToPage(ctx.currentPage + (direction === 'prev' ? -1 : 1));
      btn.focus();
    });
  });

  document.addEventListener('scroll', (e) => {
    let i = 0;
    for (const pg of main.children) {
      ++i;
      if (
        pg.offsetTop > scrollY ||
        pg.offsetTop + pg.offsetHeight > scrollY + innerHeight / 2
      ) {
        txtPg.value = i;
        break;
      }
    }

    drawVisiblePages(ctx);
  });
}

function attachZoomBehavior(ctx) {
  const zoomDropdown = document.querySelector('.sel-pdf-zoom');
  const customOption = document.createElement('option');

  function zoom(ctx, newScale) {
    if (newScale === ctx.scale) {
      return;
    }
    const diff = newScale / ctx.appliedScale;
    ctx.scale = newScale;
    return redraw(ctx, window.scrollY * diff);
  }

  function adjustZoom(ctx) {
    const { main, scale, toolbar } = ctx;
    const value = zoomDropdown.value;
    const container = main.children[ctx.currentPage - 1];
    const toolbarHeight = toolbar.offsetHeight;
    const pageWidth = innerWidth - 16;
    const pageHeight = innerHeight - toolbarHeight - 24;
    const actualWidth = container.defaultSize.width;
    const actualHeight = container.defaultSize.height;
    const pageWidthScale = pageWidth / actualWidth;
    const pageHeightScale = pageHeight / actualHeight;
    let newScale = scale;

    if (value.endsWith('%')) {
      newScale = parseInt(value) / 100;
    } else if (value === 'actualsize') {
      newScale = 1;
    } else if (value === 'pagewidth') {
      newScale = pageWidthScale;
    } else if (value === 'pagefit') {
      newScale = Math.min(pageWidthScale, pageHeightScale);
    } else if (value === 'auto') {
      newScale = Math.min(1, pageWidthScale);
    }

    return zoom(ctx, newScale);
  }

  document
    .querySelector('.sel-pdf-zoom')
    .addEventListener('change', () => adjustZoom(ctx));
  window.addEventListener(
    'resize',
    debounce(() => adjustZoom(ctx))
  );

  ctx.toolbar.querySelectorAll('button[data-zoom]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const direction = btn.dataset.zoom;
      const factor = minScale * (direction === '-' ? -1 : 1);
      const smoothScale = Math.floor(ctx.scale * 10) / 10;
      const newScale = Math.max(
        minScale,
        Math.min(maxScale, smoothScale + factor)
      );
      const percent = `${Math.floor(newScale * 100)}%`;
      const option = Array.from(zoomDropdown.querySelectorAll('option')).find(
        (x) => x.value === percent
      );
      if (option && option !== customOption) {
        customOption.remove();
      } else {
        customOption.value = percent;
        customOption.textContent = percent;
        zoomDropdown.append(customOption);
      }
      zoomDropdown.value = percent;
      adjustZoom(ctx);
    });
  });

  return adjustZoom;
}

function attachFullScreenBehavior(ctx) {
  document
    .querySelector('.btn-pdf-toggle-fullscreen')
    .addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    });
}

async function init() {
  const doc = await loadPDF(getUrlFromQuery(location.search));
  const pages = await Promise.all(
    new Array(doc.numPages).fill(0).map((_, i) => doc.getPage(i + 1))
  );
  const ctx = {
    doc,
    pages,
    currentPage: 1,
    scale: initialScale,
    appliedScale: initialScale,
    eventBus: new pdfjsViewer.EventBus(),
    main: document.querySelector('main'),
    toolbar: document.querySelector('.pdf-toolbar'),
  };

  attachPageBehavior(ctx);
  attachFullScreenBehavior(ctx);
  const adjustZoom = attachZoomBehavior(ctx);

  document.querySelector('.pdf-page-count').textContent = pages.length;

  // Draw at scale 1
  await redraw(ctx, 0);

  // Store the actual page dimensions so we can use them for future calculations
  pages.forEach((pg, i) => {
    const container = ctx.main.children[i];
    const page = container.querySelector('.page');
    const size = {
      width: page.offsetWidth,
      height: page.offsetHeight,
    };
    pg.defaultSize = size;
    container.defaultSize = size;
  });

  // Redraw at the appropriate zoom.
  await adjustZoom(ctx);
  await drawVisiblePages(ctx);

  document.body.classList.remove('loading');

  return ctx;
}

init().catch((err) => {
  document.body.classList.add('error');
  document.querySelector(
    '.pdf-loading-description'
  ).textContent = `Failed to load PDF: ${err.message || ''}`;
});
