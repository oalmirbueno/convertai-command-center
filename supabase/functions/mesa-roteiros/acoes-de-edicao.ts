/**
 * Ações sem IA do agente da Mesa Roteiros (frente AG, 26/09: "eu peço, ele já
 * vai fazendo"). Completa acoes-dos-roteiros.ts (que segue com as de IA):
 *
 * - editar_texto (r#): troca um trecho do roteiro sem chamar o roteirista
 *   (título, subtítulo, objetivo, gancho escolhido, CTA, legenda). Vira versão
 *   nova; Desfazer volta a versão de antes.
 * - aprovar_roteiro (r#): rascunho para aprovado (grava o modelo do cliente,
 *   como o botão da Revisão). Desfazer volta para rascunho.
 * - marcar_gravado (r#): aprovado para gravado. Desfazer volta para aprovado.
 *
 * Sem custo e com Desfazer: pedido claro vai direto (regra 6 do contrato).
 * Sem import de Deno: o vitest lê este arquivo. Sem travessão.
 */
import type { RegraDaOperacao } from "../_shared/acoes-do-agente.ts";
import { normalizarRoteiro, type Roteiro } from "../_shared/roteiro-modelo.ts";

export const OPERACOES_DE_EDICAO = ["editar_texto", "aprovar_roteiro", "marcar_gravado", "resolver_comentario", "desarquivar_roteiro"];

/**
 * Frente AG2 (29/09): comentário da equipe no roteiro aberto vira alvo (c1..).
 * O id do alvo é "roteiro_id:comentario_id" (o executor separa e confere os
 * dois no banco); o modelo só vê o apelido.
 */
export function idDoComentario(roteiroId: string, comentarioId: string): string {
  return `${roteiroId}:${comentarioId}`;
}

export function lerIdDoComentario(alvoId: unknown): { roteiroId: string; comentarioId: string } | null {
  const s = String(alvoId == null ? "" : alvoId);
  const i = s.indexOf(":");
  if (i <= 0 || i >= s.length - 1) return null;
  return { roteiroId: s.slice(0, i), comentarioId: s.slice(i + 1) };
}

/** Campos que o agente troca por pedido, com o nome que a equipe usa. */
export const CAMPOS_DE_TEXTO: Record<string, string> = {
  titulo: "título",
  subtitulo: "subtítulo",
  objetivo: "objetivo",
  gancho: "gancho escolhido",
  cta: "CTA",
  legenda: "legenda",
};

const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** "cta: Chame no WhatsApp" -> { campo, texto }. Campo fora da lista ou texto vazio: null. */
export function lerEdicaoDeTexto(bruto: unknown): { campo: string; texto: string } | null {
  const s = String(bruto == null ? "" : bruto);
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const campo = s.slice(0, i).trim().toLowerCase();
  const texto = s.slice(i + 1).trim().slice(0, campo === "legenda" ? 2200 : 400);
  if (!Object.prototype.hasOwnProperty.call(CAMPOS_DE_TEXTO, campo) || texto.replace(/\s+/g, "").length < 2) return null;
  return { campo, texto };
}

/** O conteúdo com o trecho trocado (normalizado). Gancho: troca o texto do gancho escolhido. */
export function conteudoEditado(atual: Roteiro, campo: string, texto: string): Roteiro {
  const novo = JSON.parse(JSON.stringify(atual)) as Roteiro;
  if (campo === "gancho") {
    const i = Math.max(0, Math.min(novo.gancho_escolhido || 0, Math.max(0, novo.ganchos.length - 1)));
    if (novo.ganchos.length) novo.ganchos[i] = { ...novo.ganchos[i], texto: umaLinha(texto, 400) };
    else novo.ganchos = [{ texto: umaLinha(texto, 400), mecanismo: "", promessa: "", motivo: "" }];
  } else if (campo === "legenda") {
    novo.legenda = texto.trim().slice(0, 2200);
  } else if (campo === "titulo" || campo === "subtitulo" || campo === "objetivo" || campo === "cta") {
    (novo as Record<string, unknown>)[campo] = umaLinha(texto, 400);
  }
  return normalizarRoteiro(novo, { tipo: atual.tipo });
}

type Dados = { status?: unknown; arquivado?: unknown };
type AlvoDoRoteiro = { id: string; titulo: string; detalhe?: string | null; dados?: Dados & Record<string, unknown> };

const travaDaEdicao = (a: { dados?: Dados }) => {
  const d = a.dados || {};
  if (d.arquivado === true) return "Roteiro arquivado. Desarquive antes.";
  if (d.status === "gravado") return "Roteiro já gravado. Volte para aprovado antes de mexer.";
  return null;
};

/** Regras das três (todas diretas: sem custo e com Desfazer). */
export function regrasDeEdicao(): Record<string, RegraDaOperacao<AlvoDoRoteiro>> {
  return {
    editar_texto: {
      rotulo: "mudar no roteiro",
      alvos: ["r"],
      combina: true,
      repete: true,
      direta: true,
      para: (v) => {
        const e = lerEdicaoDeTexto(v);
        return e ? `${e.campo}: ${e.texto}` : null;
      },
      trava: (a) => travaDaEdicao(a),
    },
    aprovar_roteiro: {
      rotulo: "aprovar",
      alvos: ["r"],
      combina: true,
      direta: true,
      trava: (a) => {
        const d = a.dados || {};
        if (d.arquivado === true) return "Roteiro arquivado. Desarquive antes.";
        return d.status === "aprovado" ? "Já está aprovado." : d.status === "gravado" ? "Já foi gravado." : null;
      },
    },
    marcar_gravado: {
      rotulo: "marcar como gravado",
      alvos: ["r"],
      direta: true,
      trava: (a) => {
        const d = a.dados || {};
        if (d.arquivado === true) return "Roteiro arquivado. Desarquive antes.";
        return d.status === "gravado" ? "Já está gravado." : d.status !== "aprovado" ? "Só roteiro aprovado vai para gravado." : null;
      },
    },
    // Frente AG2: resolver comentário (c#) e desarquivar (r#), sem custo e com Desfazer.
    resolver_comentario: {
      rotulo: "resolver o comentário",
      alvos: ["c"],
      direta: true,
      trava: (a) => ((a.dados as Record<string, unknown> | undefined)?.resolvido === true ? "Este comentário já está resolvido." : null),
    },
    desarquivar_roteiro: {
      rotulo: "desarquivar",
      alvos: ["r"],
      direta: true,
      trava: (a) => ((a.dados as Record<string, unknown> | undefined)?.arquivado === true ? null : "Este roteiro não está arquivado."),
    },
  };
}

export const DESCRICOES_DE_EDICAO: Record<string, string> = {
  editar_texto: "troca um trecho do roteiro (ref r..) sem o roteirista: para = \"campo: texto novo\", campo um de titulo, subtitulo, objetivo, gancho, cta, legenda (um item por campo). Vira versão nova, sem custo.",
  aprovar_roteiro: "aprova o roteiro (ref r..), como o botão da Revisão. para vazio.",
  marcar_gravado: "marca o roteiro aprovado (ref r..) como gravado. para vazio.",
  resolver_comentario: "marca como resolvido um comentário da equipe no roteiro aberto (ref c..). Quando o pedido é \"resolva o comentário\" depois de corrigir o que ele pede, junte com editar_texto. para vazio.",
  desarquivar_roteiro: "volta um roteiro arquivado (ref r.. com detalhe \"arquivado\") para a lista. para vazio.",
};
