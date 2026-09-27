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
 * 6. "Ele já vai fazendo" (dono, 26/09: "eu peço, ele já vai fazendo"):
 *    EXECUÇÃO DIRETA. Quando o pedido é uma ordem clara, SEM custo e com
 *    reverso, o agente executa na hora e o cartão já chega "Feito" com o
 *    Desfazer (sem clique extra). O que custa (IA, geração, verba) ou não tem
 *    volta (publicar, enviar ao cliente, reprovar, mexer em conta de anúncio)
 *    continua com Confirmar e o custo antes. A regra é uma só, em
 *    podeExecutarDireto: toda operação da proposta marcada `direta` na regra
 *    (o executor garante o Desfazer), custo zero, sem_desfazer falso, nada
 *    recusado nem ignorado, até MAX_ITENS_DIRETOS itens e pedido claro (quem
 *    chama decide: Jev ou a regra da área; na dúvida, Confirmar). Quem executa
 *    direto usa executarDireto e guarda a proposta já feita na mensagem: o
 *    Desfazer é o de sempre (desfazer_acao_agente).
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
  /**
   * Pode ir direto (regra 6 do topo): a operação não custa nada e o executor
   * sempre devolve o Desfazer. Ausente: precisa de Confirmar.
   */
  direta?: boolean;
  /**
   * A mesma operação pode vir mais de uma vez no mesmo alvo (ex.: criar três
   * tarefas no mesmo projeto). A repetição ganha apelido próprio (p1.2, p1.3)
   * para o resultado e o Desfazer de cada uma não se misturarem.
   */
  repete?: boolean;
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
  /**
   * Pedidos válidos que passaram do teto de MAX_ITENS_POR_ACAO (AB2): não
   * entram nesta lista e a tela avisa quantos ficaram para um próximo pedido.
   */
  acima_do_teto?: number;
  /** Contexto que o executor precisa (ex.: trabalho_id do carrossel). */
  contexto?: Record<string, unknown>;
  /** Operações sem reverso (ex.: gerar de novo com IA): a tela avisa antes. */
  sem_desfazer?: boolean;
  /** Custo estimado em US$, mostrado antes da confirmação (0 ou ausente: sem custo). */
  custo_estimado_usd?: number | null;
  executada_em?: string | null;
  executada_por?: string | null;
  /** Feita na hora, sem clique (regra 6: pedido claro, sem custo e com reverso). */
  executada_direto?: boolean;
  resultados?: ResultadoDoItem[];
  descartada_em?: string | null;
  desfeita_em?: string | null;
  desfeita_por?: string | null;
  /** Botão "Ir para" depois de feito (ver CaminhoDoAgente). */
  caminho?: CaminhoDoAgente | null;
  /**
   * Sequência feita em passos (confirmarAcaoGuardada com porVez): quantos já
   * foram e o total. A tela mostra "3 de 12" e o botão Parar entre um passo e
   * outro. Ausente: a proposta foi feita de uma vez (como sempre foi).
   */
  andamento?: AndamentoDaAcao | null;
  /** A equipe parou a sequência no meio: o que já foi feito fica, com o Desfazer. */
  parada_em?: string | null;
};

export type AndamentoDaAcao = { feitos: number; total: number; atualizado_em?: string };

/**
 * Para onde ir quando a ação termina (pedido do dono, 27/09: "quando termina
 * ele dá o caminho pra mim apertar e ir e já fica tudo certinho"): rota
 * interna do painel já com o estado (cliente, etapa, item) e o rótulo do
 * botão. `abrir_sozinho`: a tela vai sozinha ao terminar (pedido "faz e me
 * leva"). Só rota interna: começa com "/" e nunca com "//".
 */
export type CaminhoDoAgente = { rotulo: string; destino: string; abrir_sozinho?: boolean };

/** Caminho válido ou null (endereço externo, javascript: ou rótulo vazio não passam). */
export function caminhoSeguro(c: unknown): CaminhoDoAgente | null {
  if (!c || typeof c !== "object") return null;
  const o = c as Record<string, unknown>;
  const destino = typeof o.destino === "string" ? o.destino.trim() : "";
  const rotulo = typeof o.rotulo === "string" ? o.rotulo.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  if (!rotulo || !destino || destino.length > 600) return null;
  if (destino.charAt(0) !== "/" || destino.charAt(1) === "/" || destino.charAt(1) === "\\") return null;
  return o.abrir_sozinho === true ? { rotulo, destino, abrir_sozinho: true } : { rotulo, destino };
}

