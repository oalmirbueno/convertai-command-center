import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, modeloDoPapel, TAMANHOS, type ModeloIa, type ParteDaEstimativa, type Qualidade } from "@/lib/mesa/api";
import {
  planoDasOpcoes,
  quantidadeDeOpcoes,
  type ConferenciaDoTexto,
  type EscolhaDeEstilo,
  type ImpactoDaTroca,
  type OrigemDoSelo,
  type PapelDaReferencia,
  type ReferenciaDoSelo,
} from "../../../supabase/functions/_shared/selo-da-campanha";

/**
 * Selo da campanha na tela (frente SEL, 30/09). As ações moram na função
 * agente-calendario (supabase/functions/agente-calendario/selo-da-campanha.ts);
 * as regras puras (estilos, texto, lugar na arte, impacto da troca) em
 * supabase/functions/_shared/selo-da-campanha.ts, as mesmas do servidor.
 */

export interface VersaoDoSelo {
  id: string;
  campanha_id: string;
  caminho: string;
  origem: OrigemDoSelo;
  estilo: string | null;
  texto: string | null;
  conferencia: ConferenciaDoTexto | null;
  pedido: string | null;
  anterior_id: string | null;
  lote_id: string | null;
  fonte: Record<string, unknown> | null;
  modelo_id: string | null;
  custo_usd: number;
  escolhido_em: string | null;
  criado_em: string;
}

export interface SeloAntigo {
  id: string;
  campanha_id: string;
  caminho: string;
  origem: string;
  texto: string | null;
}

export interface ImpactoNaTela extends ImpactoDaTroca {
  erro?: string | null;
}

export interface EstadoDoSelo {
  campanha: { id: string; selo_id: string | null; selo_path: string | null };
  versoes: VersaoDoSelo[];
  antigos: SeloAntigo[];
  referencias: ReferenciaDoSelo[];
  texto: string;
  avisos_do_texto: string[];
  impacto: ImpactoNaTela;
}

export const chavesDoSelo = {
  estado: (clientId: string, campanhaId: string) => ["mesa", "selo-da-campanha", clientId, campanhaId] as const,
};

const acao = <T = any>(corpo: Record<string, unknown>) => chamarFuncao<T>("agente-calendario", corpo);

export const lerEstadoDoSelo = (campanhaId: string) => acao<EstadoDoSelo>({ acao: "selo_estado", campanha_id: campanhaId });

export interface PedidoDeGeracao {
  campanhaId: string;
  estilo: EscolhaDeEstilo;
  quantidade: number;
  tipo: string | null;
  modeloId: string;
  qualidade: Qualidade;
  texto: string;
  pedido: string;
}

/** Um id de lote sem crypto.randomUUID (Safari 11). */
export function novoLote(): string {
  const h = () => Math.floor((1 + Math.random()) * 0x10000).toString(16).slice(1);
  return `${h()}${h()}-${h()}-4${h().slice(1)}-${((Math.random() * 4) | 8).toString(16)}${h().slice(1)}-${h()}${h()}${h()}`;
}

/** Os corpos das N chamadas (uma opção por chamada, o mesmo lote), pelo plano das opções. */
export function corposDaGeracao(p: PedidoDeGeracao, lote: string): Record<string, unknown>[] {
  return planoDasOpcoes(p.estilo, p.tipo, p.quantidade).map((o) => ({
    acao: "selo_gerar",
    campanha_id: p.campanhaId,
    lote_id: lote,
    estilo: o.estilo,
    variacao: o.variacao,
    ...(p.modeloId ? { modelo_id: p.modeloId } : {}),
    qualidade: p.qualidade,
    ...(p.texto.trim() ? { texto: p.texto.trim() } : {}),
    ...(p.pedido.trim() ? { pedido: p.pedido.trim() } : {}),
  }));
}

export interface OpcaoGerada {
  versao: VersaoDoSelo;
  conferencia: ConferenciaDoTexto;
  avisos: string[];
  custo_usd: number;
}

export interface ResultadoDaGeracao {
  lote: string;
  opcoes: OpcaoGerada[];
  falhas: string[];
  custo_usd: number;
}

