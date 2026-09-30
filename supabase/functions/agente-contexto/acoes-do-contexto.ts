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
 * - x1 (referências sem leitura): ler_referencias, com custo (IA lê as
 *   imagens), pede Confirmar. A leitura só soma: sem Desfazer.
 * - x2 (contexto consolidado): montar_contexto, com custo, pede Confirmar.
 *   O kit de antes (contexto, paleta, estilo, regras) fica guardado e o
 *   Desfazer volta para ele (29/09: "ler pendentes, montar e atualizar").
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type Alvo,
  type AlvoComApelido,
  blocoDosAlvos,
  type CaminhoDoAgente,
  esquemaDasAcoes,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { caminhoNaArea } from "../_shared/mapa-do-painel.ts";
import { alvosDoAcervo, DESCRICOES_DO_ACERVO, type FotoDoAcervo, regrasDoAcervo } from "../_shared/acoes-do-acervo.ts";
import { alvosDoWorkspace, DESCRICOES_DO_WORKSPACE, type NoDoWorkspace, regrasDoWorkspace, rotuloDoDestino } from "./modulos/acoes-do-workspace.ts";

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
  "ler_referencias",
  "montar_contexto",
];

/** Operações com custo de IA: nunca vão direto, o cartão mostra o custo e pede Confirmar. */
export const OPERACOES_COM_CUSTO_DO_CONTEXTO = ["ler_referencias", "montar_contexto"];

/** Custo estimado em US$ (medido em ia_usos, 29/09: leitura até US$ 0,005 por imagem; montagem até US$ 0,02). */
export function custoEstimadoDoContexto(itens: Array<{ operacao: string }>, pendentes: number): number {
  let custo = 0;
  for (const i of itens) {
    if (i.operacao === "ler_referencias") custo += Math.max(1, Math.min(12, pendentes || 0)) * 0.005;
    if (i.operacao === "montar_contexto") custo += 0.02 + Math.max(0, Math.min(12, pendentes || 0)) * 0.005;
  }
  return Math.round(custo * 10000) / 10000;
}

export const ESQUEMA_DAS_ACOES_DO_CONTEXTO = esquemaDasAcoes(OPERACOES_DO_CONTEXTO);

export type ReferenciaDoCliente = { id: string; papel: string | null; origem: string | null; tags: string[] | null; leitura: string | null; destaque?: boolean | null };
export type KitDasLogos = { logo_path: string | null; logo_alt_path: string | null; logo_file_id?: string | null };

export type DadosDoContexto = {
  kit: KitDasLogos | null;
  referencias: ReferenciaDoCliente[];
  fotos: FotoDoAcervo[];
  nos: NoDoWorkspace[];
  /** Referências ativas ainda sem leitura (x1). */
  pendentes?: number;
  /** Quando o contexto foi montado pela última vez (x2); null: nunca. */
  montado_em?: string | null;
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
  const pendentes = Math.max(0, Number(d.pendentes) || 0);
  const montado = d.montado_em && /^\d{4}-\d{2}-\d{2}/.test(d.montado_em) ? `montado em ${d.montado_em.slice(8, 10)}/${d.montado_em.slice(5, 7)}` : "nunca montado";
  const tarefas: Array<AlvoComApelido<AlvoLivre>> = [
    { ref: "x1", id: "referencias_pendentes", titulo: "Referências sem leitura", detalhe: pendentes ? `${pendentes} ${pendentes === 1 ? "pendente" : "pendentes"} (lê até 12 por vez)` : "nenhuma pendente", dados: { pendentes } },
    { ref: "x2", id: "contexto_consolidado", titulo: "Contexto consolidado da marca", detalhe: montado, dados: {} },
  ];
  return { logos, referencias, fotos, nos, tarefas };
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
    ler_referencias: {
      rotulo: "ler",
      alvos: ["x"],
      trava: (alvo) => (alvo.id !== "referencias_pendentes" ? "Só as referências pendentes podem ser lidas." : Number((alvo.dados || {}).pendentes) > 0 ? null : "Nenhuma referência pendente de leitura."),
    },
    montar_contexto: {
      rotulo: "montar de novo",
      alvos: ["x"],
      trava: (alvo) => (alvo.id !== "contexto_consolidado" ? "Só o contexto consolidado pode ser montado." : null),
    },
    ...acervo,
    ...workspace,
  };
}

