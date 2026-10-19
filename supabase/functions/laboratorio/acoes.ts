/**
 * laboratorio: as ações do contrato (ESPEC-LABORATORIO.md, "Função de borda laboratorio").
 */
import { chamarTexto, cobrarJev, type ImagemEntrada, type MensagemMotor, type Qualidade } from "../_shared/ia-motor.ts";
import {
  type Chamador,
  carteiraDe,
  emSegundoPlano,
  erroDoBanco,
  ErroHttp,
  garantirAcesso,
  idDe,
  idOuNulo,
  json,
  limpo,
  marcaEmTexto,
  nomeDoCliente,
  servico,
  TAREFA,
} from "./comum.ts";
import {
  atualizarExecucao,
  criarExecucao,
  type Contexto,
  estimarCanvas,
  gerarLogos,
  portaDoNoAr,
  precificador,
  type ProjetoDoLab,
  rodarNo,
  rodarTudo,
  seguirRodada,
} from "./executar.ts";
import { acompanharFilme, chamadorDaMesaMotion, escolherStoryboard, type SaidaDoFilme } from "./filme.ts";
import { acompanharNoAr, type SaidaDoNoAr } from "./no-ar.ts";
import { perguntasGuiadas, type ResultadoDasPerguntas } from "./perguntas.ts";
import {
  aplicarOperacoes,
  arred,
  canvasValido,
  canvasVazio,
  type Chamada,
  ehExecutavel,
  ehPedidoDeProjetoCompleto,
  ErroDoCanvas,
  ESQUEMA_DO_PLANEJAR,
  lerPlano,
  limitar,
  MAX_LOGOS,
  MODELO_IMAGEM_PADRAO,
  MODELO_TEXTO_PADRAO,
  NOS_LONGOS,
  normalizarCanvas,
  ordemTopologica,
  qualidadeValida,
  resolverBloco,
  resumoDoCanvas,
  SAIDA_ESPERADA,
} from "./modulos/regras.ts";
import { BLOCO_DO_PROJETO_COMPLETO, SISTEMA_DO_PLANEJAR } from "./modulos/prompts.ts";
import { BUCKET, lerImagem } from "./workspace.ts";

type Corpo = Record<string, unknown>;
export type Acao = (ch: Chamador, corpo: Corpo) => Promise<Response>;

const CAMPOS = "id, nome, client_id, contexto, canvas, versao, status, template_de, created_by, created_at, updated_at";

function projetoDaLinha(v: unknown): ProjetoDoLab {
  const o = v as Record<string, unknown>;
  return {
    id: String(o.id),
    nome: String(o.nome ?? ""),
    client_id: typeof o.client_id === "string" ? o.client_id : null,
    contexto: typeof o.contexto === "string" ? o.contexto : null,
    canvas: normalizarCanvas(o.canvas),
    versao: Number(o.versao) || 1,
    status: String(o.status ?? "ativo"),
    template_de: typeof o.template_de === "string" ? o.template_de : null,
    created_by: typeof o.created_by === "string" ? o.created_by : null,
    created_at: String(o.created_at ?? ""),
    updated_at: String(o.updated_at ?? ""),
  };
}

/** Lê o projeto e confere o acesso ao cliente dele (projeto livre: toda a equipe do Laboratório). */
async function lerProjeto(ch: Chamador, id: unknown): Promise<ProjetoDoLab> {
  const projetoId = idDe(id, "projeto_id");
  const { data, error } = await servico().from("lab_projetos").select(CAMPOS).eq("id", projetoId).maybeSingle();
  if (error) throw erroDoBanco(error, "projeto_indisponivel", "Não consegui ler o projeto agora.");
  if (!data) throw new ErroHttp(404, "projeto_inexistente", "Projeto do Laboratório não encontrado.");
  const p = projetoDaLinha(data);
  if (p.client_id) await garantirAcesso(ch, p.client_id);
  return p;
}

async function contextoDe(ch: Chamador, p: ProjetoDoLab, rodadaId: string | null = null): Promise<Contexto> {
  const carteira = await carteiraDe(p.client_id);
  return {
    projeto: p,
    canvas: p.canvas,
    carteira,
    marca: await marcaEmTexto(p.client_id),
    nomeDoCliente: p.client_id ? await nomeDoCliente(p.client_id) : null,
    userId: ch.userId,
    token: ch.token,
    rodadaId,
    saidas: new Map(),
  };
}

const confirmado = (corpo: Corpo) => corpo.confirmado === true;

// ------------------------------------------------------------------ projetos