/** Gera as opções em paralelo; cada uma que chega aparece (onOpcao). A que falha vira aviso, as outras ficam. */
export async function gerarOpcoes(p: PedidoDeGeracao, onOpcao?: (o: OpcaoGerada) => void): Promise<ResultadoDaGeracao> {
  const lote = novoLote();
  const corpos = corposDaGeracao(p, lote);
  const opcoes: OpcaoGerada[] = [];
  const falhas: string[] = [];
  await Promise.all(
    corpos.map(async (corpo) => {
      try {
        const r = await acao<OpcaoGerada>(corpo);
        opcoes.push(r);
        if (onOpcao) onOpcao(r);
      } catch (e) {
        falhas.push(e instanceof Error ? e.message : "Uma opção não saiu.");
      }
    }),
  );
  if (!opcoes.length && falhas.length) throw new Error(falhas[0]);
  const custo = opcoes.reduce((s, o) => s + (Number(o.custo_usd) || 0), 0);
  return { lote, opcoes, falhas, custo_usd: Math.round(custo * 1e6) / 1e6 };
}

export const melhorarSelo = (c: { campanhaId: string; seloId: string; pedido: string; referencias: string[]; link: string; modeloId: string; qualidade: Qualidade }) =>
  acao<OpcaoGerada & { anterior: VersaoDoSelo }>({
    acao: "selo_melhorar",
    campanha_id: c.campanhaId,
    selo_id: c.seloId,
    pedido: c.pedido,
    ...(c.referencias.length ? { referencias: c.referencias } : {}),
    ...(c.link.trim() ? { link: c.link.trim() } : {}),
    ...(c.modeloId ? { modelo_id: c.modeloId } : {}),
    qualidade: c.qualidade,
  });

export const escolherSelo = (campanhaId: string, seloId: string | null) =>
  acao<{ campanha: any; anterior: { selo_id: string | null; selo_path: string | null }; impacto: ImpactoNaTela }>({ acao: "selo_escolher", campanha_id: campanhaId, selo_id: seloId });

export type SeloPronto =
  | { origem: "acervo"; imagem_id: string }
  | { origem: "arquivo"; selo_id: string }
  | { origem: "enviado"; caminho: string; nome?: string }
  | { origem: "logo" };

export const usarSeloPronto = (campanhaId: string, pronto: SeloPronto, removerFundo: boolean) =>
  acao<{ campanha: any; versao: VersaoDoSelo; anterior: { selo_id: string | null; selo_path: string | null } | null; avisos: string[]; impacto: ImpactoNaTela | null }>({
    acao: "selo_usar",
    campanha_id: campanhaId,
    ...pronto,
    remover_fundo: removerFundo,
  });

export const arquivarSelo = (campanhaId: string, seloId: string, desfazer = false) =>
  acao({ acao: "selo_arquivar", campanha_id: campanhaId, selo_id: seloId, ...(desfazer ? { desfazer: true } : {}) });

export const mudarReferencias = (c: { campanhaId: string; adicionar?: { caminho?: string; link?: string; nota?: string }[]; tirar?: string[]; papeis?: { caminho: string; papel: PapelDaReferencia }[]; pedido?: string }) =>
  acao<{ referencias: ReferenciaDoSelo[]; avisos: string[]; custo_usd: number }>({
    acao: "selo_referencias",
    campanha_id: c.campanhaId,
    ...(c.adicionar && c.adicionar.length ? { adicionar: c.adicionar } : {}),
    ...(c.tirar && c.tirar.length ? { tirar: c.tirar } : {}),
    ...(c.papeis && c.papeis.length ? { papeis: c.papeis } : {}),
    ...(c.pedido ? { pedido: c.pedido } : {}),
  });

// ------------------------------------------------------------------ envio de arquivo

export const TIPOS_DO_SELO_ENVIADO = ".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp";
export const MAX_BYTES_DO_SELO = 12 * 1024 * 1024;

/** O arquivo é um dos aceitos (PNG, SVG, JPG ou WebP)? */
export function arquivoDeSeloAceito(f: { type?: string; name?: string }): boolean {
  const t = String(f.type || "").toLowerCase();
  const n = String(f.name || "").toLowerCase();
  return ["image/png", "image/svg+xml", "image/jpeg", "image/webp"].indexOf(t) >= 0 || /\.(png|svg|jpe?g|webp)$/.test(n);
}

/**
 * Converte no navegador para PNG de até 1024 px (SVG e WebP inclusive, que a
 * função não abre), mantendo a transparência. Leve: um canvas só.
 */
