/**
 * laboratorio: os nós criativos no motor da casa (20/10/2026).
 *
 * Resultado (imagem) e Carrossel geram pela Arte rápida do Estúdio (função estudio-arte, origem 'laboratorio'),
 * o mesmo motor da Mesa e do Estúdio livre: um motor só, nunca uma cópia. O Laboratório chama como a pessoa
 * (JWT de quem rodou, como o Filme chama a mesa-motion), e a estudio-arte confere equipe e acesso de novo:
 *
 *   rodar      → rapida_preparar { origem: 'laboratorio', client_id | sem_marca, pedido, peca, laminas, formato,
 *                arquivos (fotos da Mídia copiadas para a pasta do cliente no bucket mesa), documentos (copy e
 *                conteúdo) } → enfileirar { trabalho_id, ordens, corrigir_sozinho: true } (fila do servidor da
 *                estudio-arte: um passo por invocação, sem estourar a CPU). O nó fica 'aguardando'.
 *   acompanhar → lê estudio_trabalhos e estudio_fila; com as lâminas prontas, copia cada uma para
 *                Laboratório/<Livres | cliente>/<projeto> (Workspace global; nada vai para a Mesa do cliente,
 *                que só lista origem 'mesa') e o nó fica 'pronto'.
 *   ajustar    → ajustar_card { trabalho_id, ordem, instrucao, confirmado } (o ajuste da Mesa: anexos e identidade).
 *   variar     → N ajustes "variação" sobre a lâmina escolhida (mesmo texto e marca, outra composição).
 *
 * Sem cliente: a estudio-arte guarda a arte sob o cliente interno da agência, sem marca, e cobra a carteira do
 * Estúdio livre, que debita os créditos do Laboratório pelo custo real (migration 20261020002646). Por isso o
 * Laboratório não reserva nem estorna esses nós (creditos.ts, foraDaReserva): só confere o saldo antes.
 */
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { clienteInternoDaAgencia } from "../_shared/nucleo-das-mesas.ts";
import { ErroHttp, servico } from "./comum.ts";
import type { Contexto, Entradas, ImagemSaida, SaidaDoNo } from "./executar.ts";
import type { EntradaDoPacote } from "./no-ar.ts";
import { configDe, gravityDe, limitar, type NoDoCanvas } from "./modulos/regras.ts";
import { andamentoDoEstudio, type EntradaDoMotor, marcaIdDoCanvas, materiaisDoMotor, type UsoDaEntrada } from "./modulos/motor.ts";

export type ChamarFuncao = (acao: string, corpo: Record<string, unknown>) => Promise<Record<string, unknown>>;
type Resultado = { saida: SaidaDoNo; custo: number; usoId: string | null; status?: "pronto" | "aguardando" };