export const projetosListar: Acao = async (ch, corpo) => {
  const clientId = idOuNulo(corpo.client_id, "client_id");
  if (clientId) await garantirAcesso(ch, clientId);
  let q = servico().from("lab_projetos").select("id, nome, client_id, status, versao, template_de, created_by, created_at, updated_at, canvas").order("updated_at", { ascending: false }).limit(200);
  q = corpo.arquivados === true ? q.eq("status", "arquivado") : q.eq("status", "ativo");
  if (clientId) q = q.eq("client_id", clientId);
  else if (corpo.livres === true) q = q.is("client_id", null);
  const busca = limpo(corpo.busca, 80);
  if (busca) q = q.ilike("nome", `%${busca.replace(/[%_]/g, " ")}%`);
  const { data, error } = await q;
  if (error) throw erroDoBanco(error, "projetos_indisponiveis", "Não consegui listar os projetos agora.");
  const linhas = (data || []) as Array<Record<string, unknown>>;
  // Só os projetos de clientes que esta pessoa acessa (o livre é de toda a equipe do Laboratório).
  const clientes = [...new Set(linhas.map((l) => l.client_id).filter((c): c is string => typeof c === "string"))];
  const permitidos = new Set<string>();
  const nomes = new Map<string, string>();
  for (const c of clientes) {
    const { data: pode } = await ch.doChamador.rpc("can_access_client", { _client_id: c });
    if (pode === true) {
      permitidos.add(c);
      nomes.set(c, await nomeDoCliente(c));
    }
  }
  const projetos = linhas
    .filter((l) => !l.client_id || permitidos.has(String(l.client_id)))
    .map((l) => {
      const c = normalizarCanvas(l.canvas);
      return {
        id: l.id,
        nome: l.nome,
        client_id: l.client_id ?? null,
        cliente_nome: l.client_id ? nomes.get(String(l.client_id)) ?? null : null,
        status: l.status,
        versao: l.versao,
        template_de: l.template_de ?? null,
        nos: c.nos.length,
        created_by: l.created_by,
        created_at: l.created_at,
        updated_at: l.updated_at,
      };
    });
  return json({ projetos });
};

async function inserirProjeto(ch: Chamador, o: { nome: string; clientId: string | null; contexto: string | null; canvas: unknown; templateDe: string | null }): Promise<ProjetoDoLab> {
  if (o.clientId) await garantirAcesso(ch, o.clientId);
  const canvas = o.canvas == null ? canvasVazio() : canvasValido(o.canvas);
  const { data, error } = await servico()
    .from("lab_projetos")
    .insert({ nome: o.nome, client_id: o.clientId, contexto: o.contexto, canvas, template_de: o.templateDe, created_by: ch.userId })
    .select(CAMPOS)
    .single();
  if (error || !data) throw erroDoBanco(error, "projeto_nao_criado", "Não consegui criar o projeto agora.");
  return projetoDaLinha(data);
}

export const projetoCriar: Acao = async (ch, corpo) => {
  const nome = limpo(corpo.nome, 120) || "Projeto sem nome";
  const projeto = await inserirProjeto(ch, { nome, clientId: idOuNulo(corpo.client_id, "client_id"), contexto: limpo(corpo.contexto, 8000) || null, canvas: corpo.canvas ?? null, templateDe: null });
  return json({ projeto });
};

export const projetoLer: Acao = async (ch, corpo) => {
  const projeto = await lerProjeto(ch, corpo.projeto_id);
  // A última execução de cada nó (estado por nó na tela).
  const { data } = await servico().from("lab_execucoes").select("*").eq("projeto_id", projeto.id).order("created_at", { ascending: false }).limit(300);
  const ultimas: Record<string, unknown> = {};
  for (const e of (data || []) as Array<Record<string, unknown>>) if (!ultimas[String(e.no_id)]) ultimas[String(e.no_id)] = e;
  return json({ projeto, cliente_nome: projeto.client_id ? await nomeDoCliente(projeto.client_id) : null, execucoes: ultimas });
};

export const projetoSalvar: Acao = async (ch, corpo) => {
  const atual = await lerProjeto(ch, corpo.projeto_id);
  const esperada = Number(corpo.versao_esperada);
  if (!Number.isInteger(esperada)) throw new ErroHttp(400, "versao_esperada_invalida", "Mande versao_esperada (a versão que a tela tem).");
  const patch: Record<string, unknown> = { versao: atual.versao + 1, updated_at: new Date().toISOString() };
  if (corpo.nome !== undefined) patch.nome = limpo(corpo.nome, 120) || atual.nome;
  if (corpo.contexto !== undefined) patch.contexto = limpo(corpo.contexto, 8000) || null;
  if (corpo.canvas !== undefined) patch.canvas = canvasValido(corpo.canvas);
  if (corpo.client_id !== undefined) {
    const novo = idOuNulo(corpo.client_id, "client_id");
    if (novo) await garantirAcesso(ch, novo);
    patch.client_id = novo;
  }
  const { data, error } = await servico().from("lab_projetos").update(patch).eq("id", atual.id).eq("versao", esperada).select(CAMPOS);
  if (error) throw erroDoBanco(error, "projeto_nao_salvo", "Não consegui salvar o projeto agora.");
  const linha = (data || [])[0];
  if (!linha) {
    const agora = await lerProjeto(ch, atual.id);
    throw new ErroHttp(409, "versao_mudou", "Outra pessoa salvou este projeto antes. Recarregue para não perder nada.", { projeto_atual: agora });
  }
  return json({ projeto: projetoDaLinha(linha) });
};

export const projetoArquivar: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const status = corpo.arquivar === false ? "ativo" : "arquivado";
  const { data, error } = await servico().from("lab_projetos").update({ status, updated_at: new Date().toISOString() }).eq("id", p.id).select(CAMPOS).single();
  if (error || !data) throw erroDoBanco(error, "projeto_nao_salvo", "Não consegui arquivar o projeto agora.");
  return json({ projeto: projetoDaLinha(data) });
};

// ------------------------------------------------------------------ templates

