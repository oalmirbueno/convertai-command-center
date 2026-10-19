/**
 * laboratorio: execução dos nós (motor único, carteira, saídas no Workspace global, lab_execucoes).
 *
 * - Cada nó executável vira uma linha em lab_execucoes (na_fila → rodando → pronto | erro | aguardando).
 * - Custo pelo motor (chamarTexto / chamarImagem com tarefa 'laboratorio'): o motor só cobra a chamada que deu
 *   certo; falha não cobra.
 * - Nó estático (contexto, mídia, config, gravity) não roda: a saída sai dos dados dele.
 * - Anúncio nunca publica na Meta; agente externo só cria a tarefa e entrega ao operador.
 */
import { carregarModelo, chamarImagem, chamarTexto, cobrarJev, estimarComModelo, type ImagemEntrada, type ModeloIa, type Qualidade } from "../_shared/ia-motor.ts";
import { jevPerguntar, type ResultadoJev } from "../_shared/jev.ts";
import { erroQueSobe, motivoDaFalha, registrarFalha } from "../_shared/falha-registrada.ts";
import { OPERADOR_HERMES } from "../_shared/pedido-ao-hermes.ts";
import { type Carteira, ErroHttp, servico, TAREFA } from "./comum.ts";
import { type ArquivoSalvo, garantirPastas, lerImagem, salvarArquivo } from "./workspace.ts";
import { chamadorDaMesaMotion, type ChamarMotion, rodarFilme } from "./filme.ts";
import { type AprovacaoLida, type EntradaDoPacote, type Operador, pedirNoAr, type PortaDoNoAr } from "./no-ar.ts";
import {
  ancestraisDe,
  arred,
  blocosSemFonte,
  BUSCAS_DA_PESQUISA,
  NOS_COM_PROVA,
  NOS_ESPECIALISTAS,
  travaDoNoAr,
  formatosDoFilme,
  type Canvas,
  type Chamada,
  caminhoNoBucket,
  chamadasDoNo,
  configDe,
  entradasDo,
  ehExecutavel,
  gravityDe,
  limitar,
  MAX_LAMINAS,
  MAX_LOGOS,
  MODELO_IMAGEM_PADRAO,
  MODELO_TEXTO_PADRAO,
  montarPromptDaImagem,
  type NoDoCanvas,
  nomeDoArquivo,
  ordemTopologica,
  pastasDoLaboratorio,
  ROTULO_DO_TIPO,
  SAIDA_ESPERADA,
  somarEstimativa,
  TAMANHO_DA_PROPORCAO,
} from "./modulos/regras.ts";
import {
  CAMINHOS_DE_LOGO,
  ESQUEMA_DA_COPY,
  ESQUEMA_DA_OFERTA,
  ESQUEMA_DO_ANUNCIO,
  ESQUEMA_DO_CARROSSEL,
  ESQUEMA_DO_FUNIL,
  ESPECIALISTAS,
  type PedidoDeLogo,
  perguntaDaMelhorLogo,
  promptDaLogo,
  SISTEMA_DA_LANDING,
  SISTEMA_DA_OFERTA,
  SISTEMA_DA_PESQUISA,
  SISTEMA_DO_AGENTE,
  SISTEMA_DO_ANUNCIO,
  SISTEMA_DO_CARROSSEL,
  SISTEMA_DO_FUNIL,
  sistemaDaCopy,
} from "./modulos/prompts.ts";

