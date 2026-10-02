/**
 * Vitrine de logos na arte (02/10): as logos dos parceiros coladas pelo
 * código, depois da geração, numa grade (modulos/vitrine-de-logos.ts), como
 * o selo da campanha. Cada logo vai inteira, sem ser redesenhada, num cartão
 * branco de cantos arredondados, centralizada. Nenhum texto é desenhado aqui:
 * o título e o resto da lâmina continuam saindo do gerador.
 *
 * Só a função usa (abre pixel): a tela e os testes leem as contas puras em
 * vitrine-de-logos.ts.
 */
import { caixaNoQuadroCentral, decodificar, imagescript } from "../../_shared/imagem-sob-demanda.ts";
import { type Area, celulasDaGrade, type LogoDaVitrine } from "./vitrine-de-logos.ts";

export interface ResultadoDaVitrine {
  png: Uint8Array;
  coladas: number;
  falharam: string[];
}

/**
 * Abre a arte uma vez, põe cada logo na sua célula e grava uma vez. A logo
 * que não abre fica de fora (o nome vai em `falharam`) e nunca derruba a
 * versão. `abrir` devolve os bytes leves da logo (quem chama confere a pasta).
 */
export async function colarLogosNaGrade(
  png: Uint8Array,
  vitrine: { area: Area; logos: LogoDaVitrine[]; proporcao: number },
  abrir: (logo: LogoDaVitrine) => Promise<Uint8Array>,
  aoFalhar: (logo: LogoDaVitrine, erro: unknown) => void = () => {},
): Promise<ResultadoDaVitrine> {
  const { Image } = await imagescript();
  const arte = await decodificar(png);
  const W = arte.width, H = arte.height;
  const area = caixaNoQuadroCentral(vitrine.area, W, H, vitrine.proporcao);
  const celulas = celulasDaGrade(vitrine.logos.length, area);
  const falharam: string[] = [];
  let coladas = 0;
  for (let i = 0; i < vitrine.logos.length; i++) {
    const l = vitrine.logos[i];
    const c = celulas[i];
    if (!c) continue;
    try {
      const logo = await decodificar(await abrir(l));
      const x0 = Math.round(c.x0 * W), y0 = Math.round(c.y0 * H);
      const cw = Math.max(16, Math.round((c.x1 - c.x0) * W)), ch = Math.max(16, Math.round((c.y1 - c.y0) * H));
      const cartao = new Image(cw, ch);
      cartao.fill(0xffffffff);
      cartao.roundCorners(Math.round(Math.min(cw, ch) * 0.08));
      arte.composite(cartao, x0, y0);
      const esc = Math.min((cw * 0.76) / logo.width, (ch * 0.7) / logo.height);
      const lw = Math.max(1, Math.round(logo.width * esc)), lh = Math.max(1, Math.round(logo.height * esc));
      logo.resize(lw, lh);
      arte.composite(logo, x0 + Math.round((cw - lw) / 2), y0 + Math.round((ch - lh) / 2));
      coladas++;
    } catch (e) {
      aoFalhar(l, e);
      falharam.push(l.nome || `logo ${i + 1}`);
    }
  }
  return { png: await arte.encode(1), coladas, falharam };
}
