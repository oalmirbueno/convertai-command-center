/**
 * Ponte do MCP para as mesas (regras puras, sem Deno e sem banco).
 *
 * MCP 2.3: o agente não só lê as mesas, também AGE nelas. A regra de negócio
 * continua morando em cada mesa (agente-calendario, mesa-ads, estudio-arte e
 * as RPCs do banco): o MCP chama a função da mesa pelo servidor, com a
 * identidade da PESSOA conectada, e nunca refaz a regra aqui.
 *
 * Por que a identidade da pessoa e não a chave de serviço: as mesas conferem
 * equipe e acesso ao cliente com o JWT de quem chama (can_access_client lê
 * auth.uid(), o Estúdio sobe arquivo e registra em Arquivos com esse JWT).
 * Chamar com a chave de serviço pularia exatamente essas guardas. Então:
 *
 * - Conexão OAuth (ChatGPT, Claude): o token de acesso do Supabase da pessoa
 *   já validado na entrada do MCP segue para a mesa. A mesa confere tudo de
 *   novo, como se a pessoa tivesse clicado na tela, e grava criado_por = ela.
 * - Chave de API (mcp_live_*): não tem pessoa com sessão. A ação é recusada
 *   com a explicação, e a leitura continua valendo. O caminho para chave de
 *   API está descrito em docs/cerebro/AGENTES.md (ponte de serviço), e só
 *   entra quando as mesas aceitarem essa chamada.
 *
 * Este arquivo guarda o que dá para testar sem rede: a lista fechada de
 * funções e ações que a ponte pode chamar, os prazos, e a leitura da
 * resposta com fôlego (espaços antes do JSON, erro com campo `error`).
 */

/** Funções e ações que a ponte pode chamar. Qualquer outra é recusada antes da rede. */
export const ACOES_DA_PONTE = {
  'agente-calendario': ['pedido_livre', 'gravar', 'campanha_criar', 'campanha_salvar'],
  'mesa-ads': ['briefing_salvar', 'oferta_salvar', 'oferta_do_contexto'],
  'estudio-arte': ['entregar'],
} as const;

export type FuncaoDaMesa = keyof typeof ACOES_DA_PONTE;
export type AcaoDaMesa<F extends FuncaoDaMesa = FuncaoDaMesa> = (typeof ACOES_DA_PONTE)[F][number];

/** Ações com IA ou entrega de arquivo: podem passar de 150 s (a mesa responde com fôlego). */
export const ACOES_LONGAS_DA_PONTE: ReadonlySet<string> = new Set([
  'agente-calendario:pedido_livre',
  'agente-calendario:campanha_criar',
  'estudio-arte:entregar',
]);

/** RPCs do banco que a ponte pode chamar como a pessoa. */
export const RPCS_DA_PONTE = ['mesa_enviar_para_aprovacao'] as const;
export type RpcDaPonte = (typeof RPCS_DA_PONTE)[number];

export function acaoPermitida(funcao: string, acao: string): funcao is FuncaoDaMesa {
  const lista = (ACOES_DA_PONTE as Record<string, readonly string[]>)[funcao];
  return Array.isArray(lista) && lista.includes(acao);
}

/**
 * Prazo da chamada à mesa. A longa espera até 340 s: as mesas dão até 300 s
 * para a IA e respondem com fôlego; o MCP também responde com fôlego (ver
 * mcp-server/index.ts), então nenhuma ponta morre no corte de 150 s.
 */
export function prazoDaAcao(funcao: string, acao: string): number {
  return ACOES_LONGAS_DA_PONTE.has(`${funcao}:${acao}`) ? 340_000 : 60_000;
}

export type RespostaDaMesa =
  | { ok: true; dados: Record<string, unknown> }
  | { ok: false; codigo: string; mensagem: string; status: number; detalhes: Record<string, unknown> | null };

/**
 * Lê a resposta de uma mesa.
 *
 * A resposta com fôlego chega com 200 e espaços antes do JSON; o erro real
 * vem no corpo, com `error` (código) e `status_http`. A resposta curta usa o
 * status HTTP de verdade. As duas formas caem aqui.
 */