/** Proposta do agente de contexto a partir do campo `acoes`. */
export function normalizarAcoesDoContexto(bruto: unknown, d: DadosDoContexto, clientId: string, id?: string): AcaoDoAgente | null {
  const alvos = alvosDoContexto(d);
  const todos = ([] as Array<AlvoComApelido<AlvoLivre>>).concat(alvos.logos, alvos.referencias, alvos.fotos as unknown as Array<AlvoComApelido<AlvoLivre>>, alvos.nos as unknown as Array<AlvoComApelido<AlvoLivre>>, alvos.tarefas);
  const fotoPorId = new Map(alvos.fotos.map((f) => [f.id, f]));
  const destino = rotuloDoDestino(alvos.nos);
  const acao = normalizarAcaoDoAgente(bruto, todos, regrasDoContexto(alvos), {
    agente: "contexto",
    id: id || `contexto-${Date.now().toString(36)}`,
    contexto: { client_id: clientId },
    rotuloDoPara: (op, para) => (op === "trocar_logo" ? `a imagem ${fotoPorId.get(String(para))?.titulo ?? "do acervo"}` : destino(op, para)),
    // Ler referências só soma leitura: sem nada para voltar quando é a única coisa da lista.
    semDesfazer: (itens) => itens.length > 0 && itens.every((i) => i.operacao === "ler_referencias"),
  });
  // Com IA no meio: o custo aparece no cartão antes do Confirmar (nunca vai direto).
  if (acao && acao.itens.some((i) => OPERACOES_COM_CUSTO_DO_CONTEXTO.indexOf(i.operacao) >= 0)) {
    acao.custo_estimado_usd = custoEstimadoDoContexto(acao.itens, Number(d.pendentes) || 0);
  }
  return acao;
}

/**
 * O pedido fala em mexer em logo, referência, foto ou arquivo? Só então as
 * listas entram no prompt (são grandes; conversa sobre estilo não paga por elas).
 */
export function pedeAcaoNoContexto(mensagem: string): boolean {
  return /(arquiv|apag|tir[ae]|remov|mov[ae]|mover|mude de pasta|pasta|renome|organiz|etiquet|marque|tag|troqu?e a logo|trocar a logo|logo|refer[êe]ncia|acervo|workspace|foto|imagem|imagens|pendente|leia|ler |l[êe] as|mont[ae]|remont|atualiz[ae] o contexto|refa[çc]a o contexto|consolid)/i.test(String(mensagem || ""));
}

/** Bloco do prompt com as listas e a regra das ações. */
export function blocoDasAcoesDoContexto(d: DadosDoContexto): string {
  const a = alvosDoContexto(d);
  return [
    blocoDosAlvos("LOGOS DO KIT", a.logos),
    blocoDosAlvos("REFERÊNCIAS ATIVAS", a.referencias, "nenhuma."),
    blocoDosAlvos("ACERVO DE FOTOS", a.fotos as unknown as Array<AlvoComApelido<AlvoLivre>>, "vazio."),
    blocoDosAlvos("ARQUIVOS DO WORKSPACE DO CLIENTE", a.nos as unknown as Array<AlvoComApelido<AlvoLivre>>, "vazio."),
    blocoDosAlvos("TAREFAS DO CONTEXTO", a.tarefas),
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
      ler_referencias: "ref x1; lê com IA as referências pendentes (até 12 por vez), com custo. para vazio.",
      montar_contexto: "ref x2; monta de novo o contexto da marca a partir dos documentos, dossiê e artes (atualizar), com custo; o kit de antes fica guardado para Desfazer. para vazio.",
    }),
  ].join("");
}

