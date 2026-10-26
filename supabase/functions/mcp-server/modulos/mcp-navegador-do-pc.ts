/**
 * Navegador do PC (26/10/2026; MCP 2.20.0): Hermes e Paperclip usam o Ego Lite do PC do dono, com os
 * logins que ele já fez (gerenciador de anúncios da Meta, Instagram, Google), sem pedir senha nem código.
 *
 * - O agente manda os passos (navegar, ler, capturar, clicar, digitar, rolar, esperar); a função confere
 *   (módulo de regras navegador-do-pc.ts), grava a tarefa caso "pc_ego" já autorizada pela credencial da
 *   equipe e devolve o pedido_id. O worker do navegador da máquina do dono pega, roda no Ego e devolve o
 *   texto lido, a URL e um print por passo (Storage, bucket mesa). O agente lê com acao "resultado".
 * - Clique que publica, envia, paga, salva, apaga, ativa ou pausa e digitação fora de busca só com
 *   aprovacao_id de operator_approvals aprovada; o worker confere de novo o alvo real na página.
 * - PC desligado: responde na hora "navegador do PC indisponível" com nao_insistir=true, sem criar
 *   tarefa; pedido parado na fila por mais de 3 min é cancelado com a mesma resposta.
 * - Só credencial da equipe (chave irrestrita), como o navegador remoto.
 * - Horário comercial (MCP 2.21.0): o Ego só roda na janela (padrão 9h–18h, seg a sex, São Paulo;
 *   EGO_HORARIO, EGO_DIAS, EGO_FUSO). Fora dela o pedido é aceito como "agendada" (executar_a_partir_de =
 *   próxima abertura, prioridade alta/normal/baixa) e responde na hora com agendado_para e nao_insistir;
 *   não é cancelado pelos 3 min. Se a janela do dia fechar sem o PC pegar, sai com motivo claro.
 */
import { z } from 'https://esm.sh/zod@3.23.8';
import type { ToolDefinition } from '../../_shared/mcp-tools.ts';
import { db } from '../../_shared/aceleriq-read-services.ts';
import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { aprovacaoValida } from '../../_shared/navegador-operacional.ts';
import {
  ACOES_DO_PC,
  CASO_DO_PC,
  CODIGO_FORA_DO_HORARIO,
  CODIGO_PC_INDISPONIVEL,
  descreverJanelaDoEgo,
  dentroDaJanelaDoEgo,
  ESPERA_NA_FILA_S,
  fimDaJanelaDoDia,
  type JanelaDoEgo,
  lerJanelaDoEgo,
  MENSAGEM_AGENDADO_NAO_RODOU,
  MENSAGEM_PC_INDISPONIVEL,
  mensagemAgendado,
  normalizarPedidoDoPc,
  pcDisponivel,
  PRIORIDADES_DO_PC,
  proximaAberturaDoEgo,
  rotuloLocal,
  tetoDePassosDoPc,
} from '../../computador-do-agente/modulos/navegador-do-pc.ts';

// deno-lint-ignore no-explicit-any
type Banco = any;

const UUID = z.string().uuid();
const BUCKET = 'mesa';

function exigirEquipe(ctx: AuthContext) {
  if (!ctx.dataScope?.unrestricted) throw new Error('somente_equipe: o navegador do PC usa os logins do dono; só a credencial da equipe (chave irrestrita) pede.');
}

function erroDeEntrada(e: z.ZodError): Error {
  return new Error(`Invalid input: ${e.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')}`);
}

/** Resposta do PC desligado: clara, sem fila, e o agente não insiste. */
export function respostaIndisponivel(extra: Record<string, unknown> = {}) {
  return { disponivel: false, codigo: CODIGO_PC_INDISPONIVEL, mensagem: MENSAGEM_PC_INDISPONIVEL, nao_insistir: true, repetir: false, ...extra };
}

/** Janela do Ego das secrets da função (EGO_HORARIO, EGO_DIAS, EGO_FUSO); sem elas, 9h–18h seg a sex. */
export function janelaDaFuncao(): JanelaDoEgo {
  return lerJanelaDoEgo((n) => {
    try {
      return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(n);
    } catch {
      return undefined;
    }
  });
}