export function lerRespostaDaMesa(texto: string, status: number): RespostaDaMesa {
  let corpo: unknown = null;
  try {
    corpo = JSON.parse(String(texto ?? '').trim() || 'null');
  } catch {
    return { ok: false, codigo: 'resposta_invalida', mensagem: 'A mesa respondeu algo que não é JSON.', status: status || 502, detalhes: null };
  }
  const obj = corpo && typeof corpo === 'object' && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
  const codigo = obj && typeof obj.error === 'string' ? obj.error : null;
  if (status >= 400 || codigo) {
    const statusReal = typeof obj?.status_http === 'number' ? obj.status_http : (status >= 400 ? status : 500);
    const mensagem = typeof obj?.mensagem === 'string' ? obj.mensagem
      : typeof obj?.message === 'string' ? obj.message
      : 'A mesa recusou o pedido.';
    const detalhes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (!['error', 'mensagem', 'message', 'status_http'].includes(k)) detalhes[k] = v;
    }
    return { ok: false, codigo: codigo ?? `http_${statusReal}`, mensagem, status: statusReal, detalhes: Object.keys(detalhes).length ? detalhes : null };
  }
  if (!obj) return { ok: false, codigo: 'resposta_vazia', mensagem: 'A mesa não devolveu dados.', status: status || 502, detalhes: null };
  return { ok: true, dados: obj };
}

/** Mensagem para quem conecta com chave de API e tenta agir. */
export const AVISO_ACAO_SO_COM_PESSOA =
  'Agir nas mesas pelo MCP exige conexão OAuth (ChatGPT ou Claude conectados com a conta da pessoa): a mesa confere equipe e acesso ao cliente com a sessão de quem age e grava quem fez. Chave de API (mcp_live_*) lê as mesas, mas não age nelas. Peça para a pessoa conectar pelo OAuth ou faça a ação no painel.';

/** Prova de quem fez, devolvida em toda ação (o log de auditoria do MCP guarda o resto). */
export function feitoPor(ctx: { keyId: string; origin: string | null; correlationId?: string; dataScope?: { principalUserId: string | null } }) {
  return {
    via: 'mcp',
    principal: ctx.keyId,
    pessoa: ctx.dataScope?.principalUserId ?? null,
    correlation_id: ctx.correlationId ?? null,
    registro: 'mcp_audit_log (entrada sem segredo) e criado_por na mesa',
  };
}

/**
 * Junta o briefing de anúncios novo com o atual, seção por seção.
 *
 * briefing_salvar da Mesa Ads grava uma VERSÃO NOVA inteira: o que não vier
 * vira vazio. Pela tela isso é certo (o formulário manda tudo); pelo MCP o
 * agente costuma mandar só a parte que mudou. Então o que vier substitui a
 * seção (objeto: campo a campo; lista: a lista inteira) e o resto fica como
 * estava.
 *
 * Autorização de depoimento e rosto (provas[].autorizado) é gesto humano: o
 * agente não marca. Prova nova entra como não autorizada; prova que já
 * existia com o mesmo texto mantém a marca que tinha.
 */
export function juntarBriefingDeAds(atual: Record<string, unknown> | null, novo: Record<string, unknown>): Record<string, unknown> {
  const base = atual ?? {};
  const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const saida: Record<string, unknown> = {
    oferta: obj(base.oferta),
    publico: obj(base.publico),
    objecoes: Array.isArray(base.objecoes) ? base.objecoes : [],
    provas: Array.isArray(base.provas) ? base.provas : [],
    destino: obj(base.destino),
    objetivo: obj(base.objetivo),
    restricoes: typeof base.restricoes === 'string' ? base.restricoes : null,
  };
  for (const secao of ['oferta', 'publico', 'destino', 'objetivo'] as const) {
    if (novo[secao] && typeof novo[secao] === 'object' && !Array.isArray(novo[secao])) {
      saida[secao] = { ...obj(saida[secao]), ...obj(novo[secao]) };
    }
  }
  if (Array.isArray(novo.objecoes)) saida.objecoes = novo.objecoes;
  if (Array.isArray(novo.provas)) {
    const autorizadas = new Set(
      (Array.isArray(base.provas) ? base.provas : [])
        .filter((p) => obj(p).autorizado === true)
        .map((p) => String(obj(p).texto ?? '').trim().toLowerCase()),
    );
    saida.provas = novo.provas.map((p) => {
      const o = obj(p);
      return { ...o, autorizado: autorizadas.has(String(o.texto ?? '').trim().toLowerCase()) };
    });
  }
  if (typeof novo.restricoes === 'string' || novo.restricoes === null) saida.restricoes = novo.restricoes;
  return saida;
}
