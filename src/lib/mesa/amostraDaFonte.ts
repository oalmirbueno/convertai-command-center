/**
 * Amostra da tipografia do cliente (frente T2, 26/09/2026).
 *
 * O gerador de imagem copia letra de IMAGEM muito melhor que de nome. Para
 * cada fonte do kit (título e texto) o navegador desenha UMA prancha PNG de
 * 1600 x 900, fundo neutro: o nome da fonte pequeno, "AaBbCc 123" e uma frase
 * com acentos em caixa alta e baixa, no peso usado. A prancha vai para a pasta
 * do cliente (mesa/<cliente>/marca/<marca>/tipografia-<papel>-<id>.png) e fica
 * registrada no kit (cliente_fontes.amostra_path, sem SQL novo). O Estúdio
 * anexa essa imagem com o papel "TIPOGRAFIA DO CLIENTE".
 *
 * De onde vem a letra:
 * - o ARQUIVO da fonte no Storage (enviado pelo cliente ou o da biblioteca da
 *   agência já gravado no kit), com uma família de nome aleatório só desta
 *   amostra: a fonte de um cliente nunca se confunde com a de outro nem com a
 *   do painel;
 * - sem arquivo, o Google Fonts pelo nome (API CSS2 por <link>: a CSP do
 *   painel já libera fonts.googleapis.com em style-src e fonts.gstatic.com em
 *   font-src; nada muda na CSP).
 *
 * Safari 11 e Chrome 64: FontFace e document.fonts existem; sem FontFace, a
 * fonte entra por @font-face com data URL (data: é aceito em font-src) e a
 * espera usa document.fonts quando existe. canvas.toBlob com reserva em
 * toDataURL. Sem lookbehind e sem File.arrayBuffer.
 */
import { lerComoArrayBuffer } from "./amostraFonte";

export const LARGURA_DA_AMOSTRA = 1600;
export const ALTURA_DA_AMOSTRA = 900;
export const TEXTO_DA_AMOSTRA = "AaBbCc 123";
export const FRASE_DA_AMOSTRA = "Ação rápida: café, pão e coração à vista";
export const EXTENSOES_DE_FONTE = ["ttf", "otf", "woff", "woff2"];
const MARGEM = 80;
const FUNDO = "#F3F2EE";
const TINTA = "#151515";
const CINZA = "#6B6B6B";
const LETRA_DO_SISTEMA = '-apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PapelDaTipografia = "titulo" | "texto" | "destaque";

export const ROTULO_DO_PAPEL_DA_TIPOGRAFIA: Record<PapelDaTipografia, string> = { titulo: "Título", texto: "Texto", destaque: "Destaque" };

export function papelDaTipografia(papel: unknown): PapelDaTipografia {
  return papel === "texto" || papel === "destaque" ? papel : "titulo";
}

/** Peso desenhado pelo Google Fonts: título e destaque 700, texto 400. O arquivo já é o próprio peso. */
export function pesoDaTipografia(papel: unknown): number {
  return papelDaTipografia(papel) === "texto" ? 400 : 700;
}

/**
 * Onde a amostra fica: sempre na pasta do cliente; a marca que tem a fonte
 * (outra marca, como a CME) ganha a pasta dela. Uma amostra por fonte.
 */
export function caminhoDaAmostraDaTipografia(clientId: string, marcaId: string | null | undefined, papel: unknown, fonteId: string): string {
  const marca = marcaId && UUID.test(marcaId) ? `${marcaId}/` : "";
  const id = String(fonteId || "").replace(/[^0-9a-zA-Z]/g, "").slice(0, 8) || "fonte";
  return `${clientId}/marca/${marca}tipografia-${papelDaTipografia(papel)}-${id}.png`;
}

/** A amostra já é a da tipografia do cliente (desenhada por esta rotina, na pasta dele)? */
export function ehAmostraDaTipografia(caminho: string | null | undefined, clientId: string): boolean {
  const c = String(caminho || "");
  return !!clientId && c.indexOf(`${clientId}/marca/`) === 0 && c.indexOf("/tipografia-") > 0;
}

