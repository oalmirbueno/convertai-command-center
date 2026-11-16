/**
 * Erros do Estúdio (16/11/2026): quais lâminas da fila de geração deram erro,
 * por quê, e se o erro já foi resolvido depois.
 *
 * O panorama da casa mostra "estudio_fila: erro N" (contagem dos últimos 7
 * dias), mas nenhuma tela dizia quais eram nem o motivo. Este módulo é a
 * leitura única, usada pelos dois lados:
 *   - MCP: aceleriq_estudio_erros (painel-leituras.ts), com o banco do servidor;
 *   - painel: botão "Ver erros (N)" na faixa do Estúdio da Mesa
 *     (src/lib/mesa/errosDoEstudio.ts), com o login da pessoa (RLS da equipe:
 *     is_staff + can_access_client, a mesma que já lê a fila).
 *
 * Sem import e sem Deno/Vite: roda nos dois. Nada escreve.
 *
 * - resolvido_depois: existe linha 'feito' do mesmo trabalho criada depois do erro
 *   (outra rodada de geração da peça deu certo).
 * - orfao: a linha não tem cliente, o trabalho não existe mais (ou não é
 *   visível), o trabalho é de outro cliente ou o cliente não existe.
 * - A janela é a mesma do panorama: desde 00:00 UTC do dia (São Paulo) de N
 *   dias atrás, para a lista bater com a contagem.
 */

type Objeto = Record<string, unknown>;
// deno-lint-ignore no-explicit-any
export type BancoDeLeitura = { from: (tabela: string) => any };

export const DIAS_PADRAO = 7;
export const DIAS_MAXIMO = 30;
export const LIMITE_PADRAO = 50;
export const LIMITE_MAXIMO = 100;

export interface ErroDoEstudio {
  id: string;
  client_id: string | null;
  cliente: string | null;
  trabalho_id: string | null;
  /** Título curto da peça: legenda ou direcao.conceito, cortado. */
  titulo: string | null;
  tipo: string | null;
  ordem: number | null;
  etapa: string | null;
  tentativas: number;
  max_tentativas: number | null;
  erro_codigo: string | null;
  /** O motivo em pt-BR simples (traduzido do código e da mensagem do gerador). */
  erro_mensagem: string;
  /** O texto que o gerador gravou, cortado e sem nada com cara de chave. */
  erro_original: string | null;
  criado_em: string;
  concluido_em: string | null;
  resolvido_depois: boolean;
  resolvido_em: string | null;
  orfao: boolean;
  motivo_orfao: string | null;
}

export interface ResumoDosErros {
  total: number;
  pendentes: number;
  resolvidos: number;
  orfaos: number;
  por_codigo: Record<string, number>;
}

export interface LeituraDosErros {
  desde: string;
  dias: number;
  client_id: string | null;
  itens: ErroDoEstudio[];
  resumo: ResumoDosErros;
  /** Há mais erros na janela do que o limite trouxe. */
  mais: boolean;
}

// ─── Tradução ──────────────────────────────────────────────────