export function paraPng(arquivo: File, lado = 1024): Promise<Blob> {
  return new Promise((ok, falhou) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      try {
        const w0 = img.naturalWidth || img.width || lado;
        const h0 = img.naturalHeight || img.height || lado;
        const esc = Math.min(1, lado / Math.max(w0, h0));
        const svg = /svg/i.test(arquivo.type) || /\.svg$/i.test(arquivo.name);
        // SVG sem tamanho (ou pequeno): desenha no lado cheio para não sair borrado.
        const escala = svg ? lado / Math.max(w0, h0) : esc;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(w0 * escala));
        canvas.height = Math.max(1, Math.round(h0 * escala));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("O navegador não converteu a imagem.");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        if (typeof canvas.toBlob === "function") {
          canvas.toBlob((b) => (b ? ok(b) : falhou(new Error("O navegador não converteu a imagem."))), "image/png");
        } else {
          const dados = atob(canvas.toDataURL("image/png").split(",")[1]);
          const bytes = new Uint8Array(dados.length);
          for (let i = 0; i < dados.length; i++) bytes[i] = dados.charCodeAt(i);
          ok(new Blob([bytes], { type: "image/png" }));
        }
      } catch (e) {
        URL.revokeObjectURL(url);
        falhou(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      falhou(new Error("Não foi possível abrir esta imagem."));
    };
    img.src = url;
  });
}

/** Sobe o selo (ou a referência) já em PNG na pasta da campanha e devolve o caminho. */
export async function subirImagemDoSelo(clientId: string, campanhaId: string, arquivo: File, prefixo: "envio" | "referencia"): Promise<string> {
  if (!arquivoDeSeloAceito(arquivo)) throw new Error("Só PNG, SVG, JPG ou WebP.");
  if (arquivo.size > MAX_BYTES_DO_SELO) throw new Error("Arquivo acima de 12 MB.");
  const png = await paraPng(arquivo);
  const caminho = `${clientId}/campanhas/${campanhaId}/${prefixo}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`;
  const { error } = await supabase.storage.from("mesa").upload(caminho, png, { contentType: "image/png", upsert: false });
  if (error) throw error;
  return caminho;
}

// ------------------------------------------------------------------ estimativas

const leitura = (catalogo: ModeloIa[]): ParteDaEstimativa => {
  const m = modeloDoPapel(catalogo, "leitura");
  return { modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: TAMANHOS.leituraDoCard.entrada, tokensSaida: 300 };
};

/** Gerar N opções: N imagens do modelo escolhido e N leituras do texto. */
export function partesDaGeracao(catalogo: ModeloIa[], modeloId: string, qualidade: Qualidade, quantidade: number): ParteDaEstimativa[] {
  const m = modeloDoPapel(catalogo, "imagem", modeloId);
  const n = quantidadeDeOpcoes(quantidade);
  return [{ modeloId: m ? m.id : null, tipo: "imagem", imagens: 1, qualidade, tokensEntrada: 6000, vezes: n }, { ...leitura(catalogo), vezes: n }];
}

/** Melhorar: uma edição e uma leitura. */
export const partesDoMelhorar = (catalogo: ModeloIa[], modeloId: string, qualidade: Qualidade) => partesDaGeracao(catalogo, modeloId, qualidade, 1);

/** Referências novas: uma leitura (descrição) por imagem; o Jev custa centavos. */
export const partesDasReferencias = (catalogo: ModeloIa[], n: number): ParteDaEstimativa[] => [{ ...leitura(catalogo), tokensEntrada: TAMANHOS.lerReferencia.entrada, tokensSaida: 400, vezes: Math.max(1, n) }];

/** Refazer as lâminas não aprovadas: uma imagem por lâmina, no modelo e na qualidade de cada trabalho. */
export function partesDoRefazer(catalogo: ModeloIa[], impacto: ImpactoDaTroca): ParteDaEstimativa[] {
  return impacto.refazer.map((r) => {
    const m = modeloDoPapel(catalogo, "imagem", r.modelo_imagem_id);
    return { modeloId: m ? m.id : null, tipo: "imagem" as const, imagens: 1, qualidade: r.qualidade as Qualidade, vezes: r.ordens.length };
  });
}

export const laminasARefazer = (impacto: ImpactoDaTroca | null | undefined) =>
  impacto ? impacto.refazer.reduce((s, r) => s + r.ordens.length, 0) : 0;