/** Resposta do pedido aceito fora do horário: agendado, o agente não insiste. */
export function respostaAgendada(pedidoId: string | null, abreMs: number, j: JanelaDoEgo, extra: Record<string, unknown> = {}) {
  return {
    ...(pedidoId ? { pedido_id: pedidoId } : {}),
    estado: 'agendada',
    codigo: CODIGO_FORA_DO_HORARIO,
    agendado_para: new Date(abreMs).toISOString(),
    agendado_para_local: rotuloLocal(abreMs, j),
    horario_do_ego: descreverJanelaDoEgo(j),
    consultar_depois_de: new Date(abreMs + 5 * 60_000).toISOString(),
    nao_insistir: true,
    repetir: false,
    mensagem: mensagemAgendado(abreMs, j),
    ...extra,
  };
}

export async function estadoDoPc(banco: Banco, agora = Date.now()) {
  const { data } = await banco.from('computador_executores').select('nome, visto_em, casos').contains('casos', [CASO_DO_PC]);
  const { data: rodando } = await banco
    .from('agente_computador_tarefas')
    .select('id')
    .eq('caso', CASO_DO_PC)
    .eq('estado', 'executando')
    .gt('trava_ate', new Date(agora).toISOString())
    .limit(1);
  return pcDisponivel((data ?? []) as never, agora, ((rodando ?? []) as unknown[]).length > 0);
}

const ROTULO_DO_ESTADO: Record<string, string> = {
  aprovada: 'na_fila',
  executando: 'executando',
  feita: 'feita',
  falhou: 'falhou',
  cancelada: 'cancelada',
};

/** Lê o pedido; fila parada com o PC sem sinal (ou há mais de 3 min) vira "indisponível" e sai da fila. */
export async function resultadoDoPedido(banco: Banco, pedidoId: string, agora = Date.now(), janela: JanelaDoEgo = janelaDaFuncao()) {
  const { data } = await banco
    .from('agente_computador_tarefas')
    .select('id, caso, estado, motivo, resultado, provas, criado_em, iniciado_em, terminado_em, executar_a_partir_de, prioridade')
    .eq('id', pedidoId)
    .eq('caso', CASO_DO_PC)
    .maybeSingle();
  if (!data) throw new Error('nao_encontrado: pedido do navegador do PC não encontrado.');
  const t = data as { id: string; estado: string; motivo: string | null; resultado: Record<string, unknown> | null; provas: Array<{ storage_path: string; legenda: string }>; criado_em: string; executar_a_partir_de?: string | null };
  const agoraIso = new Date(agora).toISOString();
  if (t.estado === 'aprovada' && t.executar_a_partir_de) {
    const abre = new Date(t.executar_a_partir_de).getTime();
    // Agendado e ainda não deu a hora: espera, sem cancelar e sem o agente insistir.
    if (abre > agora) return respostaAgendada(t.id, abre, janela);
    // Deu a hora e a janela daquele dia fechou sem o PC pegar: sai com motivo claro (nada fica parado).
    if (agora >= fimDaJanelaDoDia(abre, janela)) {
      await banco
        .from('agente_computador_tarefas')
        .update({ estado: 'cancelada', motivo: MENSAGEM_AGENDADO_NAO_RODOU, terminado_em: agoraIso, atualizado_em: agoraIso })
        .eq('id', t.id)
        .eq('estado', 'aprovada');
      return { pedido_id: t.id, estado: 'cancelada', codigo: CODIGO_PC_INDISPONIVEL, motivo: MENSAGEM_AGENDADO_NAO_RODOU, nao_insistir: true, repetir: false };
    }
    // Janela aberta: o worker pega por ordem de prioridade; sem o corte dos 3 min.
    return { pedido_id: t.id, estado: 'na_fila', agendado: true, disponivel: true, consultar_em_s: 30 };
  }
  if (t.estado === 'aprovada' && !dentroDaJanelaDoEgo(agora, janela)) {
    // Pedido do fim da janela que o PC não pegou a tempo: vai para a próxima abertura em vez de cancelar.
    const abre = proximaAberturaDoEgo(agora, janela);
    await banco
      .from('agente_computador_tarefas')
      .update({ executar_a_partir_de: new Date(abre).toISOString(), atualizado_em: agoraIso })
      .eq('id', t.id)
      .eq('estado', 'aprovada');
    return respostaAgendada(t.id, abre, janela);
  }
  if (t.estado === 'aprovada') {
    const parado = (agora - new Date(t.criado_em).getTime()) / 1000;
    const pc = await estadoDoPc(banco, agora);
    if (!pc.disponivel || parado > ESPERA_NA_FILA_S) {
      await banco
        .from('agente_computador_tarefas')
        .update({ estado: 'cancelada', motivo: MENSAGEM_PC_INDISPONIVEL, terminado_em: agoraIso, atualizado_em: agoraIso })
        .eq('id', t.id)
        .eq('estado', 'aprovada');
      return respostaIndisponivel({ pedido_id: t.id, estado: 'cancelada' });
    }
    return { pedido_id: t.id, estado: 'na_fila', disponivel: true, consultar_em_s: 15 };
  }
  if (t.estado === 'executando') return { pedido_id: t.id, estado: 'executando', consultar_em_s: 15 };
  const prints: Array<{ legenda: string; url: string | null }> = [];
  for (const p of (t.provas ?? []).slice(0, 14)) {
    const { data: assinado } = await banco.storage.from(BUCKET).createSignedUrl(p.storage_path, 3600).catch(() => ({ data: null }));
    prints.push({ legenda: p.legenda, url: assinado?.signedUrl ?? null });
  }
  const r = t.resultado ?? {};
  const texto = typeof r.texto === 'string' ? (r.texto as string).slice(0, 8000) : null;
  return {
    pedido_id: t.id,
    estado: ROTULO_DO_ESTADO[t.estado] ?? t.estado,
    motivo: t.motivo,
    motor: r.motor ?? 'ego',
    url_final: r.url_final ?? null,
    titulo: r.titulo ?? null,
    passos: r.passos_feitos ?? [],
    texto,
    parou: r.parou ?? null,
    prints,
    ...(t.estado === 'cancelada' && (t.motivo === MENSAGEM_PC_INDISPONIVEL || t.motivo === MENSAGEM_AGENDADO_NAO_RODOU) ? { codigo: CODIGO_PC_INDISPONIVEL, nao_insistir: true } : {}),
  };
}