export type ProjetoDoLab = {
  id: string;
  nome: string;
  client_id: string | null;
  contexto: string | null;
  canvas: Canvas;
  versao: number;
  status: string;
  template_de: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ImagemSaida = { path: string; url: string | null; bucket?: string; no_workspace_id?: string | null; ordem?: number };
export type SaidaDoNo = {
  texto?: string;
  imagens?: ImagemSaida[];
  html_path?: string;
  html_url?: string | null;
  json?: unknown;
  tarefa_id?: string;
  link_id?: string | null;
  escolha?: unknown;
  avisos?: string[];
  usos?: string[];
  [extra: string]: unknown;
};

export type Contexto = {
  projeto: ProjetoDoLab;
  canvas: Canvas;
  carteira: Carteira;
  marca: string;
  nomeDoCliente: string | null;
  userId: string;
  /** JWT de quem pediu: o nó Filme chama a mesa-motion como a pessoa (mesmas travas e acesso). */
  token: string;
  rodadaId: string | null;
  saidas: Map<string, SaidaDoNo>;
  pastaId?: string;
  /** Teste: troca a chamada à mesa-motion. */
  motion?: ChamarMotion;
};

const rotuloDoNo = (no: NoDoCanvas) => (typeof no.dados.titulo === "string" && no.dados.titulo.trim() ? no.dados.titulo.trim() : ROTULO_DO_TIPO[no.tipo]);
const txt = (v: unknown, max = 8000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ------------------------------------------------------------------ custo

/** Preço de cada chamada pelo catálogo (carrega cada modelo uma vez). */
export async function precificador(chamadas: Chamada[]): Promise<(ch: Chamada) => number> {
  const modelos = new Map<string, ModeloIa>();
  for (const ch of chamadas) {
    if (!modelos.has(ch.modelo_id)) modelos.set(ch.modelo_id, await carregarModelo(ch.modelo_id, ch.tipo));
  }
  return (ch) => {
    const m = modelos.get(ch.modelo_id)!;
    return ch.tipo === "imagem"
      ? estimarComModelo(m, { imagens: ch.imagens, qualidade: ch.qualidade ?? "media", tokensEntrada: ch.tokens_entrada, imagensEntrada: ch.imagens_entrada ?? 0 })
      : estimarComModelo(m, { tokensEntrada: ch.tokens_entrada, tokensSaida: ch.tokens_saida, buscasWeb: ch.buscas_web ?? 0 });
  };
}

export async function estimarCanvas(canvas: Canvas, ids: string[]) {
  const todas: Chamada[] = [];
  for (const id of ids) {
    const no = canvas.nos.find((n) => n.id === id);
    if (no && ehExecutavel(no.tipo)) todas.push(...chamadasDoNo(canvas, no));
  }
  const preco = await precificador(todas);
  return somarEstimativa(canvas, ids, preco);
}

// ------------------------------------------------------------------ linhas de lab_execucoes

export async function criarExecucao(o: { projetoId: string; no: NoDoCanvas; status: string; entrada: Record<string, unknown>; rodadaId: string | null; userId: string }): Promise<string> {
  const operador = o.no.tipo === "agente_externo" ? (txt(o.no.dados.operador, 80) || OPERADOR_HERMES) : null;
  const { data, error } = await servico()
    .from("lab_execucoes")
    .insert({ projeto_id: o.projetoId, no_id: o.no.id, tipo: o.no.tipo, status: o.status, entrada: o.entrada, rodada_id: o.rodadaId, operador_slug: operador, created_by: o.userId })
    .select("id")
    .single();
  if (error || !data) throw new ErroHttp(503, "execucao_nao_criada", "Não consegui registrar a execução do nó.");
  return (data as { id: string }).id;
}

export async function atualizarExecucao(id: string, campos: Record<string, unknown>) {
  const { error } = await servico().from("lab_execucoes").update(campos).eq("id", id);
  if (error) registrarFalha("laboratorio: execução não atualizada", error, { execucao_id: id });
}

// ------------------------------------------------------------------ entradas

/**
 * Saída de um nó a montante: estático pelos dados; executável pela rodada atual ou pela última pronta.
 * Filme e Pôr no ar valem também 'aguardando' (o filme espera a escolha; o pedido espera o dono).
 */
async function saidaDe(ctx: Contexto, no: NoDoCanvas): Promise<SaidaDoNo | null> {
  if (no.tipo === "contexto") return { texto: txt(no.dados.texto) };
  if (no.tipo === "midia") {
    const imgs = Array.isArray(no.dados.imagens) ? no.dados.imagens : [];
    return {
      imagens: imgs
        .map((i) => (i && typeof i === "object" ? i as Record<string, unknown> : {}))
        .filter((i) => typeof i.path === "string" && i.path)
        .map((i) => ({ path: String(i.path), url: typeof i.url === "string" ? i.url : null, bucket: typeof i.bucket === "string" ? i.bucket : "workspace" })),
    };
  }
  if (no.tipo === "config" || no.tipo === "gravity") return null;
  const daRodada = ctx.saidas.get(no.id);
  if (daRodada) return daRodada;
  const { data } = await servico()
    .from("lab_execucoes")
    .select("saida")
    .eq("projeto_id", ctx.projeto.id)
    .eq("no_id", no.id)
    .in("status", no.tipo === "filme" ? ["pronto", "aguardando"] : ["pronto"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const s = (data as { saida?: SaidaDoNo } | null)?.saida ?? null;
  if (s) ctx.saidas.set(no.id, s);
  return s;
}

export type Entradas = { textos: string[]; imagens: ImagemSaida[] };

export async function entradasMontadas(ctx: Contexto, no: NoDoCanvas): Promise<Entradas> {
  const textos: string[] = [];
  const imagens: ImagemSaida[] = [];
  if (ctx.projeto.contexto && ctx.projeto.contexto.trim()) textos.push(`Contexto do projeto: ${ctx.projeto.contexto.trim()}`);
  for (const antes of entradasDo(ctx.canvas, no.id)) {
    const s = await saidaDe(ctx, antes);
    if (!s) continue;
    const rotulo = rotuloDoNo(antes);
    if (s.texto) textos.push(`${rotulo}: ${s.texto}`);
    if (antes.tipo === "pesquisa" && Array.isArray(s.fontes) && s.fontes.length) {
      textos.push(`${rotulo} (fontes): ${(s.fontes as Array<{ titulo?: string; url?: string }>).slice(0, 12).map((f) => `${f.titulo || ""} ${f.url || ""}`.trim()).join("; ")}`);
    }
    if ((antes.tipo === "oferta" || antes.tipo === "funil") && s.json && !s.texto) textos.push(`${rotulo}: ${JSON.stringify(s.json).slice(0, 4000)}`);
    if (antes.tipo === "anuncio" && s.json) textos.push(`${rotulo}: ${JSON.stringify(s.json).slice(0, 3000)}`);
    if (antes.tipo === "landing" && s.html_path) textos.push(`${rotulo}: página salva em ${s.html_path}`);
    if (s.imagens?.length) imagens.push(...s.imagens);
  }
  return { textos, imagens };
}

/** Bytes das imagens de entrada (até `max`), para referência no gerador ou visão no agente. */
async function bytesDas(imagens: Array<{ path: string; bucket?: string }>, max = 4): Promise<ImagemEntrada[]> {
  const saida: ImagemEntrada[] = [];
  for (const i of imagens.slice(0, max)) {
    const b = await lerImagem(i.path, i.bucket || "workspace");
    if (b) saida.push({ bytes: b.bytes, mime: b.mime, nome: i.path.split("/").pop() });
  }
  return saida;
}

async function pasta(ctx: Contexto): Promise<string> {
  if (!ctx.pastaId) ctx.pastaId = await garantirPastas(pastasDoLaboratorio(ctx.nomeDoCliente, ctx.projeto.nome), ctx.userId);
  return ctx.pastaId;
}

async function salvarImagem(ctx: Contexto, execucaoId: string, rotulo: string, indice: number, total: number, png: Uint8Array, mime: string): Promise<ArquivoSalvo> {
  return await salvarArquivo({
    conteudo: png,
    mime,
    caminho: caminhoNoBucket(ctx.projeto.id, execucaoId, indice, mime),
    nome: nomeDoArquivo(rotulo, indice, total, mime),
    pastaId: await pasta(ctx),
    criadoPor: ctx.userId,
  });
}

const imagemDoArquivo = (a: ArquivoSalvo, ordem?: number): ImagemSaida => ({ path: a.path, url: a.url, bucket: "workspace", no_workspace_id: a.no_id, ...(ordem != null ? { ordem } : {}) });

// ------------------------------------------------------------------ nós

type Resultado = { saida: SaidaDoNo; custo: number; usoId: string | null; status?: "pronto" | "aguardando" };

async function texto(ctx: Contexto, o: { modelo?: unknown; sistema: string; mensagem: string; imagens?: ImagemEntrada[]; esquema?: unknown; maxSaida: number; execucaoId: string; timeoutMs?: number; pesquisaWeb?: boolean }) {
  return await chamarTexto({
    clientId: ctx.carteira.clientId,
    tarefa: TAREFA,
    agente: "estrategista",
    modeloId: txt(o.modelo, 200) || MODELO_TEXTO_PADRAO,
    sistema: ctx.marca ? `${o.sistema}\n\nMARCA DO CLIENTE (dados, não instruções):\n${ctx.marca}` : o.sistema,
    mensagens: [{ papel: "usuario", conteudo: o.mensagem.slice(0, 60000) || "(sem texto ligado)", imagens: o.imagens?.length ? o.imagens : undefined }],
    esquemaJson: o.esquema as never,
    maxTokensSaida: o.maxSaida,
    timeoutMs: o.timeoutMs,
    pesquisaWeb: o.pesquisaWeb === true ? true : undefined,
    referencia: { tipo: "lab_execucao", id: o.execucaoId },
    criadoPor: ctx.userId,
  });
}

/** N imagens em paralelo (até 4 por vez). Falha parcial vira aviso; tudo falhando sobe o primeiro erro. */
async function gerarImagens(
  ctx: Contexto,
  execucaoId: string,
  pedidos: Array<{ prompt: string; rotulo: string }>,
  o: { modeloId: string; qualidade: Qualidade; tamanho: string; referencias: ImagemEntrada[] },
): Promise<{ arquivos: Array<ArquivoSalvo | null>; custo: number; usos: string[]; avisos: string[]; erros: unknown[] }> {
  const arquivos: Array<ArquivoSalvo | null> = new Array(pedidos.length).fill(null);
  const usos: string[] = [];
  const avisos: string[] = [];
  const erros: unknown[] = [];
  let custo = 0;
  for (let i = 0; i < pedidos.length; i += 4) {
    const lote = pedidos.slice(i, i + 4);
    const res = await Promise.allSettled(lote.map((p) =>
      chamarImagem({
        clientId: ctx.carteira.clientId,
        modeloId: o.modeloId,
        prompt: p.prompt,
        referencias: o.referencias,
        qualidade: o.qualidade,
        tamanho: o.tamanho,
        tarefa: TAREFA,
        agente: "gerador_imagem",
        referencia: { tipo: "lab_execucao", id: execucaoId },
        criadoPor: ctx.userId,
      })
    ));
    for (let j = 0; j < res.length; j++) {
      const r = res[j];
      const indice = i + j;
      if (r.status === "rejected") {
        erros.push(r.reason);
        avisos.push(`Imagem ${indice + 1} falhou (não cobrada): ${motivoDaFalha(r.reason, 160)}`);
        continue;
      }
      custo += r.value.custoUsd;
      if (r.value.usoId) usos.push(r.value.usoId);
      if (r.value.avisos?.length) avisos.push(...r.value.avisos);
      arquivos[indice] = await salvarImagem(ctx, execucaoId, lote[j].rotulo, indice, pedidos.length, r.value.png, r.value.mime);
    }
    // Sem saldo, cota ou chave: não adianta seguir os próximos lotes.
    if (erros.some(erroQueSobe)) break;
  }
  if (!arquivos.some(Boolean) && erros.length) throw erros[0];
  return { arquivos, custo: arred(custo), usos, avisos, erros };
}

async function noAgente(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const instrucao = txt(no.dados.instrucao);
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: instrucao ? `${SISTEMA_DO_AGENTE}\n\nSUA INSTRUÇÃO NESTE FLUXO:\n${instrucao}` : SISTEMA_DO_AGENTE,
    mensagem: e.textos.join("\n\n"),
    imagens: await bytesDas(e.imagens, 4),
    maxSaida: SAIDA_ESPERADA.agente,
    execucaoId,
  });
  return { saida: { texto: r.texto, modelo_id: r.modeloId }, custo: r.custoUsd, usoId: r.usoId };
}

async function noCopy(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const formato = txt(no.dados.formato, 40) || "legenda";
  const extra = txt(no.dados.instrucao);
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: sistemaDaCopy(formato) + (extra ? `\n\nPEDIDO EXTRA: ${extra}` : ""),
    mensagem: e.textos.join("\n\n"),
    esquema: ESQUEMA_DA_COPY,
    maxSaida: SAIDA_ESPERADA.copy,
    execucaoId,
  });
  const j = (r.json ?? {}) as { texto_completo?: string };
  return { saida: { texto: txt(j.texto_completo, 20000) || r.texto, json: r.json ?? null, formato }, custo: r.custoUsd, usoId: r.usoId };
}

