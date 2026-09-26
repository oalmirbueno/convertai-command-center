/**
 * Contrato comum das ações que um agente do painel PROPÕE e a equipe CONFIRMA
 * (dono, 25/09: "se eu pedir para o agente, ele confirma comigo, vai lá e faz
 * tudo certinho"). Generaliza o que o agente do mês faz na agenda
 * (agente-calendario/acoes-agenda.ts, que continua com o seu):
 *
 * 1. Cada alvo que o agente pode tocar (lâmina, trabalho, arquivo, foto...)
 *    ganha um apelido curto (l1, t1, f1...). O agente nunca vê nem devolve
 *    UUID: modelo que transcreve UUID troca caracteres (memória "agente
 *    transpõe UUID"). Apelido inventado ou repetido vai para `ignorados`.
 * 2. A resposta do agente leva um anexo `acao_agente` com a lista exata do que
 *    vai acontecer, item por item. Nada é feito na hora.
 * 3. Só a confirmação da equipe (executar_acao_agente na função do agente)
 *    executa. Cada item responde por si: o que não pôde volta com o motivo.
 * 4. Travas por operação (aprovação do cliente, publicação agendada ou no ar,
 *    arquivo original) recusam o item já na proposta, com o motivo.
 * 5. Quando há reverso, cada item guarda o que precisa para Desfazer.
 *    Apagar é sempre arquivar (lixeira), nunca exclusão definitiva.
 *
 * Sem import de Deno nem de npm: a tela e os testes (vitest) leem o mesmo arquivo.
 */

export const TIPO_DA_ACAO = "acao_agente";

/** Máximo de alvos listados para o agente e de itens num pedido só. */
export const MAX_ALVOS_PARA_O_AGENTE = 150;
export const MAX_ITENS_POR_ACAO = 120;

/** Alvo que o agente pode tocar: id real (nunca vai para o modelo), título e um detalhe curto. */
export type Alvo = { id: string; titulo: string; detalhe?: string | null; dados?: Record<string, unknown> };
export type AlvoComApelido<A extends Alvo = Alvo> = A & { ref: string };

export type ValorPara = string | number | null;

/**
 * Regra de uma operação: o que ela exige em `para` e o que a trava.
 * - para: normaliza o valor pedido; null recusa o item (vai para ignorados).
 *   Sem `para`, a operação não leva valor.
 * - trava: motivo em português quando o alvo não pode sofrer a operação
 *   (vai para recusados, com o motivo, e não entra na lista).
 */
export type RegraDaOperacao<A extends Alvo = Alvo> = {
  rotulo: string;
  para?: (bruto: unknown, alvo: AlvoComApelido<A>) => ValorPara | undefined;
  trava?: (alvo: AlvoComApelido<A>, para: ValorPara) => string | null;
  /** O mesmo alvo pode aparecer nesta operação e em outra (ex.: renomear e mover). */
  combina?: boolean;
  /** Prefixos de apelido que a operação aceita (ex.: ["l"] só lâminas). Sem ele, qualquer alvo. */
  alvos?: string[];
};

/** O apelido é de um destes prefixos (p1, p2... com p na lista)? */
export function apelidoDoTipo(ref: string, prefixos: string[]): boolean {
  const m = /^([a-z]+)\d+$/.exec(String(ref || "").toLowerCase());
  return !!m && prefixos.indexOf(m[1]) >= 0;
}

export type ItemDaAcaoDoAgente = {
  ref: string;
  alvo_id: string;
  titulo: string;
  detalhe: string | null;
  operacao: string;
  rotulo: string;
  para: ValorPara;
  /** Texto de exibição do "para" (ex.: nome da pasta), quando difere do valor. */
  para_rotulo?: string | null;
};

export type RecusaDoItem = { ref: string; titulo: string; operacao: string; motivo: string };

export type ResultadoDoItem = {
  ref: string;
  alvo_id: string;
  titulo: string;
  operacao: string;
  ok: boolean;
  motivo?: string;
  /** O que o Desfazer precisa (valor de antes, id da versão arquivada...). Ausente: sem reverso. */
  desfazer?: Record<string, unknown> | null;
};