const PASSO = z.object({
  acao: z.enum(ACOES_DO_PC),
  url: z.string().max(2000).optional(),
  texto: z.string().max(160).optional(),
  seletor: z.string().max(300).optional(),
  campo: z.string().max(120).optional(),
  valor: z.string().max(500).optional(),
  enviar: z.boolean().optional(),
  inteira: z.boolean().optional(),
  dy: z.number().optional(),
  ms: z.number().optional(),
}).strict();

const ENTRADA = z.object({
  acao: z.enum(['estado', 'pedir', 'resultado', 'parar']),
  client_id: UUID.optional(),
  url: z.string().max(2000).optional(),
  passos: z.array(PASSO).max(12).optional(),
  objetivo: z.string().max(500).optional(),
  aprovacao_id: UUID.optional(),
  pedido_id: UUID.optional(),
  prioridade: z.enum(['alta', 'normal', 'baixa']).optional(),
}).strict();

export async function executarNavegadorDoPc(banco: Banco, ctx: AuthContext, input: unknown, agora = Date.now(), janela: JanelaDoEgo = janelaDaFuncao()) {
  exigirEquipe(ctx);
  const p = ENTRADA.safeParse(input ?? {});
  if (!p.success) throw erroDeEntrada(p.error);
  const d = p.data;
  const naJanela = dentroDaJanelaDoEgo(agora, janela);
  if (d.acao === 'estado') {
    if (!naJanela) {
      const abre = proximaAberturaDoEgo(agora, janela);
      return {
        disponivel: false,
        fora_do_horario: true,
        agendavel: true,
        codigo: CODIGO_FORA_DO_HORARIO,
        horario_do_ego: descreverJanelaDoEgo(janela),
        proxima_abertura: new Date(abre).toISOString(),
        proxima_abertura_local: rotuloLocal(abre, janela),
        nao_insistir: true,
        repetir: false,
        mensagem: `Fora do horário do Ego (${descreverJanelaDoEgo(janela)}). Peça mesmo assim com acao "pedir": fica agendado para ${rotuloLocal(abre, janela)} e o resultado fica guardado. Enquanto isso, trabalhe na nuvem.`,
      };
    }
    const pc = await estadoDoPc(banco, agora);
    return pc.disponivel
      ? { disponivel: true, executor: pc.executor, visto_ha_s: pc.visto_ha_s, horario_do_ego: descreverJanelaDoEgo(janela) }
      : respostaIndisponivel({ executor: pc.executor, visto_ha_s: pc.visto_ha_s });
  }
  if (d.acao === 'resultado') {
    if (!d.pedido_id) throw new Error('Invalid input: pedido_id é obrigatório em resultado.');
    return await resultadoDoPedido(banco, d.pedido_id, agora, janela);
  }
  if (d.acao === 'parar') {
    if (!d.pedido_id) throw new Error('Invalid input: pedido_id é obrigatório em parar.');
    const { data } = await banco
      .from('agente_computador_tarefas')
      .update({ estado: 'cancelada', motivo: 'Parado pelo agente.', terminado_em: new Date(agora).toISOString(), atualizado_em: new Date(agora).toISOString() })
      .eq('id', d.pedido_id)
      .eq('caso', CASO_DO_PC)
      .in('estado', ['aprovada', 'executando'])
      .select('id');
    return { pedido_id: d.pedido_id, parado: ((data ?? []) as unknown[]).length > 0 };
  }
  // pedir
  const n = normalizarPedidoDoPc({ url: d.url, passos: d.passos, objetivo: d.objetivo });
  if (n.ok === false) throw new Error(`entrada_invalida: ${n.erro}`);
  const pedido = n.pedido;
  let autorizado = false;
  if (pedido.sensiveis.length) {
    if (!d.aprovacao_id || !(await aprovacaoValida(banco, d.aprovacao_id))) {
      const lista = pedido.sensiveis.map((i) => i + 1).join(', ');
      throw new Error(`precisa_aprovacao: o(s) passo(s) ${lista} mudam a conta (publicar, enviar, pagar, salvar, apagar, ativar, pausar ou digitar fora de busca). Peça com aceleriq_operator_request_approval e mande o aprovacao_id aprovado. Nada foi pedido ao PC.`);
    }
    autorizado = true;
  }
  // Fora do horário: não confere o PC (pode estar desligado à noite); agenda para a próxima abertura.
  const abre = naJanela ? null : proximaAberturaDoEgo(agora, janela);
  const pc = naJanela ? await estadoDoPc(banco, agora) : null;
  if (pc && !pc.disponivel) return respostaIndisponivel({ executor: pc.executor, visto_ha_s: pc.visto_ha_s });
  const dono = ctx.dataScope?.principalUserId;
  if (!dono) throw new Error('somente_equipe: a credencial não tem dono; o pedido ao PC precisa de quem autoriza.');
  const passos = pedido.passos.map((x, i) => (pedido.sensiveis.indexOf(i) >= 0 && autorizado ? { ...x, autorizado: true, aprovacao_id: d.aprovacao_id } : x));
  const host = (() => {
    try {
      return new URL(pedido.url_inicial).hostname;
    } catch {
      return 'site';
    }
  })();
  const agoraIso = new Date(agora).toISOString();
  const { data, error } = await banco
    .from('agente_computador_tarefas')
    .insert({
      client_id: d.client_id ?? null,
      titulo: `Navegador do PC: ${host}`.slice(0, 140),
      app: 'navegador',
      caso: CASO_DO_PC,
      passos,
      irreversivel: autorizado,
      url_inicial: pedido.url_inicial,
      dominios: pedido.dominios,
      objetivo: pedido.objetivo || null,
      origem: 'mcp',
      teto_passos: tetoDePassosDoPc(passos.length),
      teto_custo_usd: 0,
      estado: 'aprovada',
      criado_por: dono,
      aprovado_por: dono,
      aprovado_em: agoraIso,
      prioridade: PRIORIDADES_DO_PC[d.prioridade ?? 'normal'],
      ...(abre !== null ? { executar_a_partir_de: new Date(abre).toISOString() } : {}),
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`falha_ao_pedir: ${error?.message ?? 'sem id'}`);
  if (abre !== null) return respostaAgendada((data as { id: string }).id, abre, janela, { prioridade: d.prioridade ?? 'normal' });
  return {
    pedido_id: (data as { id: string }).id,
    estado: 'na_fila',
    disponivel: true,
    executor: pc?.executor ?? null,
    consultar_em_s: 15,
    como_seguir: 'Chame aceleriq_navegador_do_pc com acao "resultado" e o pedido_id a cada 15 a 30 s até feita, falhou ou cancelada.',
  };
}

export const navegadorDoPcTool: ToolDefinition = {
  name: 'aceleriq_navegador_do_pc',
  title: 'Navegador do PC do dono (Ego, com os logins dele)',
  description:
    'Usa o navegador Ego do PC do dono, já logado no gerenciador de anúncios da Meta, Instagram, Facebook, Google, YouTube, TikTok e LinkedIn: sem senha, sem código e sem pedir ao dono. Só funciona com o PC ligado. '
    + 'acao "estado": o PC está disponível? acao "pedir": manda os passos (o primeiro é navegar com a url; depois ler, capturar, clicar com texto ou seletor, digitar com campo e valor, rolar, esperar; até 12) e recebe pedido_id. '
    + 'acao "resultado" com pedido_id (a cada 15 a 30 s): estado, texto lido da página, URL, prints. acao "parar" cancela. '
    + 'Ler e navegar são livres. Clicar em publicar, enviar, pagar, salvar, apagar, ativar ou pausar e digitar fora de busca só com aprovacao_id aprovado (aceleriq_operator_request_approval). '
    + 'Resposta disponivel=false com codigo navegador_do_pc_indisponivel: o PC está desligado; NÃO repita, siga com outra tarefa. parou.codigo sessao_expirada: o dono precisa entrar de novo naquele site no Ego. '
    + 'Horário comercial: o Ego só roda das 9h às 18h, seg a sex (São Paulo). Fora disso, "pedir" responde na hora estado "agendada" com agendado_para e nao_insistir=true: roda na abertura por prioridade (alta, normal, baixa) e o resultado fica guardado; siga com o trabalho de nuvem e leia o resultado depois de agendado_para.',
  scopes: ['aceleriq:write'],
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: true },
  inputSchema: {
    type: 'object',
    properties: {
      acao: { type: 'string', enum: ['estado', 'pedir', 'resultado', 'parar'], description: 'O que fazer.' },
      client_id: { type: 'string', description: 'UUID do cliente da conta (opcional; fica no registro).' },
      url: { type: 'string', description: 'Atalho: vira o primeiro passo (navegar).' },
      passos: {
        type: 'array',
        maxItems: 12,
        description: 'Passos em ordem. Ex.: [{"acao":"navegar","url":"https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123"},{"acao":"ler"}].',
        items: {
          type: 'object',
          properties: {
            acao: { type: 'string', enum: [...ACOES_DO_PC] },
            url: { type: 'string', description: 'navegar: https, só nos sites da lista.' },
            texto: { type: 'string', description: 'clicar: texto visível do botão ou link.' },
            seletor: { type: 'string', description: 'clicar ou digitar: seletor CSS (opcional).' },
            campo: { type: 'string', description: 'digitar: rótulo do campo.' },
            valor: { type: 'string', description: 'digitar: o texto (nunca senha, código ou e-mail).' },
            enviar: { type: 'boolean', description: 'digitar: aperta Enter no fim.' },
            inteira: { type: 'boolean', description: 'ler: a página inteira, não só a parte visível.' },
            dy: { type: 'number', description: 'rolar: pixels (negativo sobe).' },
            ms: { type: 'number', description: 'esperar: milissegundos (até 10000).' },
          },
          required: ['acao'],
          additionalProperties: false,
        },
      },
      objetivo: { type: 'string', description: 'Para que serve o pedido (fica no registro).' },
      aprovacao_id: { type: 'string', description: 'UUID da aprovação aprovada, para passo que muda a conta.' },
      pedido_id: { type: 'string', description: 'Para resultado e parar.' },
      prioridade: { type: 'string', enum: ['alta', 'normal', 'baixa'], description: 'Ordem dos pedidos agendados quando o horário do Ego abre (padrão normal).' },
    },
    required: ['acao'],
    additionalProperties: false,
  },
  handler: async (input, ctx) => await executarNavegadorDoPc(db(), ctx, input),
};