async function noImagem(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const cfg = configDe(ctx.canvas, no);
  const gravity = gravityDe(ctx.canvas, no);
  const prompt = montarPromptDaImagem({ pedido: txt(no.dados.prompt), textos: e.textos, gravity, config: cfg, marca: ctx.marca || null });
  const referencias = await bytesDas([...e.imagens, ...(gravity?.referencias || [])], 4);
  const rotulo = rotuloDoNo(no);
  const g = await gerarImagens(ctx, execucaoId, Array.from({ length: cfg.quantidade }, () => ({ prompt, rotulo })), {
    modeloId: cfg.motor || MODELO_IMAGEM_PADRAO,
    qualidade: cfg.qualidade,
    tamanho: TAMANHO_DA_PROPORCAO[cfg.proporcao],
    referencias,
  });
  const imagens = g.arquivos.filter((a): a is ArquivoSalvo => !!a).map((a) => imagemDoArquivo(a));
  return { saida: { imagens, avisos: g.avisos, usos: g.usos, proporcao: cfg.proporcao }, custo: g.custo, usoId: g.usos[0] ?? null };
}

async function noCarrossel(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const n = limitar(no.dados.laminas, 2, MAX_LAMINAS, 5);
  const cfg = configDe(ctx.canvas, no);
  const gravity = gravityDe(ctx.canvas, no);
  const tema = txt(no.dados.tema);
  const plano = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_CARROSSEL,
    mensagem: [`Planeje exatamente ${n} lâminas.`, tema ? `Tema: ${tema}` : "", gravity?.prompt_base ? `Base comum: ${gravity.prompt_base}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_CARROSSEL,
    maxSaida: SAIDA_ESPERADA.carrossel,
    execucaoId,
  });
  const brutas = ((plano.json ?? {}) as { laminas?: Array<{ ordem?: number; titulo?: string; texto?: string; prompt_imagem?: string }> }).laminas ?? [];
  const laminas = brutas.slice(0, n).map((l, i) => ({ ordem: i + 1, titulo: txt(l.titulo, 200), texto: txt(l.texto, 400), prompt_imagem: txt(l.prompt_imagem, 3000) }));
  if (!laminas.length) throw new ErroHttp(502, "carrossel_sem_laminas", "O agente não devolveu as lâminas do carrossel.");
  const referencias = await bytesDas([...e.imagens, ...(gravity?.referencias || [])], 4);
  const rotulo = rotuloDoNo(no);
  const g = await gerarImagens(
    ctx,
    execucaoId,
    laminas.map((l) => ({
      rotulo,
      prompt: montarPromptDaImagem({
        pedido: `Lâmina ${l.ordem} de ${laminas.length} de um carrossel. Texto que aparece na arte, exatamente: "${l.texto}". ${l.prompt_imagem}`,
        gravity,
        config: cfg,
        marca: ctx.marca || null,
      }),
    })),
    { modeloId: cfg.motor || txt(no.dados.motor, 200) || MODELO_IMAGEM_PADRAO, qualidade: cfg.qualidade, tamanho: TAMANHO_DA_PROPORCAO[cfg.proporcao], referencias },
  );
  const imagens = g.arquivos.map((a, i) => (a ? imagemDoArquivo(a, i + 1) : null)).filter((a): a is ImagemSaida => !!a);
  return {
    saida: { imagens, laminas, avisos: g.avisos, usos: [plano.usoId, ...g.usos], texto: laminas.map((l) => `${l.ordem}. ${l.texto}`).join("\n") },
    custo: arred(plano.custoUsd + g.custo),
    usoId: plano.usoId,
  };
}

// ------------------------------------------------------------------ logo (também a ação logo_gerar)

export type EscolhaDaLogo = { indice: number; caminho: string; motivo: string; confianca: number | null };

export async function gerarLogos(
  ctx: Contexto,
  execucaoId: string,
  o: PedidoDeLogo & { n: number; motor?: string | null; qualidade?: Qualidade; gravity?: string | null; referencias?: ImagemEntrada[]; rotulo?: string },
): Promise<{ imagens: Array<ImagemSaida & { caminho: string; titulo: string }>; escolha: EscolhaDaLogo | null; aviso_jev: string | null; avisos: string[]; custo: number; usos: string[] }> {
  const n = limitar(o.n, 1, MAX_LOGOS, 4);
  const caminhos = CAMINHOS_DE_LOGO.slice(0, n);
  const g = await gerarImagens(
    ctx,
    execucaoId,
    caminhos.map((c) => ({ rotulo: `${o.rotulo || `Logo ${o.nome}`} ${c.titulo}`, prompt: promptDaLogo(o, c, o.gravity) })),
    { modeloId: o.motor || MODELO_IMAGEM_PADRAO, qualidade: o.qualidade || "alta", tamanho: TAMANHO_DA_PROPORCAO["1:1"], referencias: o.referencias || [] },
  );
  const imagens: Array<ImagemSaida & { caminho: string; titulo: string }> = [];
  g.arquivos.forEach((a, i) => {
    if (a) imagens.push({ ...imagemDoArquivo(a, i + 1), caminho: caminhos[i].id, titulo: caminhos[i].titulo });
  });
  let escolha: EscolhaDaLogo | null = null;
  let aviso: string | null = null;
  let custoJev = 0;
  if (imagens.length === 1) {
    escolha = { indice: 0, caminho: imagens[0].caminho, motivo: "Só uma variação saiu; é ela.", confianca: null };
  } else if (imagens.length > 1) {
    const opcoes = imagens.map((im, i) => ({ apelido: `v${i + 1}`, titulo: im.titulo, descricao: caminhos.find((c) => c.id === im.caminho)?.descricao || im.titulo }));
    try {
      const r: ResultadoJev = await jevPerguntar({
        state: { briefing: { nome: o.nome, conceito: o.conceito || null, paleta: o.paleta || null, estilo: o.estilo || null, sobre: (o.contexto || "").slice(0, 1500) || null }, variacoes: opcoes },
        questions: perguntaDaMelhorLogo(opcoes),
      }, { timeoutMs: 12_000 });
      const cobrado = await cobrarJev(r, { clientId: ctx.carteira.clientId, tarefa: TAREFA, referencia: { tipo: "lab_execucao", id: execucaoId }, criadoPor: ctx.userId }).catch(() => null);
      custoJev = cobrado?.custoUsd ?? 0;
      const x = r.answers.melhor;
      const i = x?.choice ? opcoes.findIndex((op) => op.apelido === x.choice) : -1;
      if (i >= 0) {
        const p = x?.probabilities?.[x.choice!] ?? x?.confidence ?? null;
        const pct = typeof p === "number" ? ` (${Math.round(p * 100)}% de preferência)` : "";
        escolha = {
          indice: i,
          caminho: imagens[i].caminho,
          confianca: typeof p === "number" ? p : null,
          motivo: `O Jev apontou a variação ${i + 1}, "${opcoes[i].titulo}"${pct}: é a direção que melhor junta o conceito pedido, simplicidade e leitura em tamanho pequeno (${opcoes[i].descricao}). O Jev julga a direção de cada variação, não o desenho; confira a imagem antes de levar adiante.`,
        };
        if (typeof p === "number" && p < 0.4) aviso = "Escolha apertada: as direções ficaram parecidas para o Jev. Vale olhar todas.";
      } else aviso = "O Jev não apontou uma variação; escolha olhando as imagens.";
    } catch (e) {
      aviso = "O Jev não respondeu agora; as variações estão prontas, escolha olhando as imagens.";
      registrarFalha("laboratorio: Jev não escolheu a logo", e, { execucao_id: execucaoId });
    }
  }
  return { imagens, escolha, aviso_jev: aviso, avisos: g.avisos, custo: arred(g.custo + custoJev), usos: g.usos };
}

async function noLogo(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const cfg = configDe(ctx.canvas, no);
  const gravity = gravityDe(ctx.canvas, no);
  const nome = txt(no.dados.nome, 120);
  if (!nome) throw new ErroHttp(400, "logo_sem_nome", "Escreva o nome da marca no nó Logo.");
  const r = await gerarLogos(ctx, execucaoId, {
    nome,
    conceito: txt(no.dados.conceito, 1500) || null,
    paleta: txt(no.dados.paleta, 400) || null,
    estilo: txt(no.dados.estilo, 300) || null,
    contexto: [ctx.marca, ...e.textos].filter(Boolean).join("\n").slice(0, 3000) || null,
    n: limitar(no.dados.n, 1, MAX_LOGOS, 4),
    motor: cfg.motor || txt(no.dados.motor, 200) || null,
    qualidade: cfg.qualidade,
    gravity: gravity?.prompt_base || null,
    referencias: await bytesDas([...e.imagens, ...(gravity?.referencias || [])], 2),
    rotulo: rotuloDoNo(no),
  });
  return { saida: { imagens: r.imagens, escolha: r.escolha, aviso_jev: r.aviso_jev, avisos: r.avisos, usos: r.usos }, custo: r.custo, usoId: r.usos[0] ?? null };
}

/** Tira cerca de bloco de código e confere que é uma página. */
export function htmlDaResposta(t: string): string {
  let s = String(t || "").trim();
  const cerca = s.match(/^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/i);
  if (cerca) s = cerca[1].trim();
  const ini = s.search(/<!doctype html|<html/i);
  if (ini > 0) s = s.slice(ini);
  if (!/<html[\s>]/i.test(s) && !/<!doctype html/i.test(s)) throw new ErroHttp(502, "landing_sem_html", "O construtor não devolveu uma página HTML.");
  return s;
}

async function noLanding(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const gravity = gravityDe(ctx.canvas, no);
  const imagens = e.imagens.filter((i) => i.url).slice(0, 8).map((i, k) => `Imagem ${k + 1}: ${i.url}`);
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DA_LANDING,
    mensagem: [
      txt(no.dados.objetivo) ? `Objetivo da página: ${txt(no.dados.objetivo)}` : "",
      txt(no.dados.secoes) ? `Seções pedidas: ${txt(no.dados.secoes)}` : "",
      gravity?.prompt_base ? `Base comum: ${gravity.prompt_base}` : "",
      ...e.textos,
      imagens.length ? `Imagens que podem entrar (links válidos por 7 dias; use como src):\n${imagens.join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    maxSaida: SAIDA_ESPERADA.landing,
    timeoutMs: 300_000,
    execucaoId,
  });
  const html = htmlDaResposta(r.texto);
  // Prova sem fonte na página: o construtor deixa o marcador visível; vira bloco (trava o Pôr no ar).
  const rascunho_sem_fonte = blocosSemFonte({ textos: [html] });
  const arquivo = await salvarArquivo({
    conteudo: html,
    mime: "text/html",
    caminho: caminhoNoBucket(ctx.projeto.id, execucaoId, 0, "text/html"),
    nome: nomeDoArquivo(rotuloDoNo(no), 0, 1, "text/html"),
    pastaId: await pasta(ctx),
    criadoPor: ctx.userId,
  });
  return { saida: { html_path: arquivo.path, html_url: arquivo.url, no_workspace_id: arquivo.no_id, texto: `Página pronta (${Math.round(html.length / 1024)} KB).`, rascunho_sem_fonte }, custo: r.custoUsd, usoId: r.usoId };
}