/** Arquivo do próprio cliente (pode sair do Storage junto com a linha). O da biblioteca nunca. */
export function arquivoDoProprioCliente(caminho: string | null | undefined, clientId: string): boolean {
  const c = String(caminho || "");
  return !!clientId && c.indexOf(`${clientId}/`) === 0 && c.indexOf("..") < 0;
}

/** Arquivo de fonte que pode ser lido para esta amostra: do cliente ou da biblioteca, com extensão de fonte. */
export function arquivoDeFonteLegivel(caminho: string | null | undefined, clientId: string): boolean {
  const c = String(caminho || "");
  if (!c || c.indexOf("..") >= 0) return false;
  if (!arquivoDoProprioCliente(c, clientId) && c.indexOf("biblioteca/") !== 0) return false;
  const ponto = c.lastIndexOf(".");
  return ponto > 0 && EXTENSOES_DE_FONTE.indexOf(c.slice(ponto + 1).toLowerCase()) >= 0;
}

/** Endereço da API CSS2 do Google Fonts (a família com "+" no lugar do espaço). */
export function urlDoGoogleFonts(familia: string, peso?: number | null): string {
  const nome = encodeURIComponent(String(familia || "").replace(/\s+/g, " ").trim()).replace(/%20/g, "+");
  return `https://fonts.googleapis.com/css2?family=${nome}${peso ? `:wght@${peso}` : ""}&display=block`;
}

// ------------------------------------------------------------ desenho

export type LinhaDaAmostra = { texto: string; px: number; y: number; letra: "fonte" | "sistema"; cor: string };

/**
 * Onde vai cada linha (puro): o rótulo pequeno no sistema e as três linhas na
 * fonte, cada uma encolhida até caber na largura útil.
 */
export function linhasDaAmostra(nome: string, papel: unknown, medir: (texto: string, px: number) => number): LinhaDaAmostra[] {
  const util = LARGURA_DA_AMOSTRA - MARGEM * 2;
  const caber = (texto: string, inicio: number) => {
    let px = inicio;
    while (px > 14 && medir(texto, px) > util) px -= 4;
    return px;
  };
  const rotulo = `${ROTULO_DO_PAPEL_DA_TIPOGRAFIA[papelDaTipografia(papel)]} · ${String(nome || "Fonte").trim()}`;
  const grande = caber(TEXTO_DA_AMOSTRA, 220);
  const frase = caber(FRASE_DA_AMOSTRA, 96);
  const alta = caber(FRASE_DA_AMOSTRA.toUpperCase(), 76);
  const linhas: LinhaDaAmostra[] = [{ texto: rotulo, px: 26, y: 60, letra: "sistema", cor: CINZA }];
  let y = 140;
  linhas.push({ texto: TEXTO_DA_AMOSTRA, px: grande, y, letra: "fonte", cor: TINTA });
  y += Math.round(grande * 1.3) + 30;
  linhas.push({ texto: FRASE_DA_AMOSTRA, px: frase, y, letra: "fonte", cor: TINTA });
  y += Math.round(frase * 1.35) + 24;
  linhas.push({ texto: FRASE_DA_AMOSTRA.toUpperCase(), px: alta, y, letra: "fonte", cor: TINTA });
  return linhas;
}

function canvasParaPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    if (typeof canvas.toBlob === "function") {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Não foi possível gerar o PNG da amostra."))), "image/png");
      return;
    }
    try {
      const url = canvas.toDataURL("image/png");
      const bin = atob(url.split(",")[1] || "");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(new Blob([bytes], { type: "image/png" }));
    } catch (e) {
      reject(e);
    }
  });
}

/** Desenha a prancha com a família já carregada e devolve o PNG. */
export async function desenharAmostra(e: { familia: string; peso: string; nome: string; papel: unknown }): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = LARGURA_DA_AMOSTRA;
  canvas.height = ALTURA_DA_AMOSTRA;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Este navegador não desenha a amostra da fonte.");
  const letraDaFonte = (px: number) => `${e.peso} ${px}px "${e.familia}", ${LETRA_DO_SISTEMA}`;
  const medir = (texto: string, px: number) => {
    ctx.font = letraDaFonte(px);
    return ctx.measureText(texto).width;
  };
  ctx.fillStyle = FUNDO;
  ctx.fillRect(0, 0, LARGURA_DA_AMOSTRA, ALTURA_DA_AMOSTRA);
  ctx.textBaseline = "top";
  for (const l of linhasDaAmostra(e.nome, e.papel, medir)) {
    ctx.font = l.letra === "sistema" ? `${l.px}px ${LETRA_DO_SISTEMA}` : letraDaFonte(l.px);
    ctx.fillStyle = l.cor;
    ctx.fillText(l.texto, MARGEM, l.y);
  }
  return canvasParaPng(canvas);
}