export const templatesListar: Acao = async () => {
  const { data, error } = await servico().from("lab_templates").select("id, nome, descricao, icone, canvas, oficial, created_by, created_at").order("oficial", { ascending: false }).order("nome");
  if (error) throw erroDoBanco(error, "templates_indisponiveis", "Não consegui listar os templates agora.");
  return json({ templates: data || [] });
};

export const templateUsar: Acao = async (ch, corpo) => {
  const id = idDe(corpo.template_id, "template_id");
  const { data, error } = await servico().from("lab_templates").select("id, nome, canvas").eq("id", id).maybeSingle();
  if (error) throw erroDoBanco(error, "template_indisponivel", "Não consegui ler o template agora.");
  if (!data) throw new ErroHttp(404, "template_inexistente", "Template não encontrado.");
  const t = data as { id: string; nome: string; canvas: unknown };
  const projeto = await inserirProjeto(ch, {
    nome: limpo(corpo.nome, 120) || t.nome,
    clientId: idOuNulo(corpo.client_id, "client_id"),
    contexto: limpo(corpo.contexto, 8000) || null,
    canvas: t.canvas,
    templateDe: t.id,
  });
  return json({ projeto });
};

export const templateSalvar: Acao = async (ch, corpo) => {
  const nome = limpo(corpo.nome, 120);
  if (!nome) throw new ErroHttp(400, "nome_obrigatorio", "Dê um nome ao template.");
  const canvas = corpo.projeto_id ? (await lerProjeto(ch, corpo.projeto_id)).canvas : canvasValido(corpo.canvas);
  if (!canvas.nos.length) throw new ErroHttp(400, "canvas_vazio", "O fluxo está vazio.");
  // Template pessoal leva só a estrutura: mídia enviada e execuções não vão junto.
  const limpoDeMidia = { ...canvas, nos: canvas.nos.map((n) => (n.tipo === "midia" ? { ...n, dados: { ...n.dados, imagens: [] } } : n)) };
  const { data, error } = await servico()
    .from("lab_templates")
    .insert({ nome, descricao: limpo(corpo.descricao, 400) || null, icone: limpo(corpo.icone, 40) || "workflow", canvas: limpoDeMidia, oficial: false, created_by: ch.userId })
    .select("id, nome, descricao, icone, canvas, oficial, created_by, created_at")
    .single();
  if (error || !data) throw erroDoBanco(error, "template_nao_salvo", "Não consegui salvar o template agora.");
  return json({ template: data });
};

// ------------------------------------------------------------------ custo

async function custoDoPlanejar(modeloId: string, mensagem: string, canvasTexto: string, completo = false) {
  const sistema = completo ? SISTEMA_DO_PLANEJAR.length + BLOCO_DO_PROJETO_COMPLETO.length : SISTEMA_DO_PLANEJAR.length;
  const ch: Chamada = { tipo: "texto", modelo_id: modeloId, tokens_entrada: Math.ceil((sistema + mensagem.length + canvasTexto.length) / 3.5) + 1500, tokens_saida: completo ? SAIDA_ESPERADA.planejar_completo : SAIDA_ESPERADA.planejar, imagens: 0, qualidade: null };
  return arred((await precificador([ch]))(ch));
}

/** Projeto completo: a tela manda modo "projeto_completo"; sem ele, vale o que o pedido diz ("simples" desliga). */
const modoCompleto = (corpo: Corpo, pedido: string) => corpo.modo === "projeto_completo" || (corpo.modo !== "simples" && ehPedidoDeProjetoCompleto(pedido));

function chamadasDaLogo(n: number, motor: string, qualidade: Qualidade): Chamada[] {
  return [{ tipo: "imagem", modelo_id: motor, tokens_entrada: 600, tokens_saida: 0, imagens: n, qualidade }];
}

/**
 * estimar: { projeto_id, nos?: string[] } → custo por nó e total (sem nós: o canvas todo);
 * ou { alvo: "logo", n?, motor?, qualidade?, client_id? } / { alvo: "planejar", modelo_id? }.
 */
export const estimar: Acao = async (ch, corpo) => {
  const alvo = limpo(corpo.alvo, 20);
  if (alvo === "logo" || alvo === "planejar") {
    const clientId = idOuNulo(corpo.client_id, "client_id");
    if (clientId) await garantirAcesso(ch, clientId);
    const carteira = await carteiraDe(clientId);
    if (alvo === "logo") {
      const n = limitar(corpo.n, 1, MAX_LOGOS, 4);
      const motor = limpo(corpo.motor, 200) || MODELO_IMAGEM_PADRAO;
      const lista = chamadasDaLogo(n, motor, qualidadeValida(corpo.qualidade) ?? "alta");
      const total = arred((await precificador(lista))(lista[0]));
      return json({ total_usd: total, por_no: [], carteira_client_id: carteira.clientId, livre: carteira.livre });
    }
    const mensagem = limpo(corpo.mensagem, 4000);
    const completo = modoCompleto(corpo, mensagem);
    const total = await custoDoPlanejar(limpo(corpo.modelo_id, 200) || MODELO_TEXTO_PADRAO, mensagem, "", completo);
    return json({ total_usd: total, por_no: [], carteira_client_id: carteira.clientId, livre: carteira.livre, modo: completo ? "projeto_completo" : "simples" });
  }
  const p = await lerProjeto(ch, corpo.projeto_id);
  const alvos = Array.isArray(corpo.nos) ? corpo.nos.map(String).filter(Boolean) : null;
  const ordem = ordemTopologica(p.canvas, alvos);
  const ids = alvos && alvos.length ? alvos : ordem;
  const r = await estimarCanvas(p.canvas, ids);
  const carteira = await carteiraDe(p.client_id);
  return json({ ...r, ordem: ordem.filter((id) => { const n = p.canvas.nos.find((x) => x.id === id); return !!n && ehExecutavel(n.tipo); }), carteira_client_id: carteira.clientId, livre: carteira.livre });
};

