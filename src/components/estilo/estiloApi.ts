import { chamarFuncao } from "@/lib/mesa/api";
import {
  CAMPOS_DAS_REGRAS,
  type CampoDaRegra,
  type GuiaDoEstilo,
  MAX_TESTES_POR_VEZ,
  ROTULOS_DAS_REGRAS,
} from "../../../supabase/functions/_shared/estilo-do-cliente";

/**
 * Tela do estilo do cliente (frente S2): tipos do que a função agente-estilo
 * devolve e as chamadas. O guia, os campos e os limites vêm do módulo puro do
 * servidor (_shared/estilo-do-cliente.ts), o mesmo que a geração usa.
 */

export { CAMPOS_DAS_REGRAS, MAX_TESTES_POR_VEZ, ROTULOS_DAS_REGRAS };
export type { CampoDaRegra, GuiaDoEstilo };

export interface ReferenciaNaTela {
  id: string;
  origem: string;
  nome: string;
  leitura?: string | null;
  url: string;
}

export interface TesteNaTela {
  id: string;
  tema: string;
  versao: number;
  custo_usd: number;
  criado_em: string;
  status: "novo" | "aprovado" | "descartado";
  arquivo_id?: string | null;
  url: string;
}

export interface VersaoNaTela {
  numero: number;
  origem: string;
  nota: string;
  criado_em: string;
  guia: GuiaDoEstilo;
}

export interface AprendizadoNaTela {
  id: string;
  tipo: "gostou" | "nao_gostou";
  texto: string;
  em: string;
}

export interface MensagemDoEstilo {
  id: string | null;
  papel: "usuario" | "agente" | "sistema";
  conteudo: string;
  anexos: any[];
  custo_usd?: number | null;
}

/** Frente AP: arte entregue que pode virar referência do estilo (só entra com o clique da equipe). */
export interface SugestaoDaEntregaNaTela {
  trabalho_id: string;
  titulo: string;
  motivo: string;
  entregue_em: string;
  url: string;
}

export interface EstadoDoEstilo {
  client_id: string;
  marca_id: string | null;
  marca_nome: string | null;
  guardado_em: "tabela" | "arquivo" | "nenhum";
  aviso: string | null;
  ativo: boolean;
  versao_atual: number;
  guia: GuiaDoEstilo | null;
  referencias: ReferenciaNaTela[];
  versoes: VersaoNaTela[];
  aprendizados: AprendizadoNaTela[];
  testes: TesteNaTela[];
  /** Frente AP: as melhores artes entregues ("sugeridas pelas entregas"); vazio sem entrega. */
  sugeridas_pelas_entregas: SugestaoDaEntregaNaTela[];
  conversa_id?: string | null;
  mensagens?: MensagemDoEstilo[];
}

export const chaveDoEstilo = (clientId: string, marcaId: string | null | undefined) => ["estilo-do-cliente", clientId, marcaId || "cliente"];
/** Só se o estilo está ligado (botão e interruptor do Estúdio). */
export const chaveDoEstiloLeve = (clientId: string, marcaId: string | null | undefined) => ["estilo-do-cliente-leve", clientId, marcaId || "cliente"];

/** Chama a função do agente de estilo com o cliente e a marca abertos. */
export function chamarEstilo<T = any>(acao: string, clientId: string, marcaId: string | null | undefined, corpo: Record<string, unknown> = {}): Promise<T> {
  return chamarFuncao<T>("agente-estilo", { ...corpo, acao, client_id: clientId, ...(marcaId ? { marca_id: marcaId } : {}) });
}