async function noAnuncio(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_ANUNCIO,
    mensagem: [
      txt(no.dados.objetivo) ? `Objetivo: ${txt(no.dados.objetivo)}` : "",
      txt(no.dados.publico) ? `Público pensado: ${txt(no.dados.publico)}` : "",
      txt(no.dados.oferta) ? `Oferta: ${txt(no.dados.oferta)}` : "",
      ...e.textos,
      e.imagens.length ? `Criativos ligados: ${e.imagens.length} imagem(ns).` : "",
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_ANUNCIO,
    maxSaida: SAIDA_ESPERADA.anuncio,
    execucaoId,
  });
  const pacote = {
    ...((r.json ?? {}) as Record<string, unknown>),
    criativos: e.imagens.map((i) => ({ path: i.path, bucket: i.bucket || "workspace" })),
    status: "pausado",
    publicado: false,
    aviso: "Rascunho: nada foi enviado para a Meta. Criar o anúncio é com a equipe, e ele nasce pausado.",
  };
  return { saida: { json: pacote, texto: `Pacote de anúncio pronto (pausado, não publicado).` }, custo: r.custoUsd, usoId: r.usoId };
}

/** Projeto "Laboratório" no Kanban do cliente da carteira (cria se não existir). */
async function projetoDoKanban(clientId: string, userId: string): Promise<string> {
  const db = servico();
  const { data } = await db.from("projects").select("id, name").eq("client_id", clientId).is("deleted_at", null).ilike("name", "Laborat%rio").limit(1);
  const achado = ((data || []) as Array<{ id: string }>)[0];
  if (achado) return achado.id;
  const hoje = new Date();
  const fim = new Date(hoje.getTime() + 365 * 86_400_000);
  const { data: novo, error } = await db
    .from("projects")
    .insert({
      client_id: clientId,
      name: "Laboratório",
      description: "Etapas que o Laboratório mandou para agentes externos (Hermes e Paperclip).",
      project_type: "marketing_digital",
      status: "active",
      progress: 0,
      start_date: hoje.toISOString().slice(0, 10),
      deadline: fim.toISOString().slice(0, 10),
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !novo) throw new ErroHttp(503, "kanban_indisponivel", "Não consegui criar o projeto Laboratório no Kanban.");
  return (novo as { id: string }).id;
}

async function noAgenteExterno(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const db = servico();
  const operador = txt(no.dados.operador, 80) || OPERADOR_HERMES;
  const { data: op } = await db.from("internal_operators").select("id, slug, display_name, status").eq("slug", operador).maybeSingle();
  const o = op as { id: string; slug: string; display_name: string; status: string } | null;
  if (!o) throw new ErroHttp(404, "operador_inexistente", `O operador "${operador}" não existe.`);
  if (o.status !== "active") throw new ErroHttp(409, "operador_inativo", `O operador ${o.display_name} está desligado.`);
  const projetoKanban = await projetoDoKanban(ctx.carteira.clientId, ctx.userId);
  const instrucao = txt(no.dados.instrucao, 4000) || "Faça a etapa descrita abaixo e relate com evidência.";
  const titulo = `Laboratório: ${rotuloDoNo(no)} (${ctx.projeto.nome})`.slice(0, 160);
  const descricao = [
    instrucao,
    e.textos.length ? `\nO que veio antes no fluxo:\n${e.textos.join("\n").slice(0, 6000)}` : "",
    e.imagens.length ? `\nArquivos ligados (Workspace global):\n${e.imagens.map((i) => `- ${i.path}`).join("\n")}` : "",
    `\nProjeto do Laboratório: ${ctx.projeto.id} · nó ${no.id} · execução ${execucaoId}.`,
    "Relate com evidência (operator_report). Ação externa, publicação, gasto ou contato com cliente exigem aprovação.",
  ].filter(Boolean).join("\n");
  const { data: t, error: eT } = await db.from("tasks").insert({ project_id: projetoKanban, title: titulo, description: descricao, status: "todo", priority: "medium", source: "laboratorio" }).select("id").single();
  if (eT || !t) throw new ErroHttp(503, "tarefa_nao_criada", "Não consegui criar a tarefa no Kanban.");
  const tarefaId = (t as { id: string }).id;
  const { error: eA } = await db.rpc("operator_assign_task", { _operator_slug: o.slug, _kanban_task_id: tarefaId, _actor: `laboratorio:${ctx.userId}`, _note: instrucao.slice(0, 500) });
  if (eA) {
    await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", tarefaId);
    throw new ErroHttp(409, "fila_recusou", `A fila do ${o.display_name} recusou a tarefa (${eA.message}). Nada ficou criado.`);
  }
  const { data: link } = await db.from("operator_task_links").select("id").eq("kanban_task_id", tarefaId).eq("operator_id", o.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const linkId = (link as { id: string } | null)?.id ?? null;
  if (linkId) {
    const { error: eD } = await db.from("operator_participations").insert({ task_link_id: linkId, kanban_task_id: tarefaId, author_kind: "humano", author_id: ctx.userId, entry_type: "instrucao", title: "Etapa do Laboratório", body: instrucao, attachments: [] });
    if (eD) registrarFalha("laboratorio: instrução não entrou no diário", eD, { link_id: linkId });
  }
  return {
    saida: { tarefa_id: tarefaId, link_id: linkId, projeto_kanban_id: projetoKanban, operador: o.slug, operador_nome: o.display_name, link: `/kanban?tarefa=${tarefaId}`, texto: `Encaminhado ao ${o.display_name}: está na fila dele, ainda não está feito. O retorno chega pelo diário da tarefa.` },
    custo: 0,
    usoId: null,
    status: "aguardando",
  };
}

// ------------------------------------------------------------------ v2: pesquisa, oferta, funil, filme, pôr no ar

/** Links no texto (reserva quando o provedor não devolve as citações). */
export function linksDoTexto(t: string): Array<{ titulo: string; url: string }> {
  const vistos = new Set<string>();
  const saida: Array<{ titulo: string; url: string }> = [];
  for (const m of String(t || "").match(/https?:\/\/[^\s)\]"'<>]+/gi) || []) {
    const url = m.replace(/[.,;:]+$/, "");
    if (vistos.has(url) || saida.length >= 30) continue;
    vistos.add(url);
    saida.push({ titulo: "", url });
  }
  return saida;
}

async function noPesquisa(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const tema = txt(no.dados.tema);
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DA_PESQUISA,
    mensagem: [tema ? `O que pesquisar: ${tema}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    maxSaida: SAIDA_ESPERADA.pesquisa,
    pesquisaWeb: true,
    timeoutMs: 300_000,
    execucaoId,
  });
  const fontes = (r.fontes && r.fontes.length ? r.fontes : linksDoTexto(r.texto)).slice(0, 30);
  const avisos = fontes.length ? [] : ["A pesquisa voltou sem fontes com link: trate os dados como hipótese."];
  return { saida: { texto: r.texto, fontes, modelo_id: r.modeloId, buscas_estimadas: BUSCAS_DA_PESQUISA, avisos }, custo: r.custoUsd, usoId: r.usoId };
}

async function noOferta(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DA_OFERTA + (txt(no.dados.instrucao) ? `\n\nPEDIDO EXTRA: ${txt(no.dados.instrucao)}` : ""),
    mensagem: [
      txt(no.dados.produto) ? `Produto: ${txt(no.dados.produto)}` : "",
      txt(no.dados.preco) ? `Preço pensado: ${txt(no.dados.preco)}` : "",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DA_OFERTA,
    maxSaida: SAIDA_ESPERADA.oferta,
    execucaoId,
  });
  const j = (r.json ?? {}) as { texto_completo?: string };
  return { saida: { texto: txt(j.texto_completo, 20000) || r.texto, json: r.json ?? null }, custo: r.custoUsd, usoId: r.usoId };
}

async function noFunil(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_FUNIL,
    mensagem: [txt(no.dados.objetivo) ? `Objetivo do funil: ${txt(no.dados.objetivo)}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_FUNIL,
    maxSaida: SAIDA_ESPERADA.funil,
    execucaoId,
  });
  const j = (r.json ?? {}) as { resumo?: string; etapas?: Array<{ nome?: string; mensagem?: string }> };
  const etapas = Array.isArray(j.etapas) ? j.etapas.map((x, i) => `${i + 1}. ${x.nome || ""}: ${x.mensagem || ""}`).join("\n") : "";
  return { saida: { texto: [txt(j.resumo, 4000), etapas].filter(Boolean).join("\n") || r.texto, json: r.json ?? null }, custo: r.custoUsd, usoId: r.usoId };
}

/** As saídas dos nós ligados antes (para o pacote do Pôr no ar e a oferta do Filme). */
export async function saidasDasEntradas(ctx: Contexto, no: NoDoCanvas): Promise<EntradaDoPacote[]> {
  const lista: EntradaDoPacote[] = [];
  for (const antes of entradasDo(ctx.canvas, no.id)) lista.push({ no: antes, saida: await saidaDe(ctx, antes) });
  return lista;
}

async function noFilme(ctx: Contexto, no: NoDoCanvas, e: Entradas, _execucaoId: string): Promise<Resultado> {
  // O filme usa a marca do cliente (logo, paleta, fontes): no Livre ele sairia com a marca da Aceleriq.
  if (ctx.carteira.livre || !ctx.projeto.client_id) throw new ErroHttp(400, "filme_sem_cliente", "O Filme da marca precisa de um cliente (usa a marca dele). Escolha o cliente do projeto.");
  const oferta = (await saidasDasEntradas(ctx, no)).find((x) => x.no.tipo === "oferta")?.saida?.json;
  const r = await rodarFilme(ctx.motion || chamadorDaMesaMotion(ctx.token), {
    clientId: ctx.projeto.client_id,
    nome: rotuloDoNo(no) === ROTULO_DO_TIPO.filme ? `Filme da marca (${ctx.projeto.nome})` : rotuloDoNo(no),
    ideia: txt(no.dados.ideia, 1500),
    textos: e.textos,
    oferta: oferta && typeof oferta === "object" ? oferta as Record<string, unknown> : null,
    formatos: formatosDoFilme(no.dados.formato),
    modeloId: txt(no.dados.modelo_id, 200) || MODELO_TEXTO_PADRAO,
  });
  return { saida: r.saida, custo: r.custo, usoId: null, status: "aguardando" };
}

/** A porta do Pôr no ar no banco (chave de serviço). Nada aqui sai do Supabase. */
export function portaDoNoAr(ctx: Pick<Contexto, "carteira" | "userId">): PortaDoNoAr {
  const db = servico();
  return {
    async operadoresAtivos() {
      const { data, error } = await db.from("internal_operators").select("id, slug, display_name, role, scope").eq("status", "active");
      if (error) throw new ErroHttp(503, "operadores_indisponiveis", "Não consegui ler os operadores agora.");
      return (data || []) as Operador[];
    },
    async pedidoAberto(projetoId, noId) {
      const { data } = await db
        .from("operator_approvals")
        .select("id, status, executed_at")
        .eq("payload->>origem", "laboratorio")
        .eq("payload->>projeto_id", projetoId)
        .eq("payload->>no_id", noId)
        .in("status", ["pendente", "adiado", "aprovado"])
        .order("created_at", { ascending: false })
        .limit(5);
      const aberto = ((data || []) as Array<{ id: string; status: string; executed_at: string | null }>).find((a) => a.status !== "aprovado" || !a.executed_at);
      return aberto ? { id: aberto.id, status: aberto.status } : null;
    },
    projetoDoKanban: () => projetoDoKanban(ctx.carteira.clientId, ctx.userId),
    async criarTarefa(t) {
      const { data, error } = await db.from("tasks").insert({ ...t, status: "todo", priority: "high", source: "laboratorio" }).select("id").single();
      if (error || !data) throw new ErroHttp(503, "tarefa_nao_criada", "Não consegui criar a tarefa no Kanban.");
      return (data as { id: string }).id;
    },
    async apagarTarefa(id) {
      await db.from("tasks").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    },
    async criarAprovacao(a) {
      const { data, error } = await db.from("operator_approvals").insert(a).select("id").single();
      if (error || !data) {
        registrarFalha("laboratorio: pedido de aprovação não criado", error);
        throw new ErroHttp(503, "aprovacao_nao_criada", "Não consegui criar o pedido de aprovação agora. Nada foi ao ar.");
      }
      return (data as { id: string }).id;
    },
    async registrar(acao, o) {
      await db.from("operator_audit_log").insert({ actor: `laboratorio:${ctx.userId}`, operator_id: o.operatorId, kanban_task_id: o.taskId, action: acao, approval_required: true });
    },
    async avisarAdmins(mensagem, link) {
      const { data } = await db.from("user_roles").select("user_id").eq("role", "admin");
      const linhas = ((data || []) as Array<{ user_id: string }>).map((u) => ({ user_id: u.user_id, message: mensagem, notification_type: "aprovacao_necessaria", link }));
      if (linhas.length) await db.from("notifications").insert(linhas);
    },
    async lerAprovacao(id) {
      const { data } = await db
        .from("operator_approvals")
        .select("id, status, executed_at, execution_evidence, decision_note, task_link_id, kanban_task_id, payload, operator:internal_operators!operator_approvals_operator_id_fkey(slug)")
        .eq("id", id)
        .maybeSingle();
      if (!data) return null;
      const d = data as Record<string, unknown>;
      const op = d.operator as { slug?: string } | null;
      return { ...(d as unknown as AprovacaoLida), operator_slug: op?.slug ?? null, payload: (d.payload || {}) as Record<string, unknown> };
    },
    async entregarAoOperador(slug, taskId, nota) {
      const { data, error } = await db.rpc("operator_assign_task", { _operator_slug: slug, _kanban_task_id: taskId, _actor: `laboratorio:${ctx.userId}`, _note: nota.slice(0, 500) });
      if (error) throw new Error(error.message);
      const link = (data as { link_id?: string } | null)?.link_id;
      return link ? String(link) : null;
    },
    async ligarAprovacao(aprovacaoId, linkId) {
      await db.from("operator_approvals").update({ task_link_id: linkId }).eq("id", aprovacaoId).is("task_link_id", null);
    },
    async instruir(linkId, taskId, corpo) {
      const { error } = await db.from("operator_participations").insert({ task_link_id: linkId, kanban_task_id: taskId, author_kind: "humano", author_id: ctx.userId, entry_type: "instrucao", title: "Pôr no ar (aprovado pelo dono)", body: corpo, attachments: [] });
      if (error) registrarFalha("laboratorio: instrução do Pôr no ar não entrou no diário", error, { link_id: linkId });
    },
    async statusDoVinculo(linkId) {
      const { data } = await db.from("operator_task_links").select("status").eq("id", linkId).maybeSingle();
      return (data as { status?: string } | null)?.status ?? null;
    },
  };
}

/**
 * v3 (clickmax-rea.md): os especialistas de criação (avatar, order bump, upsell, downsell, sequência de
 * ofertas, seções da página, sequência de mensagens, refino de tom). Uma chamada de texto com esquema;
 * o texto legível vai para os nós seguintes e o json fica no nó.
 */
async function noEspecialista(ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const esp = ESPECIALISTAS[no.tipo as keyof typeof ESPECIALISTAS];
  if (!esp) throw new ErroHttp(400, "no_nao_executavel", `${ROTULO_DO_TIPO[no.tipo]} não tem especialista.`);
  const r = await texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: esp.sistema,
    mensagem: [...esp.pedido(no.dados), ...e.textos].filter(Boolean).join("\n\n"),
    esquema: esp.esquema,
    maxSaida: SAIDA_ESPERADA[no.tipo] || 2500,
    timeoutMs: no.tipo === "sequencia_mensagens" || no.tipo === "refino_tom" ? 240_000 : undefined,
    execucaoId,
  });
  const j = (r.json && typeof r.json === "object" ? r.json : {}) as Record<string, unknown>;
  return { saida: { texto: esp.texto(j).slice(0, 20000) || r.texto, json: r.json ?? null }, custo: r.custoUsd, usoId: r.usoId };
}