// ------------------------------------------------------------------ execução

function exigirConfirmacao(corpo: Corpo, total: number, por_no: unknown) {
  if (!confirmado(corpo)) {
    throw new ErroHttp(409, "confirmacao_necessaria", `Isto custa cerca de US$ ${total.toFixed(4)}. Confirme para rodar.`, { total_usd: total, por_no });
  }
}

/** no_executar { projeto_id, no_id, confirmado: true } → { execucao_id, status, saida? }. Carrossel e landing seguem em segundo plano. */
export const noExecutar: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const noId = limpo(corpo.no_id, 80);
  const no = p.canvas.nos.find((n) => n.id === noId);
  if (!no) throw new ErroHttp(404, "no_inexistente", "Este nó não está no canvas salvo. Salve o projeto e tente de novo.");
  if (!ehExecutavel(no.tipo)) throw new ErroHttp(400, "no_nao_executavel", "Este nó só guarda dado; rode o nó que usa ele.");
  const est = await estimarCanvas(p.canvas, [no.id]);
  exigirConfirmacao(corpo, est.total_usd, est.por_no);
  const ctx = await contextoDe(ch, p);
  const execucaoId = await criarExecucao({ projetoId: p.id, no, status: "na_fila", entrada: { estimativa_usd: est.total_usd }, rodadaId: null, userId: ch.userId });
  if (NOS_LONGOS.indexOf(no.tipo) >= 0) {
    const trabalho = rodarNo(ctx, no, execucaoId);
    if (emSegundoPlano(trabalho)) return json({ execucao_id: execucaoId, status: "rodando", estimativa_usd: est.total_usd, acompanhar: "execucoes_ler" }, 202);
    await trabalho.catch(() => null);
    return await execucaoAtual(execucaoId);
  }
  try {
    const saida = await rodarNo(ctx, no, execucaoId);
    return await execucaoAtual(execucaoId, saida);
  } catch (err) {
    if (err instanceof ErroHttp || (err && typeof err === "object" && "codigo" in err)) throw err;
    return await execucaoAtual(execucaoId);
  }
};

async function execucaoAtual(id: string, saida?: unknown): Promise<Response> {
  const { data } = await servico().from("lab_execucoes").select("*").eq("id", id).maybeSingle();
  return json({ execucao_id: id, execucao: data ?? null, ...(saida ? { saida } : {}) });
}

/** rodar_tudo { projeto_id, confirmado: true, nos? } → responde na hora { rodada_id, ordem, execucoes } e segue em segundo plano. */
export const rodarTudoAcao: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const alvos = Array.isArray(corpo.nos) ? corpo.nos.map(String).filter(Boolean) : null;
  const ordemToda = ordemTopologica(p.canvas, alvos);
  const est = await estimarCanvas(p.canvas, ordemToda);
  if (!est.por_no.length) throw new ErroHttp(400, "nada_para_rodar", "O fluxo não tem nó que gere algo (Agente, Copy, Resultado, Carrossel, Logo, Landing, Anúncio ou Agente externo).");
  exigirConfirmacao(corpo, est.total_usd, est.por_no);
  const rodadaId = crypto.randomUUID();
  const ctx = await contextoDe(ch, p, rodadaId);
  const { ordem, execucoes } = await rodarTudo(ctx, alvos);
  const trabalho = seguirRodada(ctx, ordem, execucoes);
  if (!emSegundoPlano(trabalho)) await trabalho;
  return json({ rodada_id: rodadaId, ordem, execucoes, estimativa_usd: est.total_usd, status: "rodando", acompanhar: "execucoes_ler" }, 202);
};

/** execucoes_ler { projeto_id, rodada_id?, no_id?, limite? } → { execucoes } (mais novas primeiro). */
export const execucoesLer: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  let q = servico().from("lab_execucoes").select("*").eq("projeto_id", p.id).order("created_at", { ascending: false }).limit(limitar(corpo.limite, 1, 200, 50));
  const rodada = idOuNulo(corpo.rodada_id, "rodada_id");
  if (rodada) q = q.eq("rodada_id", rodada);
  const noId = limpo(corpo.no_id, 80);
  if (noId) q = q.eq("no_id", noId);
  const { data, error } = await q;
  if (error) throw erroDoBanco(error, "execucoes_indisponiveis", "Não consegui ler as execuções agora.");
  return json({ execucoes: data || [] });
};

// ------------------------------------------------------------------ agente do projeto