const OPERACOES_DO_ACERVO_NO_CONTEXTO = ["arquivar_foto", "mover_foto", "marcar_foto", "tirar_marca"];
const OPERACOES_DO_WORKSPACE_NO_CONTEXTO = ["mover", "renomear", "arquivar"];
const OPERACOES_DE_TAREFA = ["criar_tarefa", "atualizar_tarefa"];
const OPERACOES_DE_PROJETO = ["criar_projeto", "atualizar_projeto", "criar_marco"];

/**
 * O "Ir para" do agente de contexto (dono, 27/09: "quando termina ele dá o
 * caminho pra mim apertar e ir e já fica tudo certinho"). Conta só o que deu
 * certo (antes de fazer, o que foi pedido), pela ordem do que mais importa:
 * - tarefa: uma só abre o detalhe dela no Kanban (task=); várias ou projeto
 *   abrem o Kanban no projeto (project=);
 * - acervo: a Mesa Foto no acervo (com a foto aberta quando é uma só e não foi arquivada);
 * - workspace: o Workspace do cliente;
 * - kit, contexto, logo, referências, decisões, caminho, brand book: a aba Contexto da Mesa.
 */
export function caminhoDoContexto(clientId: string, acao: Pick<AcaoDoAgente, "itens" | "resultados">, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  const feitos = acao.resultados && acao.resultados.length ? acao.resultados.filter((r) => r.ok) : null;
  const tarefas: string[] = [];
  const projetos: string[] = [];
  const fotos: string[] = [];
  let arquivouFoto = false;
  let workspace = false;
  let kit = false;
  for (const i of acao.itens) {
    const r = feitos ? feitos.find((x) => x.ref === i.ref && x.operacao === i.operacao) : null;
    if (feitos && !r) continue;
    const d = (r && r.desfazer) || {};
    if (OPERACOES_DE_TAREFA.indexOf(i.operacao) >= 0) {
      const id = i.operacao === "criar_tarefa" ? String(d.tarefa_id || "") : i.alvo_id;
      if (id && tarefas.indexOf(id) < 0) tarefas.push(id);
    } else if (OPERACOES_DE_PROJETO.indexOf(i.operacao) >= 0) {
      const id = i.operacao === "criar_projeto" ? String(d.projeto_id || "") : i.operacao === "atualizar_projeto" ? i.alvo_id : "";
      if (id && projetos.indexOf(id) < 0) projetos.push(id);
    } else if (OPERACOES_DO_ACERVO_NO_CONTEXTO.indexOf(i.operacao) >= 0) {
      if (i.operacao === "arquivar_foto") arquivouFoto = true;
      else if (fotos.indexOf(i.alvo_id) < 0) fotos.push(i.alvo_id);
    } else if (OPERACOES_DO_WORKSPACE_NO_CONTEXTO.indexOf(i.operacao) >= 0) {
      workspace = true;
    } else {
      kit = true;
    }
  }
  const base = { clientId, abrirSozinho: opcoes.abrirSozinho };
  if (tarefas.length === 1) return caminhoNaArea("kanban", { ...base, estado: { task: tarefas[0] }, rotulo: "Abrir a tarefa no Kanban" });
  if (tarefas.length > 1 || projetos.length) {
    return caminhoNaArea("kanban", { ...base, estado: projetos.length === 1 ? { project: projetos[0] } : {}, rotulo: tarefas.length > 1 ? `Ver as ${tarefas.length} tarefas no Kanban` : "Ver o projeto no Kanban" });
  }
  if (fotos.length || arquivouFoto) {
    return caminhoNaArea("mesa_foto", { ...base, etapa: "acervo", estado: fotos.length === 1 && !arquivouFoto ? { imagem: fotos[0] } : {}, rotulo: "Ver no acervo da Mesa Foto" });
  }
  if (workspace) return caminhoNaArea("workspace", { ...base, rotulo: "Abrir o Workspace do cliente" });
  if (kit) return caminhoNaArea("mesa", { ...base, etapa: "contexto", rotulo: "Ver o kit da marca" });
  return null;
}