/** As saídas atuais de todos os nós antes deste (para a trava do Pôr no ar). */
export async function saidasDosAncestrais(ctx: Contexto, no: NoDoCanvas): Promise<Record<string, unknown>> {
  const saidas: Record<string, unknown> = {};
  for (const id of ancestraisDe(ctx.canvas, no.id)) {
    const n = ctx.canvas.nos.find((x) => x.id === id);
    if (n) saidas[id] = await saidaDe(ctx, n);
  }
  return saidas;
}

async function noPorNoAr(ctx: Contexto, no: NoDoCanvas, _e: Entradas, execucaoId: string): Promise<Resultado> {
  // Regra contra invenção: bloco de prova ou número sem fonte antes do Pôr no ar trava o pedido.
  const trava = travaDoNoAr(ctx.canvas, no.id, await saidasDosAncestrais(ctx, no));
  if (trava.travado) throw new ErroHttp(409, "rascunho_sem_fonte", trava.motivo, { blocos: trava.blocos });
  const saida = await pedirNoAr(portaDoNoAr(ctx), {
    projetoId: ctx.projeto.id,
    projetoNome: ctx.projeto.nome,
    nomeDoCliente: ctx.nomeDoCliente,
    execucaoId,
    no,
    entradas: await saidasDasEntradas(ctx, no),
    userId: ctx.userId,
  });
  return { saida, custo: 0, usoId: null, status: "aguardando" };
}

