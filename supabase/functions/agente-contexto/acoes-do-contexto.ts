/**
 * Ações que o agente de contexto propõe (dono, 25/09 à noite: "arquivos do
 * workspace... cada um deles tivesse poder, para não precisar fazer manual").
 * Contrato comum em ../_shared/acoes-do-agente.ts: o agente lista, a equipe
 * confirma, só a confirmação executa (executar_acao_agente em index.ts).
 *
 * Alvos e operações:
 * - k1 (logo principal) e k2 (logo alternativa): trocar_logo (para = apelido
 *   i# de uma imagem que já está no acervo). A logo de antes fica guardada e
 *   o Desfazer volta para ela.
 * - r1..rN (referências ativas): arquivar_referencia (sai das referências que
 *   os agentes usam; fica guardada, dá para desfazer).
 * - i1..iN (acervo de fotos): arquivar_foto, mover_foto, marcar_foto,
 *   tirar_marca (../_shared/acoes-do-acervo.ts).
 * - w1..wN (workspace do cliente): mover, renomear, arquivar
 *   (../_shared/acoes-do-workspace.ts). Nada é apagado.
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { alvosDoAcervo, DESCRICOES_DO_ACERVO, type FotoDoAcervo, regrasDoAcervo } from "../_shared/acoes-do-acervo.ts";
import { alvosDoWorkspace, DESCRICOES_DO_WORKSPACE, type NoDoWorkspace, regrasDoWorkspace, rotuloDoDestino } from "../_shared/acoes-do-workspace.ts";

export const OPERACOES_DO_CONTEXTO = [
  "trocar_logo",
  "arquivar_referencia",
  "arquivar_foto",
  "mover_foto",
  "marcar_foto",
  "tirar_marca",
  "mover",
  "renomear",
  "arquivar",
];

export const ESQUEMA_DAS_ACOES_DO_CONTEXTO = esquemaDasAcoes(OPERACOES_DO_CONTEXTO);

export type ReferenciaDoCliente = { id: string; papel: string | null; origem: string | null; tags: string[] | null; leitura: string | null; destaque?: boolean | null };
export type KitDasLogos = { logo_path: string | null; logo_alt_path: string | null; logo_file_id?: string | null };

export type DadosDoContexto = {
  kit: KitDasLogos | null;
  referencias: ReferenciaDoCliente[];
  fotos: FotoDoAcervo[];
  nos: NoDoWorkspace[];
};

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

type AlvoLivre = Alvo & { dados: Record<string, unknown> };

/** Todos os alvos do agente de contexto, com apelidos k, r, i e w. */
export function alvosDoContexto(d: DadosDoContexto) {
  const logos: Array<AlvoComApelido<AlvoLivre>> = [
    { ref: "k1", id: "principal", titulo: "Logo principal do kit", detalhe: d.kit && (d.kit.logo_path || d.kit.logo_file_id) ? "definida" : "sem logo", dados: {} },
    { ref: "k2", id: "alternativa", titulo: "Logo alternativa do kit", detalhe: d.kit && d.kit.logo_alt_path ? "definida" : "sem logo", dados: {} },
  ];
  const referencias: Array<AlvoComApelido<AlvoLivre>> = d.referencias.slice(0, 60).map((r, i) => ({
    ref: `r${i + 1}`,
    id: r.id,
    titulo: umaLinha(r.leitura, 90) || `Referência ${i + 1}`,
    detalhe: [r.papel ? `papel ${r.papel}` : "", r.origem ? `de ${r.origem}` : "", (r.tags || []).slice(0, 4).join(", "), r.destaque ? "em destaque" : ""].filter(Boolean).join(" · "),
    dados: {},
  }));
  const fotos = alvosDoAcervo(d.fotos, 80);
  const nos = alvosDoWorkspace(d.nos, 150);
  return { logos, referencias, fotos, nos };
}