// ------------------------------------------------------------ fonte carregada

export type FonteCarregada = { familia: string; peso: string; liberar: () => void };

const tirar = (el: Element | null) => {
  if (el && el.parentNode) el.parentNode.removeChild(el);
};

const aleatorio = () => Math.random().toString(36).slice(2, 10);

/** A família já desenha (largura diferente da reserva monoespaçada e da serifada)? */
export function familiaDesenha(familia: string, peso: string): boolean {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const texto = `${TEXTO_DA_AMOSTRA} ção`;
  for (const reserva of ["monospace", "serif"]) {
    ctx.font = `${peso} 72px ${reserva}`;
    const base = ctx.measureText(texto).width;
    ctx.font = `${peso} 72px "${familia}", ${reserva}`;
    if (Math.abs(ctx.measureText(texto).width - base) > 0.5) return true;
  }
  return false;
}

const esperar = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Espera a família ficar pronta (document.fonts quando existe), com prazo. */
async function esperarFamilia(familia: string, peso: string, prazoMs = 8000): Promise<boolean> {
  const conjunto = (document as unknown as { fonts?: { load?: (f: string) => Promise<unknown> } }).fonts;
  if (conjunto && typeof conjunto.load === "function") {
    await Promise.race([conjunto.load(`${peso} 72px "${familia}"`).catch(() => null), esperar(prazoMs)]);
  }
  const fim = Date.now() + (conjunto && typeof conjunto.load === "function" ? 1500 : prazoMs);
  // Prazo curto de carga do recurso (não é laço de correção): confere a cada 150 ms até o fim.
  while (!familiaDesenha(familia, peso)) {
    if (Date.now() > fim) return false;
    await esperar(150);
  }
  return true;
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, i + 0x8000) as number[]);
  return btoa(bin);
}

/** A fonte do arquivo, com nome aleatório só desta amostra. */
export async function carregarFonteDoArquivo(arquivo: Blob): Promise<FonteCarregada> {
  const buffer = await lerComoArrayBuffer(arquivo);
  const familia = `t2-tipografia-${aleatorio()}`;
  const Ctor = (window as unknown as { FontFace?: new (f: string, b: ArrayBuffer) => { load: () => Promise<unknown> } }).FontFace;
  const conjunto = (document as unknown as { fonts?: { add?: (f: unknown) => void; delete?: (f: unknown) => void } }).fonts;
  if (Ctor && conjunto && typeof conjunto.add === "function") {
    const face = new Ctor(familia, buffer);
    await face.load();
    conjunto.add(face);
    return {
      familia,
      peso: "normal",
      liberar: () => {
        try {
          if (conjunto.delete) conjunto.delete(face);
        } catch {
          /* fica até fechar a aba */
        }
      },
    };
  }
  // Sem FontFace: @font-face por CSS com data URL.
  const estilo = document.createElement("style");
  estilo.textContent = `@font-face{font-family:"${familia}";src:url(data:application/octet-stream;base64,${base64(buffer)});}`;
  document.head.appendChild(estilo);
  if (!(await esperarFamilia(familia, "normal"))) {
    tirar(estilo);
    throw new Error("Este navegador não carregou o arquivo da fonte.");
  }
  return { familia, peso: "normal", liberar: () => tirar(estilo) };
}