export type AcaoDoAgente = {
  tipo: typeof TIPO_DA_ACAO;
  /** Quem propôs: "estudio", "workspace", "contexto", "foto", "canvas"... */
  agente: string;
  /** Identificador desta proposta dentro da mensagem (mais de uma por mensagem). */
  id: string;
  resumo: string;
  itens: ItemDaAcaoDoAgente[];
  ignorados: string[];
  recusados: RecusaDoItem[];
  /** Contexto que o executor precisa (ex.: trabalho_id do carrossel). */
  contexto?: Record<string, unknown>;
  /** Operações sem reverso (ex.: gerar de novo com IA): a tela avisa antes. */
  sem_desfazer?: boolean;
  /** Custo estimado em US$, mostrado antes da confirmação (0 ou ausente: sem custo). */
  custo_estimado_usd?: number | null;
  executada_em?: string | null;
  executada_por?: string | null;
  resultados?: ResultadoDoItem[];
  descartada_em?: string | null;
  desfeita_em?: string | null;
  desfeita_por?: string | null;
};

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Apelidos p1..pN na ordem recebida (quem chama ordena antes). */
export function comApelido<A extends Alvo>(alvos: A[], prefixo: string, max = MAX_ALVOS_PARA_O_AGENTE): Array<AlvoComApelido<A>> {
  const p = String(prefixo || "x").toLowerCase().replace(/[^a-z]/g, "") || "x";
  return alvos.slice(0, max).map((a, i) => ({ ...a, ref: `${p}${i + 1}` }));
}

/** Bloco do prompt com os alvos, um por linha: apelido | título | detalhe. Nunca leva o id. */
export function blocoDosAlvos(titulo: string, alvos: AlvoComApelido[], vazio = "nenhum."): string {
  if (!alvos.length) return `\n${titulo}: ${vazio}\n`;
  const linhas = alvos.map((a) => [a.ref, umaLinha(a.titulo || "sem título", 140), umaLinha(a.detalhe, 160)].filter(Boolean).join(" | "));
  return `\n${titulo} (apelido | título | detalhe). Use só estes apelidos em acoes:\n${linhas.join("\n")}\n`;
}

/** Esquema JSON do campo `acoes` na resposta do agente (null quando não há pedido de ação). */
export function esquemaDasAcoes(operacoes: string[]) {
  return {
    type: ["object", "null"],
    additionalProperties: false,
    required: ["resumo", "itens"],
    properties: {
      resumo: { type: "string" },
      itens: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["operacao", "ref", "para"],
          properties: {
            operacao: { type: "string", enum: operacoes },
            ref: { type: "string" },
            para: { type: "string" },
          },
        },
      },
    },
  };
}

/** Texto da regra no prompt: o que cada operação faz e como pedir. */
export function regraDasAcoes(descricoes: Record<string, string>): string {
  const linhas = Object.keys(descricoes).map((k) => `  - ${k}: ${descricoes[k]}`);
  return `- acoes: só quando a equipe PEDIR para fazer algo com os itens listados (apagar, arquivar, mover, reorganizar, refazer, trocar). itens: { operacao, ref, para } (para vazio quando a operação não leva valor). Operações:
${linhas.join("\n")}
  Use SÓ apelidos das listas acima; nunca invente apelido nem escreva id. Pedido amplo ("arquive tudo", "organize estes") vale para todos os itens que casam com o pedido; na dúvida sobre quais itens, pergunte na resposta e devolva null. resumo: 1 a 2 frases dizendo o que vai acontecer. Nada é feito agora: a equipe vê a lista e confirma. Na resposta, diga que a lista está pronta para confirmar. Sem pedido desse tipo, null.`;
}

/**
 * Lê o que o modelo devolveu em `acoes` e troca apelido por alvo.
 * Null quando não sobra nada para confirmar (nem item, nem recusa com motivo).
 * - operação fora das regras, apelido desconhecido, repetido ou com `para`
 *   inválido: vai para `ignorados` (a tela mostra), nunca vira ação;
 * - alvo travado: vai para `recusados` com o motivo.
 */