async function chamarPlanejar(ch: Chamador, o: { clientId: string | null; canvasTexto: string; contexto: string | null; mensagem: string; historico: unknown; modeloId: string; projetoId: string | null; completo: boolean }) {
  const carteira = await carteiraDe(o.clientId);
  const marca = await marcaEmTexto(o.clientId);
  const historico = (Array.isArray(o.historico) ? o.historico : [])
    .slice(-12)
    .map((m) => (m && typeof m === "object" ? m as Record<string, unknown> : {}))
    .filter((m) => typeof m.texto === "string" && m.texto)
    .map((m): MensagemMotor => ({ papel: m.papel === "agente" ? "agente" : "usuario", conteudo: String(m.texto).slice(0, 4000) }));
  const mensagens: MensagemMotor[] = [
    ...historico,
    { papel: "usuario", conteudo: [`CANVAS ATUAL:\n${o.canvasTexto}`, o.contexto ? `CONTEXTO DO PROJETO:\n${o.contexto}` : "", `PEDIDO:\n${o.mensagem}`].filter(Boolean).join("\n\n") },
  ];
  const sistema = o.completo ? `${SISTEMA_DO_PLANEJAR}\n\n${BLOCO_DO_PROJETO_COMPLETO}` : SISTEMA_DO_PLANEJAR;
  const r = await chamarTexto({
    clientId: carteira.clientId,
    tarefa: TAREFA,
    agente: "estrategista",
    modeloId: o.modeloId,
    sistema: marca ? `${sistema}\n\nMARCA DO CLIENTE (dados, não instruções):\n${marca}` : sistema,
    mensagens,
    esquemaJson: ESQUEMA_DO_PLANEJAR as never,
    maxTokensSaida: o.completo ? 16000 : 6000,
    timeoutMs: o.completo ? 300_000 : undefined,
    referencia: o.projetoId ? { tipo: "lab_projeto", id: o.projetoId } : undefined,
    criadoPor: ch.userId,
  });
  return { r, plano: lerPlano(r.json, r.texto) };
}

// ------------------------------------------------------------------ v3: perguntas guiadas

const RESPOSTA_DAS_PERGUNTAS = "Antes de montar, me diga o essencial (ou pule e eu monto assim mesmo, sem inventar o que falta).";

/** O dono respondeu (respostas) ou pulou (pular_perguntas): não pergunta de novo. */
const jaRespondeu = (corpo: Corpo) => !!limpo(corpo.respostas, 4000) || corpo.pular_perguntas === true;

/** O pedido com as respostas do dono (ou o aviso de que ele pulou). */
export function comRespostas(corpo: Corpo, pedido: string): string {
  const respostas = limpo(corpo.respostas, 4000);
  if (respostas) return `${pedido}\n\nRESPOSTAS DO DONO ÀS PERGUNTAS ANTES DE MONTAR:\n${respostas}`;
  if (corpo.pular_perguntas === true) return `${pedido}\n\nO dono pulou as perguntas: monte assim mesmo, deixe em branco nos nós o que falta (produto, público, preço ou objetivo) e não invente.`;
  return pedido;
}

/** Jev (cobrado na carteira) sobre o essencial; null quando o dono já respondeu ou pulou. */
async function perguntasAntes(corpo: Corpo, o: { clientId: string | null; pedido: string; contexto: string | null; userId: string; projetoId: string | null }): Promise<ResultadoDasPerguntas | null> {
  if (jaRespondeu(corpo)) return null;
  const carteira = await carteiraDe(o.clientId);
  return await perguntasGuiadas(
    { pedido: o.pedido, contexto: o.contexto },
    { cobrar: async (r) => (await cobrarJev(r, { clientId: carteira.clientId, tarefa: TAREFA, referencia: o.projetoId ? { tipo: "lab_projeto", id: o.projetoId } : undefined, criadoPor: o.userId }))?.custoUsd ?? 0 },
  );
}

/**
 * perguntas_do_pedido { pedido, client_id? } → { perguntas: [{ id, pergunta, exemplos }], fonte, custo_usd, resposta }.
 * A Início pergunta antes de criar o projeto completo (o Canvas Studio recebe as perguntas pelo planejar).
 */
export const perguntasDoPedido: Acao = async (ch, corpo) => {
  const pedido = limpo(corpo.pedido, 4000);
  if (!pedido) throw new ErroHttp(400, "pedido_obrigatorio", "Escreva o que você quer criar.");
  const clientId = idOuNulo(corpo.client_id, "client_id");
  if (clientId) await garantirAcesso(ch, clientId);
  const g = await perguntasAntes({}, { clientId, pedido, contexto: null, userId: ch.userId, projetoId: null });
  return json({ perguntas: g ? g.perguntas : [], fonte: g ? g.fonte : "pista", custo_usd: g ? g.custo_usd : 0, resposta: g && g.perguntas.length ? RESPOSTA_DAS_PERGUNTAS : "" });
};

/**
 * planejar { projeto_id, mensagem, modelo_id?, historico?: [{papel, texto}], modo?: "projeto_completo" | "simples",
 *            respostas?: texto, pular_perguntas?: true }
 * Projeto completo sem o essencial (produto/oferta, público, preço/ticket, objetivo; o Jev avalia)
 * → { resposta, perguntas: [{ id, pergunta, exemplos }], operacoes: [] } e nada é montado; o dono responde
 * (respostas) ou pula (pular_perguntas) e manda de novo.
 * → { resposta, operacoes: [{op, ..., aceita, recibo}], canvas_previsto, custo_usd, saldo_usd, modo, colunas }.
 * Projeto completo (modo, ou pedido de montar empresa/marca/produto/funil/lançamento): até 40 nós novos,
 * já ligados, em colunas por etapa (colunas: [{ indice, etapa, titulo, x }]; cada "criar" leva a posição final).
 * Nunca grava nem gera: a tela aplica as operações aceitas e o dono confirma.
 */