/** A fonte do Google Fonts pelo nome: primeiro no peso do papel, depois no peso padrão da família. */
export async function carregarFonteDoGoogle(familia: string, peso: number): Promise<FonteCarregada> {
  const nome = String(familia || "").replace(/\s+/g, " ").trim().replace(/"/g, "");
  if (!nome) throw new Error("Fonte sem nome.");
  for (const p of [peso, null]) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = urlDoGoogleFonts(nome, p);
    const carregou = await new Promise<boolean>((resolve) => {
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      setTimeout(() => resolve(false), 10_000);
      document.head.appendChild(link);
    });
    const pesoCss = p ? String(p) : "normal";
    if (carregou && (await esperarFamilia(nome, pesoCss))) return { familia: nome, peso: pesoCss, liberar: () => tirar(link) };
    tirar(link);
  }
  throw new Error(`A fonte ${nome} não está no Google Fonts. Envie o arquivo da fonte.`);
}

// ------------------------------------------------------------ gerar e gravar

export type FonteParaAmostra = {
  id: string;
  nome: string;
  papel: string;
  storage_path?: string | null;
  amostra_path?: string | null;
  marca_id?: string | null;
};

export type DependenciasDaAmostra = {
  baixar: (caminho: string) => Promise<Blob>;
  enviar: (caminho: string, png: Blob) => Promise<void>;
  registrar: (fonteId: string, caminho: string) => Promise<void>;
  remover?: (caminhos: string[]) => Promise<void>;
  /** Trocáveis nos testes (o jsdom não tem canvas). */
  carregarArquivo?: (arquivo: Blob) => Promise<FonteCarregada>;
  carregarGoogle?: (familia: string, peso: number) => Promise<FonteCarregada>;
  desenhar?: (e: { familia: string; peso: string; nome: string; papel: unknown }) => Promise<Blob>;
};

/**
 * Gera e grava a amostra de uma fonte do kit deste cliente. Lê só arquivo do
 * próprio cliente ou da biblioteca; sem arquivo legível, o Google Fonts pelo
 * nome. A amostra antiga do cliente sai do Storage (a da biblioteca, nunca).
 */
export async function gerarAmostraDaTipografia(
  clientId: string,
  fonte: FonteParaAmostra,
  deps: DependenciasDaAmostra,
): Promise<{ caminho: string; origem: "arquivo" | "google" }> {
  if (!clientId || !fonte || !fonte.id || !String(fonte.nome || "").trim()) throw new Error("Fonte sem nome.");
  const carregarArquivo = deps.carregarArquivo || carregarFonteDoArquivo;
  const carregarGoogle = deps.carregarGoogle || carregarFonteDoGoogle;
  const desenhar = deps.desenhar || desenharAmostra;
  let carregada: FonteCarregada | null = null;
  let origem: "arquivo" | "google" = "arquivo";
  if (arquivoDeFonteLegivel(fonte.storage_path, clientId)) {
    try {
      carregada = await carregarArquivo(await deps.baixar(String(fonte.storage_path)));
    } catch {
      carregada = null;
    }
  }
  if (!carregada) {
    origem = "google";
    carregada = await carregarGoogle(fonte.nome, pesoDaTipografia(fonte.papel));
  }
  let png: Blob;
  try {
    png = await desenhar({ familia: carregada.familia, peso: carregada.peso, nome: fonte.nome, papel: fonte.papel });
  } finally {
    carregada.liberar();
  }
  const caminho = caminhoDaAmostraDaTipografia(clientId, fonte.marca_id, fonte.papel, fonte.id);
  await deps.enviar(caminho, png);
  await deps.registrar(fonte.id, caminho);
  const antiga = fonte.amostra_path ? String(fonte.amostra_path) : "";
  if (antiga && antiga !== caminho && arquivoDoProprioCliente(antiga, clientId) && deps.remover) {
    await deps.remover([antiga]).catch(() => undefined);
  }
  return { caminho, origem };
}

/** Todas as fontes do kit, uma de cada vez (o navegador desenha uma prancha por vez). */
export async function gerarAmostrasDaTipografia(
  clientId: string,
  fontes: FonteParaAmostra[],
  deps: DependenciasDaAmostra,
): Promise<{ feitas: number; falhas: { nome: string; erro: string }[] }> {
  let feitas = 0;
  const falhas: { nome: string; erro: string }[] = [];
  for (const f of fontes) {
    try {
      await gerarAmostraDaTipografia(clientId, f, deps);
      feitas++;
    } catch (e) {
      falhas.push({ nome: f.nome, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return { feitas, falhas };
}