/**
 * O caminho também vale para resposta sem ação (27/09: "isso em todos ele dá
 * o caminho"): um anexo próprio na mensagem do agente, guardado com ela, para
 * o botão continuar lá quando a conversa é reaberta. Só rota interna.
 */
export const TIPO_DO_CAMINHO = "caminho_do_agente";
export type AnexoDoCaminho = CaminhoDoAgente & { tipo: typeof TIPO_DO_CAMINHO };

export function anexoDoCaminho(c: unknown): AnexoDoCaminho | null {
  const s = caminhoSeguro(c);
  return s ? { tipo: TIPO_DO_CAMINHO, ...s } : null;
}

/**
 * O caminho de uma mensagem: o anexo próprio ou, na falta dele, o da última
 * ação feita. Null quando não há (ou não é rota interna).
 */
export function caminhoDosAnexos(anexos: unknown): CaminhoDoAgente | null {
  if (!Array.isArray(anexos)) return null;
  for (const a of anexos) {
    if (a && typeof a === "object" && (a as Record<string, unknown>).tipo === TIPO_DO_CAMINHO) {
      const c = caminhoSeguro(a);
      if (c) return c;
    }
  }
  return null;
}

/**
 * Os anexos da resposta com o caminho no fim: quando alguma ação da mensagem
 * já leva o seu caminho (o cartão mostra "Ir para"), não repete; senão, soma
 * o anexo de caminho (resposta sem ação que cita outra área, resultado
 * gerado...). Caminho inválido não entra.
 */
export function anexosComCaminho(anexos: unknown[], c: unknown): unknown[] {
  const lista = Array.isArray(anexos) ? anexos.slice() : [];
  const temNaAcao = lista.some((a) => !!a && typeof a === "object" && (a as Record<string, unknown>).tipo === TIPO_DA_ACAO && !!caminhoSeguro((a as Record<string, unknown>).caminho));
  const anexo = temNaAcao ? null : anexoDoCaminho(c);
  if (anexo) lista.push(anexo);
  return lista;
}

/** Põe o caminho em cada ação dos anexos (os outros anexos ficam como estão). */
export function caminhoNasAcoes(anexos: unknown[], fn: (acao: AcaoDoAgente) => unknown, opcoes: { abrirSozinho?: boolean } = {}): unknown[] {
  return (Array.isArray(anexos) ? anexos : []).map((a) => {
    if (!a || typeof a !== "object" || (a as Record<string, unknown>).tipo !== TIPO_DA_ACAO) return a;
    const acao = a as AcaoDoAgente;
    return comCaminho(acao, fn(acao), opcoes);
  });
}

/**
 * Põe o caminho na proposta (null não mexe). `abrir_sozinho` do pedido ("faz e
 * me leva") vence: o caminho recalculado depois de feito não o perde.
 */
export function comCaminho<T extends { caminho?: CaminhoDoAgente | null }>(acao: T, c: unknown, opcoes: { abrirSozinho?: boolean } = {}): T {
  const s = caminhoSeguro(c);
  if (!s) return acao;
  const abrir = opcoes.abrirSozinho === true || s.abrir_sozinho === true || !!(acao.caminho && acao.caminho.abrir_sozinho === true);
  return { ...acao, caminho: abrir ? { ...s, abrir_sozinho: true } : { rotulo: s.rotulo, destino: s.destino } };
}

