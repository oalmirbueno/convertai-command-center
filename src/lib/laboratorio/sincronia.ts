import type { CanvasDoLab, LigacaoDoLab, NoDoLab } from "./nos";

/**
 * Ponte Laboratório ↔ Campanhas, lado do canvas (25/10/2026, dono: "o laboratório do canvas sincronize com a área
 * campanhas ... e atualizações e movimento de ambos os lados já atualiza as duas frentes ... sempre complementando
 * e nunca substituindo").
 *
 * - A marca da ponte mora em dados.sinc = { campanha_id, chave, origem, hash }: origem 'campanha' é o nó que veio
 *   da campanha (oferta, público, fase, peça c3...); chave 'peca:<tema_id>' num nó do canvas é a peça que ele virou.
 * - mesclarCanvas junta o canvas da tela (com mudança local ainda não salva) com o canvas novo do servidor (a ponte
 *   escreveu): o que é da pessoa fica, o que veio da campanha vem do servidor e o que é novo dos dois lados entra.
 * Puro (sem React e sem rede), Safari 11: sem lookbehind, sem classe Unicode e sem grupo nomeado.
 */

export interface SincDoNo {
  campanha_id: string;
  chave: string;
  origem: "campanha" | "canvas";
  hash?: string;
}

export function sincDoNo(no: Pick<NoDoLab, "dados"> | null | undefined): SincDoNo | null {
  const s = no && no.dados ? (no.dados as Record<string, unknown>).sinc : null;
  if (!s || typeof s !== "object") return null;
  const o = s as Record<string, unknown>;
  const chave = typeof o.chave === "string" ? o.chave : "";
  if (!chave) return null;
  return {
    campanha_id: typeof o.campanha_id === "string" ? o.campanha_id : "",
    chave,
    origem: o.origem === "canvas" ? "canvas" : "campanha",
    ...(typeof o.hash === "string" ? { hash: o.hash } : {}),
  };
}

const ROTULO_DA_CHAVE: Record<string, string> = {
  oferta: "a oferta da campanha",
  publico: "o público da campanha",
  funil: "o funil e a linha do tempo da campanha",
  cliente: "o cliente da campanha",
  marca: "a marca da campanha",
  anuncio: "o anúncio ligado à campanha",
  trafego: "o tráfego da campanha",
};

/** O que o nó representa na campanha, em palavras (para o selo e o title). */
export function rotuloDaSinc(s: SincDoNo): string {
  const [tipo, resto] = s.chave.split(":");
  if (tipo === "peca") return `a peça ${resto || ""} da série da campanha`.replace(/\s+/g, " ").trim();
  if (tipo === "produto") return `o produto ${resto ? Number(resto) + 1 : ""} da campanha`.replace(/\s+/g, " ").trim();
  if (tipo === "fase") return `a fase ${resto || ""} da linha do tempo`.replace(/\s+/g, " ").trim();
  if (tipo === "stories") return `os stories ${resto || ""} da campanha`.replace(/\s+/g, " ").trim();
  return ROTULO_DA_CHAVE[tipo] || `a campanha (${s.chave})`;
}

/** O selo do nó: "da campanha" (veio de lá) ou "na campanha" (o nó do canvas já virou peça). */
export function seloDaSinc(s: SincDoNo | null): { texto: string; titulo: string } | null {
  if (!s) return null;
  if (s.origem === "campanha") return { texto: "da campanha", titulo: `Veio da campanha: ${rotuloDaSinc(s)}. Mudanças lá chegam aqui.` };
  if (s.chave.indexOf("peca:") === 0) return { texto: "na campanha", titulo: `Já está na campanha: ${rotuloDaSinc(s)}.` };
  return { texto: "na campanha", titulo: `Ligado à campanha: ${rotuloDaSinc(s)}.` };
}

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const mesmoNo = (a: NoDoLab, b: NoDoLab) => a.tipo === b.tipo && a.x === b.x && a.y === b.y && igual(a.dados, b.dados);
const chaveDaLigacao = (l: Pick<LigacaoDoLab, "de" | "para">) => `${l.de}>${l.para}`;