const EXECUTORES: Record<string, (ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string) => Promise<Resultado>> = {
  agente: noAgente,
  copy: noCopy,
  imagem: noImagem,
  carrossel: noCarrossel,
  logo: noLogo,
  landing: noLanding,
  anuncio: noAnuncio,
  agente_externo: noAgenteExterno,
  pesquisa: noPesquisa,
  oferta: noOferta,
  funil: noFunil,
  filme: noFilme,
  por_no_ar: noPorNoAr,
  ...Object.fromEntries(NOS_ESPECIALISTAS.map((t) => [t, noEspecialista])),
};

/** Roda um nó numa execução já criada e grava o fim (pronto, aguardando ou erro). Devolve a saída ou lança. */
export async function rodarNo(ctx: Contexto, no: NoDoCanvas, execucaoId: string): Promise<SaidaDoNo> {
  const fn = EXECUTORES[no.tipo];
  if (!fn) throw new ErroHttp(400, "no_nao_executavel", `${ROTULO_DO_TIPO[no.tipo] || no.tipo} não roda: ele só guarda dado.`);
  await atualizarExecucao(execucaoId, { status: "rodando" });
  try {
    const e = await entradasMontadas(ctx, no);
    // Landing e anúncio também valem com o próprio objetivo (e a landing com as seções), sem Contexto ligado.
    const pedidoNoNo = ["prompt", "tema", "instrucao", "objetivo", "secoes", "oferta", "produto", "ideia", "publico", "tom"].some((k) => !!txt(no.dados[k]));
    if ((["imagem", "carrossel", "copy", "agente", "landing", "anuncio", "pesquisa", "oferta", "funil", "filme"].indexOf(no.tipo) >= 0 || NOS_ESPECIALISTAS.indexOf(no.tipo) >= 0) && !e.textos.length && !e.imagens.length && !pedidoNoNo) {
      throw new ErroHttp(400, "no_sem_entrada", `Ligue um Contexto (ou escreva o pedido) em ${rotuloDoNo(no)} antes de rodar.`);
    }
    const r = await fn(ctx, no, e, execucaoId);
    // Regra contra invenção: o que o nó escreveu sem fonte vira bloco rascunho_sem_fonte na saída.
    if (NOS_COM_PROVA.indexOf(no.tipo) >= 0 && !Array.isArray(r.saida.rascunho_sem_fonte)) {
      const j = r.saida.json && typeof r.saida.json === "object" ? r.saida.json as Record<string, unknown> : {};
      r.saida.rascunho_sem_fonte = blocosSemFonte({ declarados: j.blocos_sem_fonte, textos: [r.saida.texto, r.saida.json] });
    }
    ctx.saidas.set(no.id, r.saida);
    await atualizarExecucao(execucaoId, { status: r.status || "pronto", saida: r.saida, custo_usd: arred(r.custo), uso_id: r.usoId, finished_at: r.status === "aguardando" ? null : new Date().toISOString() });
    return r.saida;
  } catch (err) {
    // Pôr no ar com pedido já aberto: a execução nova não vale (a tela segue mostrando o pedido aberto).
    // Pôr no ar travado por bloco sem fonte: idem (a tela mostra a trava com a lista dos blocos).
    if (err instanceof ErroHttp && (err.codigo === "ja_pedido" || err.codigo === "rascunho_sem_fonte")) {
      await servico().from("lab_execucoes").delete().eq("id", execucaoId).eq("status", "rodando");
      throw err;
    }
    const motivo = err instanceof ErroHttp ? err.message : motivoDaFalha(err);
    await atualizarExecucao(execucaoId, { status: "erro", erro: motivo, finished_at: new Date().toISOString() });
    throw err;
  }
}

