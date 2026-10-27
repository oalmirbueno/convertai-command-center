(() => {
  const gallery=document.querySelector('.creative-gallery');
  if(gallery){
    gallery.setAttribute('aria-label','Galeria de criativos Aceleriq');
    const controls=document.createElement('div');controls.className='gallery-controls';
    const previous=document.createElement('button'),next=document.createElement('button');
    for(const [button,label,text] of [[previous,'Ver criativos anteriores','←'],[next,'Ver próximos criativos','→']]){button.type='button';button.setAttribute('aria-label',label);button.textContent=text;controls.append(button);}
    const sync=()=>{previous.disabled=gallery.scrollLeft<3;next.disabled=gallery.scrollLeft+gallery.clientWidth>=gallery.scrollWidth-3;};
    const move=(direction)=>gallery.scrollBy({left:direction*gallery.clientWidth*.92,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
    previous.addEventListener('click',()=>move(-1));next.addEventListener('click',()=>move(1));gallery.addEventListener('scroll',sync,{passive:true});window.addEventListener('resize',sync);gallery.after(controls);sync();
  }
  const bar = document.querySelector('.mobile-offer');
  const hero = document.querySelector('.hero');
  const offer = document.querySelector('#acesso');
  if (!bar || !hero || !offer || !('IntersectionObserver' in window)) return;
  let heroVisible = true, offerVisible = false;
  const update = () => {
    const active = !heroVisible && !offerVisible;
    bar.classList.toggle('is-visible', active);
    bar.inert = !active;
  };
  bar.inert = true;
  new IntersectionObserver(entries => {
    for (const e of entries) {
      if (e.target === hero) heroVisible = e.isIntersecting;
      if (e.target === offer) offerVisible = e.isIntersecting;
    }
    update();
  }).observe(hero);
  new IntersectionObserver(entries => {
    offerVisible = entries[0].isIntersecting;
    update();
  }).observe(offer);
})();
