(() => {
  'use strict';

  const triggers = [...document.querySelectorAll('.creative-open[data-image]')];
  if (!triggers.length) return;

  const galleryTriggers = [...document.querySelectorAll('.creative-gallery .creative-open[data-image]')];
  const items = [];
  const seen = new Set();
  for (const button of [...galleryTriggers, ...triggers]) {
    const src = button.dataset.image;
    if (!src || seen.has(src)) continue;
    seen.add(src);
    const brand = button.querySelector('.creative-brand');
    const image = button.querySelector('.creative-image');
    items.push({
      src,
      title: button.dataset.title || image?.alt || 'Criativo Aceleriq',
      caption: button.dataset.caption || '',
      brandSrc: brand?.getAttribute('src') || 'assets/logo-aceleriq.png',
      brandAlt: brand?.alt || 'Aceleriq',
      brandEmbedded: button.closest('.creative-card-new') !== null
    });
  }
  if (!items.length) return;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  let dialog = document.querySelector('dialog.creative-dialog');
  if (!dialog) {
    dialog = el('dialog', 'creative-dialog');
    document.body.append(dialog);
  }
  dialog.replaceChildren();
  dialog.setAttribute('aria-label', 'Criativos Aceleriq');

  const viewer = el('div', 'creative-viewer');
  const header = el('div', 'creative-viewer-header');
  const headingGroup = el('div', 'creative-viewer-heading');
  const title = el('h2', 'creative-viewer-title');
  const caption = el('p', 'creative-viewer-caption');
  title.id = 'creative-viewer-title';
  caption.id = 'creative-viewer-caption';
  dialog.setAttribute('aria-labelledby', title.id);
  const close = el('button', 'creative-viewer-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar criativo');
  headingGroup.append(title, caption);
  header.append(headingGroup, close);

  const stage = el('div', 'creative-viewer-stage');
  const artwork = el('div', 'creative-viewer-art');
  const image = el('img', 'creative-viewer-image');
  const logo = el('img', 'creative-viewer-brand');
  image.decoding = 'async';
  logo.width = 120;
  logo.height = 48;
  artwork.append(image, logo);
  stage.append(artwork);

  const navigation = el('div', 'creative-viewer-navigation');
  navigation.setAttribute('aria-label', 'Navegar pelos criativos');
  const previous = el('button', 'creative-viewer-nav', '←');
  previous.type = 'button';
  previous.setAttribute('aria-label', 'Criativo anterior');
  const count = el('span', 'creative-viewer-count');
  count.setAttribute('aria-live', 'polite');
  count.setAttribute('aria-atomic', 'true');
  const next = el('button', 'creative-viewer-nav', '→');
  next.type = 'button';
  next.setAttribute('aria-label', 'Próximo criativo');
  navigation.append(previous, count, next);
  viewer.append(header, stage, navigation);
  dialog.append(viewer);

  let current = 0;
  let opener = null;
  let lockedScroll = null;
  let pointerStartedOutside = false;

  function render(index) {
    current = (index + items.length) % items.length;
    const item = items[current];
    image.src = item.src;
    image.alt = item.title;
    logo.src = item.brandSrc;
    logo.alt = item.brandAlt;
    logo.hidden = item.brandEmbedded;
    title.textContent = item.title;
    caption.textContent = item.caption;
    caption.hidden = !item.caption;
    if (item.caption) dialog.setAttribute('aria-describedby', caption.id);
    else dialog.removeAttribute('aria-describedby');
    count.textContent = `${current + 1} de ${items.length}`;
    previous.hidden = items.length < 2;
    next.hidden = items.length < 2;
  }

  function lockPage() {
    if (lockedScroll) return;
    const body = document.body;
    const properties = ['position', 'top', 'left', 'right', 'width', 'overflow', 'paddingRight'];
    lockedScroll = {
      x: window.scrollX,
      y: window.scrollY,
      styles: Object.fromEntries(properties.map(name => [name, body.style[name]]))
    };
    const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    const padding = parseFloat(getComputedStyle(body).paddingRight) || 0;
    Object.assign(body.style, {
      position: 'fixed',
      top: `-${lockedScroll.y}px`,
      left: '0',
      right: '0',
      width: '100%',
      overflow: 'hidden',
      paddingRight: `${padding + scrollbar}px`
    });
  }

  function unlockPage() {
    if (!lockedScroll) return;
    const saved = lockedScroll;
    lockedScroll = null;
    Object.assign(document.body.style, saved.styles);
    const root = document.documentElement;
    const behavior = root.style.scrollBehavior;
    root.style.scrollBehavior = 'auto';
    window.scrollTo(saved.x, saved.y);
    root.style.scrollBehavior = behavior;
  }

  function open(button) {
    const index = items.findIndex(item => item.src === button.dataset.image);
    if (index < 0) return;
    if (typeof dialog.showModal !== 'function') {
      window.open(items[index].src, '_blank', 'noopener,noreferrer');
      return;
    }
    opener = button;
    render(index);
    if (!dialog.open) {
      lockPage();
      dialog.showModal();
    }
    close.focus({preventScroll: true});
  }

  for (const trigger of triggers) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', event => {
      event.preventDefault();
      open(trigger);
    });
  }
  close.addEventListener('click', () => dialog.close());
  previous.addEventListener('click', () => render(current - 1));
  next.addEventListener('click', () => render(current + 1));
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); render(current - 1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); render(current + 1); }
  });
  const outside = event => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  dialog.addEventListener('pointerdown', event => {
    pointerStartedOutside = event.target === dialog && outside(event);
  });
  dialog.addEventListener('click', event => {
    if (event.target === dialog && pointerStartedOutside && outside(event)) dialog.close();
    pointerStartedOutside = false;
  });
  dialog.addEventListener('close', () => {
    unlockPage();
    if (opener?.isConnected) opener.focus({preventScroll: true});
    opener = null;
  });
})();