/** Estado normalizado (listas sempre listas), para a tela não quebrar com resposta parcial. */
export function normalizarEstado(d: any): EstadoDoEstilo | null {
  if (!d || typeof d !== "object" || typeof d.client_id !== "string") return null;
  const lista = (v: any) => (Array.isArray(v) ? v : []);
  return {
    client_id: d.client_id,
    marca_id: d.marca_id || null,
    marca_nome: d.marca_nome || null,
    guardado_em: d.guardado_em === "arquivo" || d.guardado_em === "tabela" ? d.guardado_em : "nenhum",
    aviso: typeof d.aviso === "string" ? d.aviso : null,
    ativo: d.ativo === true,
    versao_atual: typeof d.versao_atual === "number" ? d.versao_atual : 0,
    guia: d.guia && typeof d.guia === "object" ? (d.guia as GuiaDoEstilo) : null,
    referencias: lista(d.referencias),
    versoes: lista(d.versoes),
    aprendizados: lista(d.aprendizados),
    testes: lista(d.testes),
    sugeridas_pelas_entregas: lista(d.sugeridas_pelas_entregas).filter((x: any) => x && typeof x.trabalho_id === "string"),
    conversa_id: typeof d.conversa_id === "string" ? d.conversa_id : d.conversa_id === null ? null : undefined,
    mensagens: Array.isArray(d.mensagens)
      ? d.mensagens
          .filter((m: any) => m && (m.papel === "usuario" || m.papel === "agente" || m.papel === "sistema"))
          .map((m: any) => ({ id: m.id ? String(m.id) : null, papel: m.papel, conteudo: String(m.conteudo || ""), anexos: lista(m.anexos), custo_usd: null }))
      : undefined,
  };
}

/** O guia tem alguma coisa escrita? */
export function guiaComConteudo(g: GuiaDoEstilo | null | undefined): boolean {
  if (!g) return false;
  if (g.resumo) return true;
  for (const c of CAMPOS_DAS_REGRAS) if (g.regras && g.regras[c] && g.regras[c].length) return true;
  return false;
}

/** Guia editado na tela (um item por linha) -> guia para gravar. */
export function guiaDoFormulario(resumo: string, campos: Record<string, string>): { resumo: string; regras: Record<string, string[]> } {
  const regras: Record<string, string[]> = {};
  for (const c of CAMPOS_DAS_REGRAS) {
    regras[c] = String(campos[c] || "")
      .split("\n")
      .map((l) => l.replace(/^[-*\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, 6);
  }
  return { resumo: resumo.trim().slice(0, 600), regras };
}

// ------------------------------------------------------------------ imagens anexadas

export interface AnexoParaEnviar {
  nome: string;
  mime: string;
  base64: string;
  /** Prévia local (object URL). */
  previa: string;
}

export const MAX_ANEXOS_POR_MENSAGEM = 6;
const LADO_MAXIMO = 1600;

function lerComoDataUrl(arquivo: Blob): Promise<string> {
  return new Promise((ok, erro) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result || ""));
    r.onerror = () => erro(new Error("Não foi possível ler a imagem."));
    r.readAsDataURL(arquivo);
  });
}

/** Reduz no navegador (lado maior até 1600 px, JPEG) com <img> e canvas: funciona no Safari 11 e no Chrome 64. */
export async function prepararAnexo(arquivo: File): Promise<AnexoParaEnviar> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(arquivo.type)) throw new Error("Use PNG, JPG ou WEBP.");
  const previa = URL.createObjectURL(arquivo);
  const nome = (arquivo.name || "referencia").replace(/\.[a-z0-9]+$/i, "").slice(0, 60);
  try {
    const img = await new Promise<HTMLImageElement>((ok, erro) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => erro(new Error("imagem"));
      i.src = previa;
    });
    const escala = Math.min(1, LADO_MAXIMO / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const w = Math.max(1, Math.round((img.naturalWidth || 1) * escala));
    const h = Math.max(1, Math.round((img.naturalHeight || 1) * escala));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
    return { nome, mime: "image/jpeg", base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previa };
  } catch {
    if (arquivo.size > 4 * 1024 * 1024) throw new Error("Imagem grande demais (até 4 MB).");
    const dataUrl = await lerComoDataUrl(arquivo);
    return { nome, mime: arquivo.type, base64: dataUrl.slice(dataUrl.indexOf(",") + 1), previa };
  }
}

/** Imagens de um evento de colar ou soltar. */
export function imagensDe(lista: DataTransferItemList | FileList | null | undefined): File[] {
  const saida: File[] = [];
  if (!lista) return saida;
  for (let i = 0; i < lista.length; i++) {
    const item: any = (lista as any)[i];
    const f: File | null = item && typeof item.getAsFile === "function" ? (item.kind === "file" ? item.getAsFile() : null) : item;
    if (f && /^image\//.test(f.type)) saida.push(f);
  }
  return saida;
}