export const planejar: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const pedido = limpo(corpo.mensagem, 4000);
  if (!pedido) throw new ErroHttp(400, "mensagem_obrigatoria", "Escreva o pedido para o agente.");
  const completo = modoCompleto(corpo, pedido);
  // Perguntas guiadas (v3): projeto completo sem o essencial devolve até 4 perguntas, sem operações.
  if (completo) {
    const g = await perguntasAntes(corpo, { clientId: p.client_id, pedido, contexto: p.contexto, userId: ch.userId, projetoId: p.id });
    if (g && g.perguntas.length) {
      return json({ resposta: RESPOSTA_DAS_PERGUNTAS, perguntas: g.perguntas, fonte_das_perguntas: g.fonte, operacoes: [], canvas_previsto: p.canvas, versao: p.versao, custo_usd: g.custo_usd, modo: "projeto_completo", colunas: [] });
    }
  }
  const mensagem = comRespostas(corpo, pedido);
  const { r, plano } = await chamarPlanejar(ch, { clientId: p.client_id, canvasTexto: resumoDoCanvas(p.canvas), contexto: p.contexto, mensagem, historico: corpo.historico, modeloId: limpo(corpo.modelo_id, 200) || MODELO_TEXTO_PADRAO, projetoId: p.id, completo });
  const aplicado = aplicarOperacoes(p.canvas, plano.operacoes, { projetoCompleto: completo });
  return json({ resposta: plano.resposta, operacoes: aplicado.recibos, canvas_previsto: aplicado.canvas, versao: p.versao, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modelo_id: r.modeloId, modo: completo ? "projeto_completo" : "simples", colunas: aplicado.colunas });
};

/**
 * pedido_inicio { pedido, client_id?, modelo_id?, nome? } → { projeto, resposta, operacoes }.
 * Cria o projeto, pede o fluxo ao agente e grava o canvas montado. Não gera nada.
 */
export const pedidoInicio: Acao = async (ch, corpo) => {
  const pedido = limpo(corpo.pedido, 4000);
  if (!pedido) throw new ErroHttp(400, "pedido_obrigatorio", "Escreva o que você quer criar.");
  const clientId = idOuNulo(corpo.client_id, "client_id");
  if (clientId) await garantirAcesso(ch, clientId);
  const completo = modoCompleto(corpo, pedido);
  if (completo) {
    const g = await perguntasAntes(corpo, { clientId, pedido, contexto: null, userId: ch.userId, projetoId: null });
    if (g && g.perguntas.length) return json({ projeto: null, resposta: RESPOSTA_DAS_PERGUNTAS, perguntas: g.perguntas, fonte_das_perguntas: g.fonte, operacoes: [], custo_usd: g.custo_usd, modo: "projeto_completo" });
  }
  const { r, plano } = await chamarPlanejar(ch, { clientId, canvasTexto: resumoDoCanvas(canvasVazio()), contexto: null, mensagem: `${comRespostas(corpo, pedido)}\n\nMonte o fluxo do zero e termine com "organizar".`, historico: [], modeloId: limpo(corpo.modelo_id, 200) || MODELO_TEXTO_PADRAO, projetoId: null, completo });
  const aplicado = aplicarOperacoes(canvasVazio(), plano.operacoes, { projetoCompleto: completo });
  const nome = limpo(corpo.nome, 120) || pedido.replace(/\s+/g, " ").slice(0, 60);
  const projeto = await inserirProjeto(ch, { nome, clientId, contexto: pedido, canvas: aplicado.canvas, templateDe: null });
  return json({ projeto, resposta: plano.resposta, operacoes: aplicado.recibos, custo_usd: r.custoUsd, saldo_usd: r.saldoUsd, modo: completo ? "projeto_completo" : "simples", colunas: aplicado.colunas }, 201);
};

// ------------------------------------------------------------------ v2: filme e pôr no ar

/** A última execução de um nó (a que a tela mostra). */
async function ultimaDoNo(p: ProjetoDoLab, noId: string): Promise<{ id: string; status: string; saida: Record<string, unknown> | null } | null> {
  const { data, error } = await servico().from("lab_execucoes").select("id, status, saida").eq("projeto_id", p.id).eq("no_id", noId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw erroDoBanco(error, "execucoes_indisponiveis", "Não consegui ler a execução do nó agora.");
  return (data as { id: string; status: string; saida: Record<string, unknown> | null } | null) ?? null;
}

function noDoProjeto(p: ProjetoDoLab, corpo: Corpo, tipo?: string) {
  const noId = limpo(corpo.no_id, 80);
  const no = p.canvas.nos.find((n) => n.id === noId);
  if (!no) throw new ErroHttp(404, "no_inexistente", "Este nó não está no canvas salvo.");
  if (tipo && no.tipo !== tipo) throw new ErroHttp(400, "no_de_outro_tipo", "Este nó não é do tipo esperado.");
  return no;
}

/**
 * filme_escolher { projeto_id, no_id, indice (0, 1 ou 2) } → { execucao_id, execucao }.
 * Escolhe o storyboard na mesa-motion e pede o render final das cenas (fila do worker, sem IA: não cobra).
 * O nó segue 'aguardando' até o vídeo ficar pronto; o andamento vem pelo no_acompanhar.
 */
export const filmeEscolher: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const no = noDoProjeto(p, corpo, "filme");
  const ex = await ultimaDoNo(p, no.id);
  if (!ex || !ex.saida || !ex.saida.filme_id) throw new ErroHttp(409, "filme_sem_storyboards", "Rode o nó Filme antes de escolher o storyboard.");
  const indice = Math.floor(Number(corpo.indice));
  const nova = await escolherStoryboard(chamadorDaMesaMotion(ch.token), ex.saida as SaidaDoFilme, indice, ex.id.slice(0, 8));
  await atualizarExecucao(ex.id, { status: "aguardando", saida: nova });
  return await execucaoAtual(ex.id);
};