export function normalizarAcaoDoAgente<A extends Alvo>(
  bruto: unknown,
  alvos: Array<AlvoComApelido<A>>,
  regras: Record<string, RegraDaOperacao<A>>,
  opcoes: { agente: string; id?: string; contexto?: Record<string, unknown>; semDesfazer?: (itens: ItemDaAcaoDoAgente[]) => boolean; rotuloDoPara?: (operacao: string, para: ValorPara) => string | null },
): AcaoDoAgente | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const porRef = new Map(alvos.map((a) => [a.ref.toLowerCase(), a]));
  // Operação que não combina fica sozinha no alvo; as que combinam podem se juntar entre si.
  const exclusivos = new Set<string>();
  const usados = new Set<string>();
  const vistos = new Set<string>();
  const ignorados: string[] = [];
  const recusados: RecusaDoItem[] = [];
  const itens: ItemDaAcaoDoAgente[] = [];

  for (const b of (Array.isArray(o.itens) ? o.itens : []).slice(0, MAX_ITENS_POR_ACAO * 2)) {
    if (itens.length >= MAX_ITENS_POR_ACAO) break;
    const m = (b ?? {}) as Record<string, unknown>;
    const operacao = texto(m.operacao, 40).toLowerCase();
    const ref = texto(m.ref, 12).toLowerCase();
    const regra = Object.prototype.hasOwnProperty.call(regras, operacao) ? regras[operacao] : undefined;
    const alvo = porRef.get(ref);
    const chave = `${operacao}:${ref}`;
    if (!regra || !alvo || vistos.has(chave) || (regra.combina ? exclusivos.has(ref) : usados.has(ref)) || (regra.alvos && !apelidoDoTipo(alvo.ref, regra.alvos))) {
      if (ref) ignorados.push(ref);
      continue;
    }
    let para: ValorPara = null;
    if (regra.para) {
      const v = regra.para(m.para, alvo);
      if (v === null || v === undefined || v === "") {
        ignorados.push(ref);
        continue;
      }
      para = v;
    }
    vistos.add(chave);
    usados.add(ref);
    if (!regra.combina) exclusivos.add(ref);
    const motivo = regra.trava ? regra.trava(alvo, para) : null;
    if (motivo) {
      recusados.push({ ref: alvo.ref, titulo: umaLinha(alvo.titulo || "sem título", 200), operacao, motivo });
      continue;
    }
    const item: ItemDaAcaoDoAgente = {
      ref: alvo.ref,
      alvo_id: alvo.id,
      titulo: umaLinha(alvo.titulo || "sem título", 200),
      detalhe: alvo.detalhe ? umaLinha(alvo.detalhe, 160) : null,
      operacao,
      rotulo: regra.rotulo,
      para,
    };
    const rotuloDoPara = opcoes.rotuloDoPara ? opcoes.rotuloDoPara(operacao, para) : null;
    if (rotuloDoPara) item.para_rotulo = rotuloDoPara;
    itens.push(item);
  }

  if (!itens.length && !recusados.length) return null;
  const acao: AcaoDoAgente = {
    tipo: TIPO_DA_ACAO,
    agente: opcoes.agente,
    id: opcoes.id || `${opcoes.agente}-${Date.now().toString(36)}`,
    resumo: texto(o.resumo, 600) || resumoPadrao(itens),
    itens,
    ignorados,
    recusados,
  };
  if (opcoes.contexto) acao.contexto = opcoes.contexto;
  if (opcoes.semDesfazer && opcoes.semDesfazer(itens)) acao.sem_desfazer = true;
  return acao;
}

/** "Vou arquivar 3 itens e mover 2." a partir dos rótulos. */
export function resumoPadrao(itens: Array<Pick<ItemDaAcaoDoAgente, "rotulo">>): string {
  if (!itens.length) return "Nada para fazer.";
  const conta = new Map<string, number>();
  for (const i of itens) conta.set(i.rotulo, (conta.get(i.rotulo) || 0) + 1);
  const partes = [...conta.entries()].map(([r, n]) => `${r} ${n} ${n === 1 ? "item" : "itens"}`);
  return `Vou ${partes.join(" e ")}.`;
}

/** Estado da proposta, para a tela e para as travas do executor. */
export function estadoDaAcao(a: Pick<AcaoDoAgente, "executada_em" | "descartada_em" | "desfeita_em">): "aberta" | "feita" | "descartada" | "desfeita" {
  if (a.desfeita_em) return "desfeita";
  if (a.executada_em) return "feita";
  if (a.descartada_em) return "descartada";
  return "aberta";
}

/**
 * Executa item a item, em lotes (padrão 5 ao mesmo tempo). Nunca lança: cada
 * item responde por si, e o erro vira `motivo`. O executor devolve o que o
 * Desfazer precisa (ou nada, quando não há reverso).
 */
export async function executarItemAItem(
  itens: ItemDaAcaoDoAgente[],
  executor: (item: ItemDaAcaoDoAgente) => Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string } | void>,
  lote = 5,
): Promise<ResultadoDoItem[]> {
  const saida: ResultadoDoItem[] = [];
  const tamanho = Math.max(1, lote);
  for (let k = 0; k < itens.length; k += tamanho) {
    const parte = itens.slice(k, k + tamanho);
    const feitos = await Promise.all(parte.map(async (it): Promise<ResultadoDoItem> => {
      const base = { ref: it.ref, alvo_id: it.alvo_id, titulo: it.titulo, operacao: it.operacao };
      try {
        const r = (await executor(it)) || {};
        const out: ResultadoDoItem = { ...base, ok: true };
        if (r.desfazer) out.desfazer = r.desfazer;
        if (r.aviso) out.motivo = r.aviso;
        return out;
      } catch (e) {
        return { ...base, ok: false, motivo: motivoDoErro(e) };
      }
    }));
    saida.push(...feitos);
  }
  return saida;
}

