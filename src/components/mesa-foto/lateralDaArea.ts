/**
 * Abrir o agente fixo da área de trabalho de fora dele ("pedir ao diretor",
 * "pedir ao agente"). Promovido ao sistema em 26/09 (frente C):
 * `abrirLateralDaArea` agora mora em src/components/sistema/AreaDeTrabalho.tsx
 * e fala direto com a área montada (sem clicar em botão pelo DOM). Este
 * arquivo fica como ponte para as mesas que já importam daqui (Mesa Ads,
 * Mesa Publicidade).
 *
 * Para nascer recolhida, use a prop `nasceRecolhida` da AreaDeTrabalho;
 * `lateralComecaRecolhida` continua para quem ainda chama.
 */
export { abrirLateralDaArea } from "@/components/sistema/AreaDeTrabalho";

/**
 * A lateral começa recolhida numa tela que precisa da largura toda (ex.: o
 * Canvas), só na primeira vez: depois vale o que a pessoa escolheu. Mesma
 * chave que a AreaDeTrabalho lê (`area:<memoria>:recolhida`).
 */
export function lateralComecaRecolhida(memoria: string) {
  try {
    const chave = `area:${memoria}:recolhida`;
    if (window.localStorage.getItem(chave) === null) window.localStorage.setItem(chave, "1");
  } catch {
    /* sem armazenamento: começa aberta */
  }
}