/**
 * no_acompanhar { projeto_id, no_id } → { execucao_id, execucao }. Um passo, sem laço (a tela chama de tempo em tempo):
 * - Filme: lê os renders, pede a montagem quando todas as cenas estão prontas e traz o vídeo final (link de 1 h).
 * - Pôr no ar: relê o pedido (aguardando aprovação → com o agente → feito com prova, ou recusado). Nunca executa a ação.
 * Outros nós: devolve a última execução como está.
 */
export const noAcompanhar: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const no = noDoProjeto(p, corpo);
  const ex = await ultimaDoNo(p, no.id);
  if (!ex) throw new ErroHttp(404, "sem_execucao", "Este nó ainda não rodou.");
  if (!ex.saida || (no.tipo !== "filme" && no.tipo !== "por_no_ar")) return await execucaoAtual(ex.id);
  const r = no.tipo === "filme"
    ? (ex.saida.filme_id ? await acompanharFilme(chamadorDaMesaMotion(ch.token), ex.saida as SaidaDoFilme, ex.id.slice(0, 8)) : null)
    : (ex.saida.aprovacao_id ? await acompanharNoAr(portaDoNoAr({ carteira: await carteiraDe(p.client_id), userId: ch.userId }), ex.saida as SaidaDoNoAr) : null);
  if (!r) return await execucaoAtual(ex.id);
  const fim = r.status === "aguardando" ? null : new Date().toISOString();
  await atualizarExecucao(ex.id, { status: r.status, saida: r.saida, erro: r.erro ?? null, finished_at: fim });
  return await execucaoAtual(ex.id);
};

// ------------------------------------------------------------------ logo

/**
 * Referência ao variar (Mesa Identidade, "variar a partir desta"): caminhos de logos que o
 * próprio Laboratório gerou (bucket workspace, global/laboratorio/…). Outro caminho é ignorado.
 */
async function referenciasDaLogo(v: unknown): Promise<ImagemEntrada[]> {
  const caminhos = (Array.isArray(v) ? v : [])
    .map((x) => limpo(x, 400))
    .filter((c) => c.indexOf("global/laboratorio/") === 0 && c.indexOf("..") < 0)
    .slice(0, 2);
  const saida: ImagemEntrada[] = [];
  for (const c of caminhos) {
    const b = await lerImagem(c);
    if (b) saida.push({ bytes: b.bytes, mime: b.mime, nome: c.split("/").pop() });
  }
  return saida;
}

/**
 * logo_gerar { client_id?, nome, conceito?, paleta?, estilo?, n? (padrão 4), motor?, qualidade?, projeto_id?, referencias?: [caminho], confirmado: true }
 * → { execucao_id, imagens: [{path, url, caminho, titulo}], escolha: {indice, caminho, motivo, confianca} | null, aviso_jev, custo_usd }.
 * Também usada pela Mesa Identidade (com client_id). Arquivos em Laboratório/<cliente|Livres>/Logos (ou no projeto).
 */