/** Chama a estudio-arte como a pessoa (resposta com fôlego: espaços antes do JSON). */
export function chamadorDoEstudio(token: string): ChamarFuncao {
  return async (acao, corpo) => {
    let res: Response;
    try {
      res = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/estudio-arte`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "", "Content-Type": "application/json", "x-client-info": "laboratorio-motor" },
        body: JSON.stringify({ ...corpo, acao }),
        redirect: "error",
        signal: AbortSignal.timeout(330_000),
      });
    } catch {
      throw new ErroHttp(504, "estudio_sem_resposta", "O Estúdio não respondeu a tempo. Confira o nó antes de pedir de novo.");
    }
    const texto = await res.text();
    let data: Record<string, unknown> | null = null;
    try {
      const lido = JSON.parse(texto.trim());
      data = lido && typeof lido === "object" && !Array.isArray(lido) ? lido : null;
    } catch { /* corpo não é JSON */ }
    if (!data) throw new ErroHttp(502, "estudio_sem_resposta", "O Estúdio respondeu sem dados.");
    if (typeof data.error === "string" || typeof data.erro === "string") {
      const codigo = String(data.error || data.erro);
      const status = Number(data.status_http) || (res.status >= 400 ? res.status : 502);
      throw new ErroHttp(status, codigo, String(data.mensagem || "O Estúdio recusou o pedido."));
    }
    if (!res.ok) throw new ErroHttp(res.status, "estudio_falhou", "O Estúdio recusou o pedido.");
    return data;
  };
}

/** O que o motor usa de fora (o teste troca por uma falsa). */
export interface PortaDoMotor {
  estudio: ChamarFuncao;
  clienteDoLivre(): Promise<string | null>;
  /** Copia a foto (bucket do Laboratório) para a pasta do cliente no bucket mesa (onde a Arte rápida lê). */
  copiarParaOEstudio(foto: { bucket: string; path: string; nome: string }, clientId: string): Promise<string | null>;
  lerTrabalho(id: string): Promise<{ id: string; client_id: string; direcao: unknown; cards: unknown; status: string } | null>;
  lerFila(trabalhoId: string): Promise<Array<{ ordem: unknown; status: unknown; erro_mensagem: unknown }>>;
  /** Guarda a lâmina pronta (bucket mesa) na pasta do projeto no Laboratório. */
  guardar(o: { path: string; rotulo: string; indice: number; total: number; execucaoId: string }): Promise<ImagemSaida | null>;
}

export type PecaDoMotor = { trabalho_id: string; ordem: number; versao: number; path: string };
export type SaidaDoMotor = SaidaDoNo & {
  motor: "estudio_arte";
  estudio_trabalhos: string[];
  etapa: "gerando" | "pronto" | "parado";
  pecas: PecaDoMotor[];
  usou: UsoDaEntrada[];
  render_progresso: number;
};

const txt = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

// ------------------------------------------------------------------ rodar

/**
 * Prepara e põe na fila do Estúdio. Resultado com quantidade N vira N artes (N trabalhos, até 4);
 * Carrossel vira um trabalho com as lâminas. Volta 'aguardando'; o no_acompanhar termina.
 */
export async function rodarNoEstudio(porta: PortaDoMotor, ctx: Pick<Contexto, "projeto" | "canvas" | "carteira">, no: NoDoCanvas, entradas: EntradaDoPacote[], _execucaoId: string): Promise<Resultado> {
  const cfg = configDe(ctx.canvas, no);
  const gravity = gravityDe(ctx.canvas, no);
  const m = materiaisDoMotor(no, entradas as EntradaDoMotor[], { proporcao: cfg.proporcao, prompt_base: gravity?.prompt_base || null, laminas: limitar(no.dados.laminas, 2, 10, 5) });
  const clienteDoProjeto = ctx.projeto.client_id;
  const clienteDoTrabalho = clienteDoProjeto || (await porta.clienteDoLivre());
  if (!clienteDoTrabalho) throw new ErroHttp(409, "sem_cliente_interno", "O cliente interno da agência não foi encontrado: sem ele não dá para gerar sem cliente no Estúdio.");
  const arquivos: Array<{ caminho: string; nome: string; papel: string }> = [];
  for (const f of m.fotos) {
    const caminho = await porta.copiarParaOEstudio(f, clienteDoTrabalho).catch((e) => (registrarFalha("laboratorio: foto não foi para o Estúdio", e), null));
    if (caminho) arquivos.push({ caminho, nome: f.nome, papel: f.papel });
  }
  // 20/10: a marca escolhida no nó Marca (cliente com duas marcas); sem ela, a estudio-arte decide ou pede.
  const marcaId = clienteDoProjeto ? marcaIdDoCanvas(ctx.canvas, no.id) : null;
  const quantas = no.tipo === "carrossel" ? 1 : Math.min(4, cfg.quantidade);
  const trabalhos: string[] = [];
  for (let i = 0; i < quantas; i++) {
    const corpo: Record<string, unknown> = {
      origem: "laboratorio",
      pedido: quantas > 1 ? `${m.pedido}\n\nVariação ${i + 1} de ${quantas}: mesma mensagem, composição diferente das outras.` : m.pedido,
      peca: m.peca,
      formato: m.formato,
      arquivos,
      documentos: m.documentos,
      ...(m.laminas ? { laminas: m.laminas } : {}),
      ...(clienteDoProjeto ? { client_id: clienteDoProjeto } : { sem_marca: true }),
      ...(marcaId ? { marca_id: marcaId } : {}),
      ...(cfg.motor ? { modelo_imagem_id: cfg.motor } : {}),
      ...(cfg.qualidade ? { qualidade: cfg.qualidade } : {}),
    };
    let r: Record<string, unknown>;
    try {
      r = await porta.estudio("rapida_preparar", corpo);
    } catch (err) {
      if (err instanceof ErroHttp && err.codigo === "escolha_a_marca") {
        throw new ErroHttp(400, "escolha_a_marca", "Este cliente tem mais de uma marca. Ligue um nó Marca neste nó e escolha a marca nele antes de gerar.");
      }
      throw err;
    }
    const t = r.trabalho && typeof r.trabalho === "object" ? (r.trabalho as Record<string, unknown>) : {};
    const id = txt(t.id, 64);
    if (!id) throw new ErroHttp(502, "estudio_sem_trabalho", "O Estúdio não devolveu o trabalho da arte.");
    const ordens = (Array.isArray((t.direcao as Record<string, unknown> | undefined)?.cards) ? ((t.direcao as Record<string, unknown>).cards as Array<Record<string, unknown>>) : []).map((c) => Number(c.ordem)).filter((n) => Number.isInteger(n) && n > 0);
    await porta.estudio("enfileirar", { trabalho_id: id, ordens: ordens.length ? ordens : [1], corrigir_sozinho: true, ...(marcaId ? { marca_id: marcaId } : {}) });
    trabalhos.push(id);
  }
  const saida: SaidaDoMotor = {
    motor: "estudio_arte",
    estudio_trabalhos: trabalhos,
    etapa: "gerando",
    pecas: [],
    imagens: [],
    usou: m.usou,
    render_progresso: 0,
    texto: `Gerando no Estúdio (motor da casa): ${no.tipo === "carrossel" ? `carrossel de ${m.laminas} lâminas` : `${quantas} arte${quantas > 1 ? "s" : ""}`}. Acompanhe no nó.`,
    avisos: m.fotos.length && arquivos.length < m.fotos.length ? ["Alguma foto da Mídia não foi para o Estúdio; a arte seguiu sem ela."] : [],
  };
  return { saida, custo: 0, usoId: null, status: "aguardando" };
}

// ------------------------------------------------------------------ acompanhar

/** Lê o andamento; com tudo pronto, guarda as lâminas na pasta do projeto e o nó fica pronto. */
export async function acompanharNoEstudio(porta: PortaDoMotor, saida: SaidaDoMotor, execucaoId: string, rotulo: string): Promise<{ saida: SaidaDoMotor; status: "aguardando" | "pronto" | "erro"; erro?: string }> {
  const andamentos = [];
  for (const id of saida.estudio_trabalhos || []) {
    const t = await porta.lerTrabalho(id);
    if (!t) return { saida, status: "erro", erro: "O trabalho do Estúdio não existe mais." };
    andamentos.push({ id, a: andamentoDoEstudio(t, await porta.lerFila(id)) });
  }
  const total = andamentos.reduce((s, x) => s + x.a.total, 0);
  const prontas = andamentos.reduce((s, x) => s + x.a.prontas.length, 0);
  const progresso = total ? Math.round((prontas / total) * 100) : 0;
  if (!andamentos.every((x) => x.a.terminou)) {
    return { saida: { ...saida, render_progresso: progresso, texto: `Gerando no Estúdio: ${prontas} de ${total} pronta${total === 1 ? "" : "s"}.` }, status: "aguardando" };
  }
  const erros = andamentos.flatMap((x) => x.a.erros);
  const pecas: PecaDoMotor[] = [];
  for (const x of andamentos) for (const l of x.a.prontas) pecas.push({ trabalho_id: x.id, ordem: l.ordem, versao: l.versao, path: l.storage_path });
  if (!pecas.length) return { saida: { ...saida, etapa: "parado", render_progresso: 0, avisos: erros }, status: "erro", erro: erros[0] || "O Estúdio não gerou a arte." };
  const imagens: ImagemSaida[] = [];
  for (let i = 0; i < pecas.length; i++) {
    const img = await porta.guardar({ path: pecas[i].path, rotulo, indice: i, total: pecas.length, execucaoId });
    if (img) imagens.push({ ...img, ordem: i + 1 });
  }
  if (!imagens.length) return { saida: { ...saida, etapa: "parado" }, status: "erro", erro: "As artes ficaram prontas, mas não consegui guardar na pasta do Laboratório." };
  return {
    saida: { ...saida, etapa: "pronto", pecas, imagens, render_progresso: 100, avisos: erros, texto: `Pronto no Estúdio: ${imagens.length} arte${imagens.length > 1 ? "s" : ""} na pasta do projeto.${erros.length ? ` ${erros.length} lâmina(s) com erro.` : ""}` },
    status: "pronto",
  };
}

// ------------------------------------------------------------------ ajustar e variar

export const MAX_PEDIDO_DO_AJUSTE = 500;
export const MAX_VARIACOES = 4;

/** A peça do índice escolhido (a imagem i da saída). */
export function pecaDoIndice(saida: Partial<SaidaDoMotor>, indice: number): PecaDoMotor | null {
  const p = Array.isArray(saida.pecas) ? saida.pecas[indice] : null;
  return p && p.trabalho_id && Number.isInteger(p.ordem) ? p : null;
}

/** A versão mais nova de uma lâmina, depois do ajuste. */
async function versaoNova(porta: PortaDoMotor, peca: PecaDoMotor): Promise<PecaDoMotor | null> {
  const t = await porta.lerTrabalho(peca.trabalho_id);
  if (!t) return null;
  const a = andamentoDoEstudio(t, []);
  const l = a.prontas.find((x) => x.ordem === peca.ordem);
  return l && l.versao > peca.versao ? { ...peca, versao: l.versao, path: l.storage_path } : null;
}

/**
 * Ajuste (no_ajustar) ou variações (no_variar) da lâmina escolhida, pelo ajuste da estudio-arte. Devolve a saída
 * nova (as imagens novas guardadas na pasta do projeto). Variação é ajuste com o pedido de outra composição.
 */
export async function ajustarNoEstudio(porta: PortaDoMotor, saida: Partial<SaidaDoMotor>, o: { indice: number; pedido: string | null; variacoes: number; execucaoId: string; rotulo: string }): Promise<SaidaDoMotor> {
  const peca = pecaDoIndice(saida, o.indice);
  if (!peca) throw new ErroHttp(400, "indice_invalido", "Escolha uma das imagens geradas por este nó.");
  const pedidos = o.pedido
    ? [o.pedido]
    : Array.from({ length: Math.max(1, Math.min(MAX_VARIACOES, o.variacoes)) }, (_, i) => `Variação ${i + 1}: mesma peça, mesmo texto, mesma marca e mesma foto real; mude a composição e o enquadramento.`);
  const novas: PecaDoMotor[] = [];
  let atual = peca;
  for (const instrucao of pedidos) {
    await porta.estudio("ajustar_card", { trabalho_id: peca.trabalho_id, ordem: peca.ordem, instrucao, confirmado: true });
    const v = await versaoNova(porta, atual);
    if (!v) continue;
    novas.push(v);
    // Variação parte sempre da escolhida; o ajuste encadeia na versão que acabou de sair.
    if (o.pedido) atual = v;
  }
  if (!novas.length) throw new ErroHttp(502, "ajuste_sem_versao", "O Estúdio não devolveu a versão nova da arte.");
  const imagens: ImagemSaida[] = [];
  for (let i = 0; i < novas.length; i++) {
    const img = await porta.guardar({ path: novas[i].path, rotulo: `${o.rotulo} ${o.pedido ? "ajuste" : "variação"}`, indice: i, total: novas.length, execucaoId: o.execucaoId });
    if (img) imagens.push({ ...img, ordem: i + 1 });
  }
  return {
    motor: "estudio_arte",
    estudio_trabalhos: [...new Set(novas.map((n) => n.trabalho_id))],
    etapa: "pronto",
    pecas: novas,
    imagens,
    usou: Array.isArray(saida.usou) ? saida.usou : [],
    render_progresso: 100,
    texto: o.pedido ? `Ajuste pronto no Estúdio: "${o.pedido.slice(0, 120)}".` : `${imagens.length} variação(ões) prontas no Estúdio.`,
  };
}

// ------------------------------------------------------------------ a porta de verdade

/** A porta de verdade; `guardar` vem de executar.ts (a mesma pasta dos outros nós). */
export function portaDoMotor(o: { token: string; guardar: PortaDoMotor["guardar"] }): PortaDoMotor {
  const db = servico();
  return {
    estudio: chamadorDoEstudio(o.token),
    // A arte livre (sem cliente) fica sob o cliente interno da agência, sem marca, e a estudio-arte cobra a carteira
    // do Estúdio livre (estudio_livre_trabalhos → créditos do Laboratório, migration 20261020002646).
    clienteDoLivre: () => clienteInternoDaAgencia(db),
    async copiarParaOEstudio(foto, clientId) {
      const { data, error } = await db.storage.from(foto.bucket || "workspace").download(foto.path);
      if (error || !data) return null;
      const ext = (foto.path.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
      const caminho = `${clientId}/estudio/fotos/lab-${crypto.randomUUID()}.${ext}`;
      const up = await db.storage.from("mesa").upload(caminho, data, { contentType: data.type || "image/jpeg", upsert: false });
      return up.error ? null : caminho;
    },
    async lerTrabalho(id) {
      const { data } = await db.from("estudio_trabalhos").select("id, client_id, direcao, cards, status").eq("id", id).maybeSingle();
      return (data as { id: string; client_id: string; direcao: unknown; cards: unknown; status: string } | null) ?? null;
    },
    async lerFila(trabalhoId) {
      const { data } = await db.from("estudio_fila").select("ordem, status, erro_mensagem, criado_em").eq("trabalho_id", trabalhoId).order("criado_em", { ascending: false }).limit(60);
      // Só a linha mais nova de cada lâmina conta (uma lâmina pode ter falhado e voltado depois).
      const vistas = new Set<number>();
      return ((data || []) as Array<{ ordem: unknown; status: unknown; erro_mensagem: unknown }>).filter((f) => {
        const k = Number(f.ordem);
        if (vistas.has(k)) return false;
        vistas.add(k);
        return true;
      });
    },
    guardar: o.guardar,
  };
}

/** Bytes de uma lâmina do Estúdio (bucket mesa). */
export async function baixarDoEstudio(path: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (!path || path.indexOf("..") >= 0) return null;
  const { data, error } = await servico().storage.from("mesa").download(path);
  if (error || !data) return null;
  return { bytes: new Uint8Array(await data.arrayBuffer()), mime: data.type || "image/png" };
}

export type { Entradas };