/** Desfaz na ordem inversa o que deu certo e tem reverso. Nunca lança. */
export async function desfazerItemAItem(
  resultados: ResultadoDoItem[],
  reverter: (r: ResultadoDoItem) => Promise<void>,
): Promise<{ voltaram: number; falharam: Array<{ ref: string; titulo: string; motivo: string }> }> {
  let voltaram = 0;
  const falharam: Array<{ ref: string; titulo: string; motivo: string }> = [];
  for (const r of resultados.slice().reverse()) {
    if (!r.ok || !r.desfazer) continue;
    try {
      await reverter(r);
      voltaram++;
    } catch (e) {
      falharam.push({ ref: r.ref, titulo: r.titulo, motivo: motivoDoErro(e) });
    }
  }
  return { voltaram, falharam };
}

export function motivoDoErro(e: unknown): string {
  const m = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return umaLinha(m, 300) || "Não foi possível.";
}

/** Frase do que aconteceu: "3 feitos, 1 não pôde (motivo na lista)". */
export function textoDoResultado(resultados: ResultadoDoItem[]): string {
  const ok = resultados.filter((r) => r.ok).length;
  const falhas = resultados.length - ok;
  const partes: string[] = [];
  if (ok) partes.push(`${ok} ${ok === 1 ? "feito" : "feitos"}`);
  if (falhas) partes.push(`${falhas} não ${falhas === 1 ? "pôde ser feito" : "puderam ser feitos"} (motivo na lista)`);
  return partes.join(", ") || "nada mudou";
}

/** Erro com código, para o executor devolver 4xx com frase clara. */
export class ErroDaAcao extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

/** Confere se a proposta ainda pode ser confirmada (ou desfeita). Lança ErroDaAcao. */
export function exigirEstado(a: AcaoDoAgente, pedido: "confirmar" | "desfazer") {
  const e = estadoDaAcao(a);
  if (pedido === "confirmar") {
    if (e === "feita" || e === "desfeita") throw new ErroDaAcao(409, "acao_ja_feita", "Esta ação já foi feita.");
    if (e === "descartada") throw new ErroDaAcao(409, "acao_descartada", "Esta ação foi cancelada. Peça de novo ao agente.");
    return;
  }
  if (e !== "feita") throw new ErroDaAcao(409, e === "desfeita" ? "acao_ja_desfeita" : "acao_nao_feita", e === "desfeita" ? "Esta ação já foi desfeita." : "Esta ação ainda não foi feita.");
}

// ------------------------------------------------------------------ onde a proposta mora

/** Cliente mínimo do Supabase que o contrato usa (o de verdade serve; o dos testes também). */
// deno-lint-ignore no-explicit-any
type ServicoMinimo = { from: (tabela: string) => any };

export type AcaoGuardada = {
  mensagem: { id: string; client_id: string; conversa_id: string | null };
  acao: AcaoDoAgente;
  gravar: (novo: AcaoDoAgente) => Promise<AcaoDoAgente>;
};

/**
 * A proposta guardada numa linha de mensagem (anexos jsonb). Padrão:
 * agente_mensagens. `acaoId` escolhe entre várias propostas da mesma mensagem;
 * sem ele, a primeira. O acesso ao cliente é conferido por quem chama
 * (exigirAcesso), antes de qualquer escrita.
 */