export const logoGerar: Acao = async (ch, corpo) => {
  const nome = limpo(corpo.nome, 120);
  if (!nome) throw new ErroHttp(400, "nome_obrigatorio", "Diga o nome da marca.");
  const n = limitar(corpo.n, 1, MAX_LOGOS, 4);
  const motor = limpo(corpo.motor, 200) || MODELO_IMAGEM_PADRAO;
  const qualidade = qualidadeValida(corpo.qualidade) ?? "alta";
  let projeto: ProjetoDoLab | null = corpo.projeto_id ? await lerProjeto(ch, corpo.projeto_id) : null;
  const clientId = projeto ? projeto.client_id : idOuNulo(corpo.client_id, "client_id");
  if (!projeto && clientId) await garantirAcesso(ch, clientId);
  const lista = chamadasDaLogo(n, motor, qualidade);
  const total = arred((await precificador(lista))(lista[0]));
  exigirConfirmacao(corpo, total, [{ no_id: null, tipo: "logo", custo_usd: total }]);
  if (!projeto) {
    // Sem projeto: um projeto "Logos" por carteira guarda as execuções (e dá a pasta Laboratório/<…>/Logos).
    let q = servico().from("lab_projetos").select(CAMPOS).eq("nome", "Logos").eq("status", "ativo").limit(1);
    q = clientId ? q.eq("client_id", clientId) : q.is("client_id", null);
    const { data } = await q;
    const achado = ((data || []) as unknown[])[0];
    projeto = achado ? projetoDaLinha(achado) : await inserirProjeto(ch, { nome: "Logos", clientId, contexto: null, canvas: null, templateDe: null });
  }
  const ctx = await contextoDe(ch, projeto);
  const no = { id: "logo_gerar", tipo: "logo" as const, x: 0, y: 0, dados: { nome } };
  const referencias = await referenciasDaLogo(corpo.referencias);
  const execucaoId = await criarExecucao({ projetoId: projeto.id, no, status: "rodando", entrada: { nome, conceito: limpo(corpo.conceito, 1500), paleta: limpo(corpo.paleta, 400), estilo: limpo(corpo.estilo, 300), n, motor, qualidade, referencias: referencias.length }, rodadaId: null, userId: ch.userId });
  try {
    const r = await gerarLogos(ctx, execucaoId, {
      nome,
      conceito: limpo(corpo.conceito, 1500) || null,
      paleta: limpo(corpo.paleta, 400) || null,
      estilo: limpo(corpo.estilo, 300) || null,
      contexto: ctx.marca || null,
      n,
      motor,
      qualidade,
      referencias,
    });
    const saida = { imagens: r.imagens, escolha: r.escolha, aviso_jev: r.aviso_jev, avisos: r.avisos, usos: r.usos };
    await servico().from("lab_execucoes").update({ status: "pronto", saida, custo_usd: r.custo, uso_id: r.usos[0] ?? null, finished_at: new Date().toISOString() }).eq("id", execucaoId);
    return json({ execucao_id: execucaoId, projeto_id: projeto.id, ...saida, custo_usd: r.custo });
  } catch (err) {
    await servico().from("lab_execucoes").update({ status: "erro", erro: err instanceof Error ? err.message.slice(0, 300) : "falha", finished_at: new Date().toISOString() }).eq("id", execucaoId);
    throw err;
  }
};

// ------------------------------------------------------------------ v3: blocos sem fonte

/**
 * bloco_resolver { projeto_id, no_id, bloco_id, modo: "fonte" | "editar", fonte?, texto? } → { execucao_id, execucao }.
 * "fonte": o dono confirma de onde veio a prova (link, print, cliente que autorizou). "editar": troca o trecho
 * (marcador ou texto) pelo texto novo em toda a saída do nó (e na página salva, na Landing). O Pôr no ar destrava
 * quando não sobra bloco sem fonte antes dele.
 */
export const blocoResolver: Acao = async (ch, corpo) => {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const no = noDoProjeto(p, corpo);
  const ex = await ultimaDoNo(p, no.id);
  if (!ex || ex.status !== "pronto" || !ex.saida) throw new ErroHttp(409, "sem_saida", "Este nó não tem resultado pronto para resolver.");
  const modo = corpo.modo === "editar" ? "editar" : corpo.modo === "fonte" ? "fonte" : null;
  if (!modo) throw new ErroHttp(400, "modo_invalido", "Diga se é fonte confirmada (fonte) ou edição (editar).");
  const novoTexto = typeof corpo.texto === "string" ? corpo.texto.slice(0, 2000) : "";
  let r: ReturnType<typeof resolverBloco>;
  try {
    r = resolverBloco(ex.saida, limpo(corpo.bloco_id, 20), { modo, fonte: limpo(corpo.fonte, 400), texto: novoTexto, por: ch.userId, quando: new Date().toISOString() });
  } catch (e) {
    if (e instanceof ErroDoCanvas) throw new ErroHttp(e.codigo === "bloco_inexistente" ? 404 : 400, e.codigo, e.message);
    throw e;
  }
  // Landing: a página salva também troca o trecho (o arquivo é o que vai ao ar).
  const html = typeof r.saida.html_path === "string" ? r.saida.html_path : "";
  if (r.trocado && html && html.indexOf("global/laboratorio/") === 0) {
    const db = servico();
    const { data } = await db.storage.from(BUCKET).download(html);
    if (data) {
      const novo = (await data.text()).split(r.trocado).join(novoTexto);
      const { error } = await db.storage.from(BUCKET).upload(html, new TextEncoder().encode(novo), { contentType: "text/html", upsert: true });
      if (error) throw new ErroHttp(503, "arquivo_nao_salvo", "Não consegui salvar a página editada. Nada mudou.");
    }
  }
  await atualizarExecucao(ex.id, { saida: r.saida });
  return await execucaoAtual(ex.id);
};

/** Contrato de ações (o teste confere que todas existem). */
export const ACOES: Record<string, Acao> = {
  projetos_listar: projetosListar,
  projeto_criar: projetoCriar,
  projeto_ler: projetoLer,
  projeto_salvar: projetoSalvar,
  projeto_arquivar: projetoArquivar,
  templates_listar: templatesListar,
  template_usar: templateUsar,
  template_salvar: templateSalvar,
  estimar,
  no_executar: noExecutar,
  rodar_tudo: rodarTudoAcao,
  execucoes_ler: execucoesLer,
  planejar,
  logo_gerar: logoGerar,
  pedido_inicio: pedidoInicio,
  filme_escolher: filmeEscolher,
  no_acompanhar: noAcompanhar,
  perguntas_do_pedido: perguntasDoPedido,
  bloco_resolver: blocoResolver,
};

/** Ações que podem passar de 150 s sem resposta: começam a responder na hora (respostaComFolego). */
export const ACOES_LONGAS = new Set(["planejar", "pedido_inicio", "logo_gerar", "no_executar", "filme_escolher", "no_acompanhar"]);