/**
 * Três vias: base (o último canvas que a tela recebeu do servidor), local (a tela agora) e remoto (o novo do
 * servidor). Regras:
 * - nó da campanha (sinc.origem 'campanha'): vale o do servidor (some se sumiu lá);
 * - nó da pessoa mudado aqui: vale o daqui; sem mudança aqui: vale o do servidor (a ponte pode ter marcado sinc);
 * - nó novo daqui ou novo do servidor: entra; apagado aqui: fica apagado (exceto nó da campanha que mudou lá);
 * - apagado no servidor: sai, a não ser que tenha mudado aqui;
 * - ligações: as dos dois lados, menos as apagadas de um lado sem mudança do outro e as de ponta que não existe;
 * - a vista (viewport) é a daqui.
 */
export function mesclarCanvas(base: CanvasDoLab, local: CanvasDoLab, remoto: CanvasDoLab): CanvasDoLab {
  const porId = (c: CanvasDoLab) => {
    const m: Record<string, NoDoLab> = {};
    c.nos.forEach((n) => (m[n.id] = n));
    return m;
  };
  const b = porId(base);
  const l = porId(local);
  const r = porId(remoto);
  const ordem: string[] = [];
  const pode = (id: string) => ordem.indexOf(id) < 0 && ordem.push(id);
  local.nos.forEach((n) => pode(n.id));
  remoto.nos.forEach((n) => pode(n.id));
  const nos: NoDoLab[] = [];
  ordem.forEach((id) => {
    const nb = b[id];
    const nl = l[id];
    const nr = r[id];
    const daCampanha = sincDoNo(nr || nl || nb);
    if (daCampanha && daCampanha.origem === "campanha") {
      // A posição na tela é da pessoa: o nó da campanha vem do servidor, no lugar onde ela o deixou.
      if (nr) nos.push(nl ? { ...nr, x: nl.x, y: nl.y } : nr);
      return;
    }
    if (nl && nr) {
      const mudouAqui = !nb || !mesmoNo(nb, nl);
      nos.push(mudouAqui ? { ...nl, dados: { ...nl.dados, ...(nr.dados && (nr.dados as Record<string, unknown>).sinc ? { sinc: (nr.dados as Record<string, unknown>).sinc } : {}) } } : nr);
      return;
    }
    if (nl && !nr) {
      // Novo daqui (não estava na base) ou apagado lá mas mudado aqui: fica.
      if (!nb || !mesmoNo(nb, nl)) nos.push(nl);
      return;
    }
    if (!nl && nr) {
      // Novo do servidor: entra. Apagado aqui (estava na base): fica apagado.
      if (!nb) nos.push(nr);
    }
  });
  const existe: Record<string, true> = {};
  nos.forEach((n) => (existe[n.id] = true));
  const lb: Record<string, true> = {};
  base.ligacoes.forEach((x) => (lb[chaveDaLigacao(x)] = true));
  const ll: Record<string, LigacaoDoLab> = {};
  local.ligacoes.forEach((x) => (ll[chaveDaLigacao(x)] = x));
  const lr: Record<string, LigacaoDoLab> = {};
  remoto.ligacoes.forEach((x) => (lr[chaveDaLigacao(x)] = x));
  const ligacoes: LigacaoDoLab[] = [];
  const vistas: Record<string, true> = {};
  local.ligacoes.concat(remoto.ligacoes).forEach((x) => {
    const k = chaveDaLigacao(x);
    if (vistas[k]) return;
    vistas[k] = true;
    if (!existe[x.de] || !existe[x.para]) return;
    const naBase = !!lb[k];
    // Apagada de um lado (estava na base e sumiu de um deles): fica apagada.
    if (naBase && (!ll[k] || !lr[k])) return;
    ligacoes.push(ll[k] || lr[k]);
  });
  return { nos, ligacoes, viewport: local.viewport };
}

/** Há diferença entre dois canvas (para não regravar à toa). */
export function canvasDiferente(a: CanvasDoLab, b: CanvasDoLab): boolean {
  if (a.nos.length !== b.nos.length || a.ligacoes.length !== b.ligacoes.length) return true;
  const m: Record<string, NoDoLab> = {};
  b.nos.forEach((n) => (m[n.id] = n));
  if (a.nos.some((n) => !m[n.id] || !mesmoNo(n, m[n.id]))) return true;
  const lb: Record<string, true> = {};
  b.ligacoes.forEach((x) => (lb[chaveDaLigacao(x)] = true));
  return a.ligacoes.some((x) => !lb[chaveDaLigacao(x)]);
}