/**
 * Rodar tudo: ordem topológica; cada nó executável ganha a linha na_fila antes de começar (a tela vê o plano todo).
 * Nó que falha marca erro nele e nos que dependem dele; saldo, cota ou chave param a rodada.
 */
export async function rodarTudo(ctx: Contexto, alvos: string[] | null): Promise<{ ordem: string[]; execucoes: Record<string, string> }> {
  const ordem = ordemTopologica(ctx.canvas, alvos).filter((id) => {
    const no = ctx.canvas.nos.find((n) => n.id === id);
    return !!no && ehExecutavel(no.tipo);
  });
  const execucoes: Record<string, string> = {};
  for (const id of ordem) {
    const no = ctx.canvas.nos.find((n) => n.id === id)!;
    execucoes[id] = await criarExecucao({ projetoId: ctx.projeto.id, no, status: "na_fila", entrada: { rodada: true }, rodadaId: ctx.rodadaId, userId: ctx.userId });
  }
  return { ordem, execucoes };
}

export async function seguirRodada(ctx: Contexto, ordem: string[], execucoes: Record<string, string>): Promise<void> {
  const falhos = new Set<string>();
  const esperando = new Set<string>();
  let parar: string | null = null;
  for (const id of ordem) {
    const no = ctx.canvas.nos.find((n) => n.id === id)!;
    if (parar) {
      await atualizarExecucao(execucoes[id], { status: "erro", erro: parar, finished_at: new Date().toISOString() });
      continue;
    }
    const antes = ctx.canvas.ligacoes.filter((l) => l.para === id).map((l) => l.de);
    if (antes.some((a) => falhos.has(a))) {
      falhos.add(id);
      await atualizarExecucao(execucoes[id], { status: "erro", erro: "Um nó antes deste falhou; nada foi gerado aqui.", finished_at: new Date().toISOString() });
      continue;
    }
    // O Filme fica esperando a escolha do storyboard: quem depende dele espera também (roda depois).
    if (antes.some((a) => esperando.has(a))) {
      esperando.add(id);
      await atualizarExecucao(execucoes[id], { status: "aguardando", saida: { texto: "Espera o Filme ficar pronto (escolha o storyboard); rode este nó depois." }, finished_at: null });
      continue;
    }
    try {
      await rodarNo(ctx, no, execucoes[id]);
      if (no.tipo === "filme") esperando.add(id);
    } catch (err) {
      falhos.add(id);
      if (erroQueSobe(err)) parar = `Rodada parada: ${err instanceof Error ? err.message : motivoDaFalha(err)}`;
    }
  }
}