/** Regras de todas as operações do agente de contexto. */
export function regrasDoContexto(alvos: ReturnType<typeof alvosDoContexto>): Record<string, RegraDaOperacao<AlvoLivre>> {
  const fotoPorRef = new Map(alvos.fotos.map((f) => [f.ref.toLowerCase(), f]));
  const acervo = regrasDoAcervo() as unknown as Record<string, RegraDaOperacao<AlvoLivre>>;
  const workspace = regrasDoWorkspace(alvos.nos) as unknown as Record<string, RegraDaOperacao<AlvoLivre>>;
  return {
    trocar_logo: {
      rotulo: "trocar a logo por",
      alvos: ["k"],
      para: (bruto) => {
        const f = fotoPorRef.get(String(bruto ?? "").trim().toLowerCase());
        return f && f.dados.ativa ? f.id : null;
      },
    },
    arquivar_referencia: { rotulo: "arquivar", alvos: ["r"] },
    ...acervo,
    ...workspace,
  };
}

/** Proposta do agente de contexto a partir do campo `acoes`. */
export function normalizarAcoesDoContexto(bruto: unknown, d: DadosDoContexto, clientId: string, id?: string): AcaoDoAgente | null {
  const alvos = alvosDoContexto(d);
  const todos = ([] as Array<AlvoComApelido<AlvoLivre>>).concat(alvos.logos, alvos.referencias, alvos.fotos as unknown as Array<AlvoComApelido<AlvoLivre>>, alvos.nos as unknown as Array<AlvoComApelido<AlvoLivre>>);
  const fotoPorId = new Map(alvos.fotos.map((f) => [f.id, f]));
  const destino = rotuloDoDestino(alvos.nos);
  return normalizarAcaoDoAgente(bruto, todos, regrasDoContexto(alvos), {
    agente: "contexto",
    id: id || `contexto-${Date.now().toString(36)}`,
    contexto: { client_id: clientId },
    rotuloDoPara: (op, para) => (op === "trocar_logo" ? `a imagem ${fotoPorId.get(String(para))?.titulo ?? "do acervo"}` : destino(op, para)),
  });
}

/**
 * O pedido fala em mexer em logo, referência, foto ou arquivo? Só então as
 * listas entram no prompt (são grandes; conversa sobre estilo não paga por elas).
 */
export function pedeAcaoNoContexto(mensagem: string): boolean {
  return /(arquiv|apag|tir[ae]|remov|mov[ae]|mover|mude de pasta|pasta|renome|organiz|etiquet|marque|tag|troqu?e a logo|trocar a logo|logo|refer[êe]ncia|acervo|workspace)/i.test(String(mensagem || ""));
}

/** Bloco do prompt com as listas e a regra das ações. */
export function blocoDasAcoesDoContexto(d: DadosDoContexto): string {
  const a = alvosDoContexto(d);
  return [
    blocoDosAlvos("LOGOS DO KIT", a.logos),
    blocoDosAlvos("REFERÊNCIAS ATIVAS", a.referencias, "nenhuma."),
    blocoDosAlvos("ACERVO DE FOTOS", a.fotos as unknown as Array<AlvoComApelido<AlvoLivre>>, "vazio."),
    blocoDosAlvos("ARQUIVOS DO WORKSPACE DO CLIENTE", a.nos as unknown as Array<AlvoComApelido<AlvoLivre>>, "vazio."),
    regraDasAcoes({
      trocar_logo: "ref k1 (principal) ou k2 (alternativa); para com o apelido i# da imagem do acervo que vira a logo.",
      arquivar_referencia: "ref r#; tira a referência das que os agentes usam (fica guardada). para vazio.",
      arquivar_foto: DESCRICOES_DO_ACERVO.arquivar_foto,
      mover_foto: DESCRICOES_DO_ACERVO.mover_foto,
      marcar_foto: DESCRICOES_DO_ACERVO.marcar_foto,
      tirar_marca: DESCRICOES_DO_ACERVO.tirar_marca,
      mover: DESCRICOES_DO_WORKSPACE.mover,
      renomear: DESCRICOES_DO_WORKSPACE.renomear,
      arquivar: DESCRICOES_DO_WORKSPACE.arquivar,
    }),
  ].join("");
}
