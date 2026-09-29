import { useEffect } from "react";

/**
 * Rolagem suave (Lenis) ligada ao GSAP ScrollTrigger, só no navegador e só
 * sem movimento reduzido. Carrega sob demanda (não pesa no primeiro quadro).
 */
export function useRolagemSuave() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let parar = () => {};
    let vivo = true;
    Promise.all([import("lenis"), import("gsap"), import("gsap/ScrollTrigger")]).then(([lenisMod, gsapMod, stMod]) => {
      if (!vivo) return;
      const gsap = gsapMod.gsap;
      const ScrollTrigger = stMod.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      const lenis = new lenisMod.default({ lerp: 0.1 });
      lenis.on("scroll", ScrollTrigger.update);
      const tique = (t: number) => lenis.raf(t * 1000);
      gsap.ticker.add(tique);
      gsap.ticker.lagSmoothing(0);
      parar = () => {
        gsap.ticker.remove(tique);
        lenis.destroy();
      };
    });
    return () => {
      vivo = false;
      parar();
    };
  }, []);
}