const MOTIVOS: Record<string, string> = {
  saldo_insuficiente: 'A carteira de IA do cliente ficou sem saldo. Recarregue e gere de novo.',
  cota_da_chave_esgotada: 'A cota do mês da chave de IA do cliente acabou. Ajuste em Chaves e cotas.',
  cliente_sem_chave: 'O cliente não tem chave de IA própria e não está liberado para usar a da agência.',
  provedor_sem_chave: 'O provedor de IA escolhido ainda não tem chave configurada.',
  sem_modelo: 'Nenhum modelo de IA ativo para gerar arte. Um admin precisa ativar em Modelos de IA.',
  modelo_padrao_ausente: 'Falta o modelo padrão de arte configurado.',
  tentativas_esgotadas: 'A lâmina falhou em todas as tentativas automáticas (o servidor caiu no meio). Gere de novo.',
  abandonado: 'A geração ficou parada tempo demais e foi encerrada. Gere de novo.',
  passos_esgotados: 'A lâmina passou do limite de passos na fila. Gere de novo.',
  erro_interno: 'O gerador falhou no meio do caminho. Gere de novo; se repetir, avise.',
  falha_interna: 'O gerador falhou no meio do caminho. Gere de novo; se repetir, avise.',
  funcao_interrompida: 'A função parou no meio (limite do servidor). Gere de novo.',
  servico_indisponivel: 'O Estúdio não respondeu na hora (pode estar sendo publicado). Tente de novo.',
  acesso_indisponivel: 'Não deu para conferir o acesso ao cliente na hora. Tente de novo.',
  trabalho_indisponivel: 'Não deu para ler a peça no banco na hora. Tente de novo.',
  arquivo_indisponivel: 'Não deu para ler um arquivo da peça (logo, foto ou referência).',
  banco_indisponivel: 'O banco não respondeu na hora. Tente de novo.',
  gravacao_falhou: 'A arte saiu, mas não foi gravada na peça. Gere de novo.',
  armazenamento_falhou: 'Não deu para guardar a imagem no armazenamento.',
  registro_de_arquivo_falhou: 'A imagem foi guardada, mas o registro do arquivo falhou.',
  envio_de_arquivo_falhou: 'O envio do arquivo falhou.',
  imagem_invalida: 'Uma imagem usada na peça está num formato que o gerador não aceita.',
  imagem_grande_demais: 'Uma imagem usada na peça é grande demais.',
  referencia_sem_arquivo: 'A referência escolhida não tem mais arquivo.',
  referencia_inexistente: 'A referência escolhida não existe mais.',
  logo_invalida: 'A logo do cliente está num formato inválido.',
  rosto_indisponivel: 'A foto do rosto do cliente não está disponível.',
  trabalho_sem_direcao: 'A peça ainda não tinha direção de arte. Prepare a direção antes de gerar.',
  trabalho_sem_item: 'A peça perdeu a ligação com a pauta.',
  card_sem_versao: 'A lâmina não tem versão para conferir ou corrigir.',
  laminas_em_outro_formato: 'As lâminas estão em outro formato do que o pedido.',
  prompt_indisponivel: 'As instruções do gerador não carregaram.',
  nao_autorizado: 'Quem pediu não tinha mais permissão para este cliente (ou o login venceu).',
  somente_admin: 'Só admin pode fazer esta ação.',
  entrada_invalida: 'Faltou algum dado da peça ou um valor veio fora do esperado.',
  fundo_pendente: 'O fundo contínuo não ficou pronto a tempo.',
  fundo_em_andamento: 'O fundo contínuo não ficou pronto a tempo.',
  capa_pendente: 'A capa não ficou pronta a tempo.',
  cancelado_pela_equipe: 'Parado pela equipe.',
  jev_indisponivel: 'O assistente de arte não respondeu.',
};