export async function acaoGuardadaNaMensagem(
  servico: ServicoMinimo,
  mensagemId: unknown,
  exigirAcesso: (clientId: string) => Promise<void>,
  opcoes: { tabela?: string; acaoId?: unknown; agente?: string } = {},
): Promise<AcaoGuardada> {
  const id = String(mensagemId ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new ErroDaAcao(400, "mensagem_invalida", "mensagem_id precisa ser um UUID.");
  }
  const tabela = opcoes.tabela || "agente_mensagens";
  const { data, error } = await servico.from(tabela).select("id, client_id, conversa_id, anexos").eq("id", id).maybeSingle();
  if (error) throw new ErroDaAcao(500, "mensagem_indisponivel", "Não foi possível ler a mensagem do agente.");
  if (!data) throw new ErroDaAcao(404, "mensagem_inexistente", "Mensagem não encontrada.");
  const m = data as { id: string; client_id: string; conversa_id?: string | null; anexos: unknown };
  await exigirAcesso(m.client_id);
  const anexos = Array.isArray(m.anexos) ? (m.anexos as Record<string, unknown>[]) : [];
  const acaoId = opcoes.acaoId ? String(opcoes.acaoId) : "";
  const i = anexos.findIndex((a) => a && a.tipo === TIPO_DA_ACAO && (!acaoId || a.id === acaoId) && (!opcoes.agente || a.agente === opcoes.agente));
  if (i < 0) throw new ErroDaAcao(404, "acao_inexistente", "Esta mensagem não tem ação do agente.");
  const acao = acaoDoAnexo(anexos[i]) as AcaoDoAgente;
  const gravar = async (novo: AcaoDoAgente) => {
    const lista = anexos.slice();
    lista[i] = novo as unknown as Record<string, unknown>;
    const { error: e } = await servico.from(tabela).update({ anexos: lista }).eq("id", m.id).eq("client_id", m.client_id);
    if (e) throw new ErroDaAcao(500, "acao_nao_registrada", "A ação foi feita, mas o registro na conversa falhou. Atualize a tela.");
    anexos[i] = lista[i];
    return novo;
  };
  return { mensagem: { id: m.id, client_id: m.client_id, conversa_id: m.conversa_id ?? null }, acao, gravar };
}

/** Lê um anexo como proposta (a tela usa o mesmo). Null quando não é uma. */
export function acaoDoAnexo(a: unknown): AcaoDoAgente | null {
  if (!a || typeof a !== "object") return null;
  const o = a as Record<string, unknown>;
  if (o.tipo !== TIPO_DA_ACAO) return null;
  return {
    ...(o as unknown as AcaoDoAgente),
    agente: String(o.agente || ""),
    id: String(o.id || ""),
    resumo: String(o.resumo || ""),
    itens: Array.isArray(o.itens) ? (o.itens as ItemDaAcaoDoAgente[]) : [],
    ignorados: Array.isArray(o.ignorados) ? (o.ignorados as unknown[]).map(String) : [],
    recusados: Array.isArray(o.recusados) ? (o.recusados as RecusaDoItem[]) : [],
  };
}

/** Todas as propostas de uma lista de anexos. */
export function acoesDosAnexos(anexos: unknown): AcaoDoAgente[] {
  if (!Array.isArray(anexos)) return [];
  return anexos.map(acaoDoAnexo).filter((a): a is AcaoDoAgente => !!a);
}

/**
 * Confirma (ou cancela) a proposta: executa item a item, grava o resultado na
 * própria proposta e devolve o anexo novo. Quem chama cuida da auditoria e da
 * frase na conversa.
 */
export async function confirmarAcaoGuardada(
  guardada: AcaoGuardada,
  executor: (item: ItemDaAcaoDoAgente, acao: AcaoDoAgente) => Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string } | void>,
  opcoes: { descartar?: boolean; userId: string; lote?: number },
): Promise<{ anexo: AcaoDoAgente; resultados: ResultadoDoItem[] }> {
  const { acao, gravar } = guardada;
  exigirEstado(acao, "confirmar");
  if (opcoes.descartar) return { anexo: await gravar({ ...acao, descartada_em: new Date().toISOString() }), resultados: [] };
  const resultados = await executarItemAItem(acao.itens, (it) => executor(it, acao), opcoes.lote ?? 5);
  const anexo = await gravar({ ...acao, executada_em: new Date().toISOString(), executada_por: opcoes.userId, resultados });
  return { anexo, resultados };
}

/** Desfaz a proposta já feita e grava. */
export async function desfazerAcaoGuardada(
  guardada: AcaoGuardada,
  reverter: (r: ResultadoDoItem, acao: AcaoDoAgente) => Promise<void>,
  opcoes: { userId: string },
): Promise<{ anexo: AcaoDoAgente; voltaram: number; falharam: Array<{ ref: string; titulo: string; motivo: string }> }> {
  const { acao, gravar } = guardada;
  exigirEstado(acao, "desfazer");
  const r = await desfazerItemAItem(acao.resultados || [], (x) => reverter(x, acao));
  const anexo = await gravar({ ...acao, desfeita_em: new Date().toISOString(), desfeita_por: opcoes.userId });
  return { anexo, ...r };
}