const texto =(v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Apelidos p1..pN na ordem recebida (quem chama ordena antes).
 * AB2: passou do teto, a lista guarda quantos ficaram de fora (propriedade
 * `foraDaLista`, que não vai para o JSON) e o blocoDosAlvos avisa o agente.
 * Antes parava em 150 calado e "arquive todos" fazia só uma parte.
 */
export function comApelido<A extends Alvo>(alvos: A[], prefixo: string, max = MAX_ALVOS_PARA_O_AGENTE): Array<AlvoComApelido<A>> {
  const p = String(prefixo || "x").toLowerCase().replace(/[^a-z]/g, "") || "x";
  const lista = alvos.slice(0, max).map((a, i) => ({ ...a, ref: `${p}${i + 1}` }));
  const fora = Math.max(0, alvos.length - lista.length);
  if (fora) Object.defineProperty(lista, "foraDaLista", { value: fora, enumerable: false });
  return lista;
}

/** Quantos alvos o comApelido deixou de fora pelo teto (0 quando coube tudo). */
export function foraDaLista(alvos: unknown): number {
  const n = alvos && typeof alvos === "object" ? (alvos as { foraDaLista?: unknown }).foraDaLista : 0;
  return typeof n === "number" && n > 0 ? n : 0;
}

/** Aviso do teto para o prompt: o agente sabe que a lista não é tudo e diz isso à equipe. */
export function avisoDoTetoDosAlvos(mostrados: number, fora: number): string {
  if (fora <= 0) return "";
  return `ATENÇÃO: esta lista mostra ${mostrados} de ${mostrados + fora}. Os outros ${fora} não estão aqui e não podem entrar em acoes agora. Pedido para "todos": faça com os listados e diga na resposta que ${fora} ficaram para um próximo pedido.`;
}

/** Bloco do prompt com os alvos, um por linha: apelido | título | detalhe. Nunca leva o id. */
export function blocoDosAlvos(titulo: string, alvos: AlvoComApelido[], vazio = "nenhum."): string {
  if (!alvos.length) return `\n${titulo}: ${vazio}\n`;
  const linhas = alvos.map((a) => [a.ref, umaLinha(a.titulo || "sem título", 140), umaLinha(a.detalhe, 160)].filter(Boolean).join(" | "));
  const aviso = avisoDoTetoDosAlvos(alvos.length, foraDaLista(alvos));
  return `\n${titulo} (apelido | título | detalhe). Use só estes apelidos em acoes:\n${linhas.join("\n")}\n${aviso ? `${aviso}\n` : ""}`;
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
  const repeticoes = new Map<string, number>();
  const comValor = new Set<string>();
  const ignorados: string[] = [];
  const recusados: RecusaDoItem[] = [];
  const itens: ItemDaAcaoDoAgente[] = [];
  // AB2: o que passa do teto não some calado. Pedido válido acima dos 120
  // conta em acima_do_teto (a tela avisa); o que nem cabe na leitura (mais de
  // 4x o teto) também conta, sem ler um por um.
  const brutos = Array.isArray(o.itens) ? o.itens : [];
  const LEITURA_MAXIMA = MAX_ITENS_POR_ACAO * 4;
  let acimaDoTeto = Math.max(0, brutos.length - LEITURA_MAXIMA);

  for (const b of brutos.slice(0, LEITURA_MAXIMA)) {
    const m = (b ?? {}) as Record<string, unknown>;
    const operacao = texto(m.operacao, 40).toLowerCase();
    const ref = texto(m.ref, 12).toLowerCase();
    const regra = Object.prototype.hasOwnProperty.call(regras, operacao) ? regras[operacao] : undefined;
    const alvo = porRef.get(ref);
    const chave = `${operacao}:${ref}`;
    const repetido = vistos.has(chave);
    if (!regra || !alvo || (repetido && !regra.repete) || (!repetido && (regra.combina ? exclusivos.has(ref) : usados.has(ref))) || (regra.alvos && !apelidoDoTipo(alvo.ref, regra.alvos))) {
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
    // Repetição idêntica (mesma operação, alvo e valor) é engano do modelo: fica de fora.
    const assinatura = `${chave}|${String(para)}`;
    if (repetido && comValor.has(assinatura)) {
      ignorados.push(ref);
      continue;
    }
    comValor.add(assinatura);
    vistos.add(chave);
    usados.add(ref);
    if (!regra.combina) exclusivos.add(ref);
    // Repetição permitida (regra.repete): apelido próprio (p1.2) para resultado e Desfazer.
    let refDoItem = alvo.ref;
    if (repetido) {
      const n = (repeticoes.get(chave) || 1) + 1;
      repeticoes.set(chave, n);
      refDoItem = `${alvo.ref}.${n}`;
    }
    const motivo = regra.trava ? regra.trava(alvo, para) : null;
    if (motivo) {
      recusados.push({ ref: refDoItem, titulo: umaLinha(alvo.titulo || "sem título", 200), operacao, motivo });
      continue;
    }
    if (itens.length >= MAX_ITENS_POR_ACAO) {
      acimaDoTeto++;
      continue;
    }
    const item: ItemDaAcaoDoAgente = {
      ref: refDoItem,
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
  if (acimaDoTeto) acao.acima_do_teto = acimaDoTeto;
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

// ------------------------------------------------------------------ execução direta (regra 6)

/** Acima disto, mesmo sem custo, a lista pede o olho da equipe (Confirmar). */
export const MAX_ITENS_DIRETOS = 5;

/**
 * A proposta pode ser feita na hora, sem clique? Só quando TUDO vale:
 * pedido claro, toda operação `direta` na regra, custo zero, com reverso,
 * nada recusado nem ignorado e até MAX_ITENS_DIRETOS itens. O motivo diz por
 * que não (vai para o log e para o teste).
 */
export function podeExecutarDireto(
  acao: Pick<AcaoDoAgente, "itens" | "recusados" | "ignorados" | "custo_estimado_usd" | "sem_desfazer" | "executada_em" | "descartada_em"> & Partial<Pick<AcaoDoAgente, "acima_do_teto">>,
  regras: Record<string, Pick<RegraDaOperacao, "direta">>,
  opcoes: { pedidoClaro: boolean; maxItens?: number },
): { direto: boolean; motivo: string } {
  const max = opcoes.maxItens ?? MAX_ITENS_DIRETOS;
  if (acao.executada_em || acao.descartada_em) return { direto: false, motivo: "a proposta já foi resolvida" };
  if (!opcoes.pedidoClaro) return { direto: false, motivo: "o pedido não é uma ordem clara" };
  if (!acao.itens.length) return { direto: false, motivo: "nada para fazer" };
  if (acao.itens.length > max) return { direto: false, motivo: `mais de ${max} itens` };
  if (acao.acima_do_teto) return { direto: false, motivo: "parte do pedido passou do teto" };
  if ((acao.recusados || []).length || (acao.ignorados || []).length) return { direto: false, motivo: "há item recusado ou fora da lista" };
  if (acao.sem_desfazer) return { direto: false, motivo: "sem Desfazer" };
  if (typeof acao.custo_estimado_usd === "number" && acao.custo_estimado_usd > 0) return { direto: false, motivo: "tem custo" };
  for (const i of acao.itens) {
    const r = Object.prototype.hasOwnProperty.call(regras, i.operacao) ? regras[i.operacao] : undefined;
    if (!r || r.direta !== true) return { direto: false, motivo: `a operação ${i.operacao} pede Confirmar` };
  }
  return { direto: true, motivo: "pedido claro, sem custo e com Desfazer" };
}

/**
 * Faz a proposta na hora (regra 6) e devolve o anexo já "feito", para quem
 * chama guardar na mensagem. Item que falhou volta com o motivo, como no
 * Confirmar; o que deu certo fica com o Desfazer.
 */
export async function executarDireto(
  acao: AcaoDoAgente,
  executor: (item: ItemDaAcaoDoAgente, acao: AcaoDoAgente) => Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string } | void>,
  opcoes: { userId: string; lote?: number },
): Promise<AcaoDoAgente> {
  const resultados = await executarItemAItem(acao.itens, (it) => executor(it, acao), opcoes.lote ?? 1);
  return { ...acao, executada_em: new Date().toISOString(), executada_por: opcoes.userId, executada_direto: true, resultados };
}

/**
 * Pedido claro sem o Jev (reserva de _shared/ordem-clara.ts): começa com verbo
 * de ordem ("crie", "marque", "agende", "troque", "renomeie"...). Na dúvida,
 * não: o cartão pede Confirmar.
 */
export function pareceOrdem(texto: unknown): boolean {
  const t = String(texto == null ? "" : texto).trim().toLowerCase();
  return /^(por favor,?\s+)?(cri[ae]|crie|marqu?e|marca|agend[ae]|registr[ae]|anot[ae]|conclu[ai]|finaliz[ae]|mud[ae]|troqu?e|troca|renomei[ae]|coloqu?e|coloca|lembr[ae]|me lembr[ae]|abr[ae]|lev[ae]|v[aá] para|edit[ae]|ajust[ae]|arquiv[ae]|aprov[ae]|mand[ae]|envi[ae]|reprov[ae]|pass[ae] o prazo)\b/.test(t);
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
    acima_do_teto: typeof o.acima_do_teto === "number" && o.acima_do_teto > 0 ? o.acima_do_teto : undefined,
    ...(o.caminho !== undefined ? { caminho: caminhoSeguro(o.caminho) } : {}),
  };
}

/** Todas as propostas de uma lista de anexos. */
export function acoesDosAnexos(anexos: unknown): AcaoDoAgente[] {
  if (!Array.isArray(anexos)) return [];
  return anexos.map(acaoDoAnexo).filter((a): a is AcaoDoAgente => !!a);
}

/** Itens da proposta que ainda não têm resultado (sequência em passos). */
export function pendentesDaAcao(acao: Pick<AcaoDoAgente, "itens" | "resultados">): ItemDaAcaoDoAgente[] {
  const feitos = new Set((acao.resultados || []).map((r) => `${r.operacao}|${r.ref}`));
  return acao.itens.filter((i) => !feitos.has(`${i.operacao}|${i.ref}`));
}

/** Quantos itens vão por passo quando a função pede passos e não diz quantos. */
export const ITENS_POR_PASSO = 5;

/**
 * Confirma (ou cancela) a proposta: executa item a item, grava o resultado na
 * própria proposta e devolve o anexo novo. Quem chama cuida da auditoria e da
 * frase na conversa (só quando `terminou`).
 *
 * Acompanhamento e parar (dono, 27/09: "um acompanhamento meu humano
 * observando as ações de forma clara e poder parar ou interferir"), opcional e
 * compatível (sem as opções novas, tudo é feito de uma vez, como antes):
 * - porVez: faz só os próximos N itens pendentes e grava `andamento`; a tela
 *   chama de novo até terminar e mostra "3 de 12" com o botão Parar. Também
 *   deixa cada chamada curta (limite de 150 s da função).
 * - parar (ou descartar com parte já feita): encerra a sequência. O que já foi
 *   feito fica feito, com o Desfazer; o resto não acontece.
 * - caminho: calcula o "Ir para" com o que foi feito (ex.: o id criado). O
 *   abrir_sozinho da proposta ("faz e me leva") é mantido.
 */
export async function confirmarAcaoGuardada(
  guardada: AcaoGuardada,
  executor: (item: ItemDaAcaoDoAgente, acao: AcaoDoAgente) => Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string } | void>,
  opcoes: { descartar?: boolean; userId: string; lote?: number; porVez?: number; parar?: boolean; caminho?: (feita: AcaoDoAgente) => unknown },
): Promise<{ anexo: AcaoDoAgente; resultados: ResultadoDoItem[]; terminou: boolean }> {
  const { acao, gravar } = guardada;
  exigirEstado(acao, "confirmar");
  const agora = new Date().toISOString();
  const jaFeitos = acao.resultados || [];
  const fechar = (a: AcaoDoAgente): AcaoDoAgente => (opcoes.caminho ? comCaminho(a, opcoes.caminho(a)) : a);
  if ((opcoes.parar || opcoes.descartar) && jaFeitos.length) {
    const parada = fechar({ ...acao, executada_em: agora, executada_por: opcoes.userId, parada_em: agora, andamento: { feitos: jaFeitos.length, total: acao.itens.length, atualizado_em: agora } });
    return { anexo: await gravar(parada), resultados: [], terminou: true };
  }
  if (opcoes.descartar || opcoes.parar) return { anexo: await gravar({ ...acao, descartada_em: agora }), resultados: [], terminou: true };
  const pendentes = pendentesDaAcao(acao);
  const porVez = typeof opcoes.porVez === "number" && opcoes.porVez > 0 ? Math.floor(opcoes.porVez) : 0;
  const agoraVao = porVez ? pendentes.slice(0, porVez) : pendentes;
  const resultados = await executarItemAItem(agoraVao, (it) => executor(it, acao), opcoes.lote ?? 5);
  const todos = jaFeitos.concat(resultados);
  const terminou = pendentes.length <= agoraVao.length;
  const andamento: AndamentoDaAcao | undefined = porVez || acao.andamento ? { feitos: todos.length, total: acao.itens.length, atualizado_em: new Date().toISOString() } : undefined;
  const novo: AcaoDoAgente = terminou
    ? fechar({ ...acao, executada_em: new Date().toISOString(), executada_por: opcoes.userId, resultados: todos, ...(andamento ? { andamento } : {}) })
    : { ...acao, resultados: todos, andamento };
  const anexo = await gravar(novo);
  return { anexo, resultados, terminou };
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