/** Tira o que tem cara de chave ou token e corta. */
export function limparMensagem(v: unknown, max = 300): string | null {
  if (typeof v !== 'string') return null;
  const t = v
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[oculto]')
    .replace(/\b(sk|pk|rk)[-_][A-Za-z0-9_-]{10,}/g, '[oculto]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+){0,2}/g, '[oculto]')
    .replace(/([?&](key|token|apikey|api_key|signature|sig)=)[^&\s]+/gi, '$1[oculto]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Padrões da mensagem crua do provedor (código genérico). */
const PADROES: Array<[RegExp, string]> = [
  [/timed? ?out|timeout|abort|deadline|demorou/i, 'O gerador demorou demais e a chamada caiu. Gere de novo.'],
  [/\b429\b|rate.?limit|too many requests|excesso de pedidos/i, 'O provedor de IA recusou por excesso de pedidos. Tente daqui a pouco.'],
  [/safety|moderat|content.?policy|policy violation|bloquead/i, 'O provedor de IA recusou a imagem pela política de conteúdo. Ajuste a direção da lâmina.'],
  [/memory|mem[óo]ria/i, 'A função ficou sem memória no meio da geração. Gere de novo.'],
  [/\b5\d\d\b|bad gateway|service unavailable|unavailable/i, 'O provedor de IA estava fora do ar na hora. Tente de novo.'],
  [/quota|insufficient|billing|cr[ée]dito/i, 'O provedor de IA recusou por falta de crédito ou cota.'],
];

/** O motivo do erro em pt-BR simples. */
export function traduzirErroDoEstudio(codigo: unknown, mensagem: unknown): string {
  const c = typeof codigo === 'string' ? codigo.trim() : '';
  if (c && MOTIVOS[c]) return MOTIVOS[c];
  const m = limparMensagem(mensagem, 200);
  if (m) {
    for (const [re, texto] of PADROES) if (re.test(m)) return texto;
    // A mensagem do Estúdio já costuma vir em português: segue como veio, limpa.
    return m;
  }
  return c ? `Falhou sem motivo registrado (código ${c}).` : 'Falhou sem motivo registrado.';
}

// ─── Peça ──────────────────────────────────────────────────────

export function cortarTexto(v: unknown, max = 80): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Título curto: a legenda (primeira linha) ou o conceito da direção. */
export function tituloDaPeca(t: { legenda?: unknown; conceito?: unknown } | null | undefined, max = 80): string | null {
  if (!t) return null;
  const legenda = typeof t.legenda === 'string' ? t.legenda.split('\n').map((l) => l.trim()).find(Boolean) : undefined;
  return cortarTexto(legenda, max) ?? cortarTexto(t.conceito, max);
}

// ─── Janela ────────────────────────────────────────────────────

export function limitarDias(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < 1) return DIAS_PADRAO;
  return Math.min(n, DIAS_MAXIMO);
}

export function limitarQuantos(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!isFinite(n) || n < 1) return LIMITE_PADRAO;
  return Math.min(n, LIMITE_MAXIMO);
}

/** Mesmo corte do panorama da casa: 00:00 UTC do dia de São Paulo, N dias atrás. */
export function inicioDaJanela(dias: number, agora = new Date()): string {
  const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora);
  const d = new Date(`${hoje}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return `${d.toISOString().slice(0, 10)}T00:00:00Z`;
}

// ─── Montagem ──────────────────────────────────────────────────

const texto = (v: unknown) => (typeof v === 'string' && v ? v : null);
const numeroOuNulo = (v: unknown) => (v === null || v === undefined || v === '' || !isFinite(Number(v)) ? null : Number(v));
const tempo = (v: unknown) => {
  const n = typeof v === 'string' ? Date.parse(v) : NaN;
  return isFinite(n) ? n : NaN;
};

export function montarErrosDoEstudio(entrada: {
  erros: Objeto[];
  feitos: Objeto[];
  trabalhos: Objeto[];
  clientes: Objeto[];
}): ErroDoEstudio[] {
  const trabalhos = new Map(entrada.trabalhos.map((t) => [String(t.id), t]));
  const clientes = new Map(entrada.clientes.map((c) => [String(c.id), c]));
  const feitosPorTrabalho = new Map<string, number[]>();
  for (const f of entrada.feitos) {
    const k = texto(f.trabalho_id);
    const quando = tempo(f.criado_em);
    if (!k || !isFinite(quando)) continue;
    const l = feitosPorTrabalho.get(k) ?? [];
    l.push(quando);
    feitosPorTrabalho.set(k, l);
  }
  for (const l of feitosPorTrabalho.values()) l.sort((a, b) => a - b);

  return entrada.erros.map((e) => {
    const clientId = texto(e.client_id);
    const trabalhoId = texto(e.trabalho_id);
    const t = trabalhoId ? trabalhos.get(trabalhoId) : undefined;
    const c = clientId ? clientes.get(clientId) : undefined;
    const criado = tempo(e.criado_em);
    const depois = trabalhoId && isFinite(criado) ? (feitosPorTrabalho.get(trabalhoId) ?? []).find((q) => q > criado) : undefined;
    let motivoOrfao: string | null = null;
    if (!clientId) motivoOrfao = 'sem cliente';
    else if (!trabalhoId || !t) motivoOrfao = 'trabalho inexistente';
    else if (texto(t.client_id) && texto(t.client_id) !== clientId) motivoOrfao = 'trabalho de outro cliente';
    else if (!c) motivoOrfao = 'cliente inexistente';
    // Trabalho de outro cliente: nada dele sai (título, tipo), só a marca de órfão.
    const doMesmoCliente = !!t && motivoOrfao !== 'trabalho de outro cliente';
    return {
      id: String(e.id),
      client_id: clientId,
      cliente: c ? cortarTexto(c.company_name, 60) ?? cortarTexto(c.full_name, 60) ?? 'Cliente' : null,
      trabalho_id: trabalhoId,
      titulo: doMesmoCliente ? tituloDaPeca(t as { legenda?: unknown; conceito?: unknown }) : null,
      tipo: doMesmoCliente ? texto((t as Objeto).tipo) : null,
      ordem: numeroOuNulo(e.ordem),
      etapa: texto(e.etapa),
      tentativas: numeroOuNulo(e.tentativas) ?? 0,
      max_tentativas: numeroOuNulo(e.max_tentativas),
      erro_codigo: texto(e.erro_codigo),
      erro_mensagem: traduzirErroDoEstudio(e.erro_codigo, e.erro_mensagem),
      erro_original: limparMensagem(e.erro_mensagem),
      criado_em: String(e.criado_em ?? ''),
      concluido_em: texto(e.concluido_em),
      resolvido_depois: depois !== undefined,
      resolvido_em: depois !== undefined ? new Date(depois).toISOString() : null,
      orfao: motivoOrfao !== null,
      motivo_orfao: motivoOrfao,
    };
  });
}

export function resumirErros(itens: ErroDoEstudio[]): ResumoDosErros {
  const por_codigo: Record<string, number> = {};
  let resolvidos = 0;
  let orfaos = 0;
  for (const i of itens) {
    if (i.resolvido_depois) resolvidos++;
    if (i.orfao) orfaos++;
    const k = i.erro_codigo ?? 'sem_codigo';
    por_codigo[k] = (por_codigo[k] ?? 0) + 1;
  }
  return { total: itens.length, pendentes: itens.length - resolvidos, resolvidos, orfaos, por_codigo };
}

// ─── Leitura ───────────────────────────────────────────────────

export const COLUNAS_DO_ERRO = 'id, client_id, trabalho_id, lote_id, ordem, etapa, tentativas, max_tentativas, erro_codigo, erro_mensagem, aviso, criado_em, atualizado_em, concluido_em';

type Resposta = { data: unknown; error: { code?: string; message?: string } | null };

function falhou(tabela: string, error: { code?: string; message?: string }): Error {
  return Object.assign(new Error(`${tabela}: ${error.message ?? 'falha na leitura'}`), { code: error.code });
}

const linhasDe = (r: Resposta, tabela: string): Objeto[] => {
  if (r.error) throw falhou(tabela, r.error);
  return Array.isArray(r.data) ? (r.data as Objeto[]) : [];
};

/**
 * Lê os erros da janela (um cliente ou todos os que o banco deixa ver) e monta a lista.
 * Quatro leituras pequenas: erros, rodadas 'feito' dos mesmos trabalhos, os trabalhos e os clientes.
 */
export async function lerErrosDoEstudio(
  b: BancoDeLeitura,
  opcoes: { clientId?: string | null; dias?: number; limite?: number; agora?: Date } = {},
): Promise<LeituraDosErros> {
  const dias = limitarDias(opcoes.dias ?? DIAS_PADRAO);
  const limite = limitarQuantos(opcoes.limite ?? LIMITE_PADRAO);
  const desde = inicioDaJanela(dias, opcoes.agora);
  const clientId = opcoes.clientId || null;

  let q = b.from('estudio_fila').select(COLUNAS_DO_ERRO).eq('status', 'erro').gte('criado_em', desde);
  if (clientId) q = q.eq('client_id', clientId);
  const todos = linhasDe(await q.order('criado_em', { ascending: false }).limit(limite + 1), 'estudio_fila');
  const mais = todos.length > limite;
  const erros = todos.slice(0, limite);
  if (!erros.length) return { desde, dias, client_id: clientId, itens: [], resumo: resumirErros([]), mais: false };

  const trabalhoIds = [...new Set(erros.map((e) => texto(e.trabalho_id)).filter((x): x is string => !!x))];
  const clienteIds = [...new Set(erros.map((e) => texto(e.client_id)).filter((x): x is string => !!x))];
  const maisAntigo = erros.reduce((m, e) => (String(e.criado_em) < m ? String(e.criado_em) : m), String(erros[0].criado_em));

  const vazio = Promise.resolve({ data: [], error: null } as Resposta);
  const [feitos, trabalhos, clientes] = await Promise.all([
    trabalhoIds.length
      ? b.from('estudio_fila').select('trabalho_id, criado_em').eq('status', 'feito').in('trabalho_id', trabalhoIds).gte('criado_em', maisAntigo).limit(3000)
      : vazio,
    trabalhoIds.length
      ? (() => {
        const t = b.from('estudio_trabalhos').select('id, client_id, tipo, legenda, conceito:direcao->>conceito').in('id', trabalhoIds);
        // Com cliente escolhido, nem lê trabalho de outro cliente (a linha vira órfã).
        return clientId ? t.eq('client_id', clientId) : t;
      })()
      : vazio,
    clienteIds.length ? b.from('profiles').select('id, company_name, full_name').in('id', clienteIds) : vazio,
  ]);

  const itens = montarErrosDoEstudio({
    erros,
    feitos: linhasDe(feitos, 'estudio_fila'),
    trabalhos: linhasDe(trabalhos, 'estudio_trabalhos'),
    clientes: linhasDe(clientes, 'profiles'),
  });
  return { desde, dias, client_id: clientId, itens, resumo: resumirErros(itens), mais };
}
