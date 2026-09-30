/**
 * mesa-identidade: "Completar marca existente" (frente IDV3, 30/09/2026).
 * Pedido do dono: "criar o material completo usando tudo para marcas
 * existentes que só têm logo e nome, e deixar completa e profissional".
 *
 * - logo_ler { projeto_id, modelo_id? } -> { projeto, leitura } (IA com visão, custo antes pela ação estimar,
 *   alvo "leitura"): forma, estilo, tipo de logo e a fonte parecida (famílias do Google Fonts como
 *   SUGESTÃO, conferidas no catálogo). Só lê: a logo nunca é redesenhada. As cores saem por código na tela.
 * - video_registrar { projeto_id, filme_id } -> { projeto } (sem IA): o filme criado na Mesa Motion a partir
 *   do projeto entra em dados.videos, conferido no banco (mesmo cliente e mesma marca), e vira evento.
 * - completar_registrar { projeto_id } -> { projeto } (sem IA): a rodada do "Completar tudo" terminou;
 *   o resumo e as provas vão para o documento de entrega (idv_eventos, marca_completada).
 *
 * O agente (completar_marca) roda aqui só os passos que a função faz sozinha (leitura por visão e
 * estratégia); os passos por código (versões, paleta, grafismos, peças, mockups, brandbook, vídeo)
 * ficam pendentes para a mesa, que retoma sem custo. Sem travessão.
 */

import { carregarModelo, chamarTexto, estimarComModelo, modeloPadrao, type ModeloIa } from "../_shared/ia-motor.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { TAMANHOS_DA_IDENTIDADE } from "../_shared/identidade-etapas.ts";
import { catalogoParaALeitura, ESQUEMA_DA_LEITURA, normalizarLeituraPorVisao, SISTEMA_DA_LEITURA } from "./modulos/leitura-da-logo.ts";
import { juntarPerguntas, novaExecucao, normalizarExecucao, type OpcoesDoCompletar, PASSOS_DO_SERVIDOR, planoDeCompletar, rotuloDoPasso } from "./modulos/completar-marca.ts";
import {
  AGENTE,
  baixarDoBucket,
  type Chamador,
  dadosComParte,
  ErroHttp,
  gravarProjeto,
  idDe,
  json,
  type LinhaDoProjeto,
  lerProjeto,
  modeloDoPapel,
  nomeDaMarca,
  raciocinioPara,
  registrarEvento,
  servico,
  TAREFA,
} from "./comum.ts";
import { montarEstrategia } from "./estrategia-acoes.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** Modelo da leitura por visão: o escolhido na hora; senão o padrão de leitura; senão o do papel identidade. */
export async function modeloDaVisao(escolhido?: unknown): Promise<ModeloIa> {
  if (typeof escolhido === "string" && escolhido.trim()) return await carregarModelo(escolhido.trim(), "texto");
  const leitura = await modeloPadrao("leitura");
  if (leitura) return leitura;
  return await modeloDoPapel("identidade");
}

export async function estimativaDaLeitura(modeloId?: unknown): Promise<{ estimativa_usd: number; modelo_id: string }> {
  const m = await modeloDaVisao(modeloId);
  const t = TAMANHOS_DA_IDENTIDADE.leitura;
  return { estimativa_usd: estimarComModelo(m, { tokensEntrada: t.entrada, tokensSaida: t.saida }), modelo_id: m.id };
}

/** A logo principal do projeto em bytes (a prévia PNG; SVG sem prévia não vai para a visão). */
async function bytesDaLogo(p: LinhaDoProjeto): Promise<{ bytes: Uint8Array; mime: string } | null> {
  const logo = obj(obj(obj(p.dados.sistema).logos).principal);
  const previa = typeof logo.previa_png === "string" ? logo.previa_png : "";
  const caminho = typeof logo.caminho === "string" ? logo.caminho : "";
  const alvo = previa || (/\.(png|jpe?g|webp)$/i.test(caminho) ? caminho : "");
  if (!alvo) return null;
  const bytes = await baixarDoBucket(p.client_id, alvo, 6_000_000);
  if (!bytes) return null;
  const mime = /\.jpe?g$/i.test(alvo) ? "image/jpeg" : /\.webp$/i.test(alvo) ? "image/webp" : "image/png";
  return { bytes, mime };
}

/** Leitura por visão: o modelo descreve a logo (nunca a refaz). Grava em dados.leitura_da_logo.visao. */
export async function lerLogoComVisao(ch: Chamador, p: LinhaDoProjeto, modeloId?: unknown) {
  const img = await bytesDaLogo(p);
  if (!img) throw new ErroHttp(409, "sem_logo", "Envie a logo principal (arquivo real) no Sistema antes de ler.");
  const modelo = await modeloDaVisao(modeloId);
  const nome = await nomeDaMarca(p.client_id, p.marca_id);
  const leituraAntes = obj(p.dados.leitura_da_logo);
  const saida = await chamarTexto({
    clientId: p.client_id,
    tarefa: TAREFA,
    agente: AGENTE,
    modeloId: modelo.id,
    raciocinio: raciocinioPara(modelo),
    sistema: SISTEMA_DA_LEITURA,
    mensagens: [
      {
        papel: "usuario",
        conteudo: `DADOS:\n${JSON.stringify({ marca: String(obj(p.dados.naming).nome || nome), cores_lidas_por_codigo: Array.isArray(leituraAntes.cores) ? leituraAntes.cores : [], CATALOGO: catalogoParaALeitura() })}`,
        imagens: [{ bytes: img.bytes, mime: img.mime, nome: "logo" }],
      },
    ],
    esquemaJson: ESQUEMA_DA_LEITURA,
    maxTokensSaida: TAMANHOS_DA_IDENTIDADE.leitura.saida * 2,
    referencia: { tipo: "idv_projeto", id: p.id },
    criadoPor: ch.userId,
  });
  const visao = normalizarLeituraPorVisao(saida.json, modelo.id);
  const perguntas = juntarPerguntas(obj(p.dados.completar).perguntas, visao.perguntas.map((t) => ({ texto: t, passo: "leitura" as const })));
  let dados = dadosComParte(p.dados, "leitura_da_logo", { visao });
  dados = dadosComParte(dados, "completar", { perguntas });
  const projeto = await gravarProjeto(p, { dados, custo_usd: p.custo_usd + saida.custoUsd });
  return { projeto, leitura: visao, antes: leituraAntes.visao ?? null, custo_usd: saida.custoUsd, saldo_usd: saida.saldoUsd };
}

export async function logoLer(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  if (p.estado === "arquivado") throw new ErroHttp(409, "projeto_arquivado", "Este projeto está arquivado. Desarquive para editar.");
  const r = await lerLogoComVisao(ch, p, corpo.modelo_id);
  return json({ projeto: r.projeto, leitura: r.leitura, custo_usd: r.custo_usd, saldo_usd: r.saldo_usd });
}

// ------------------------------------------------------------------ vídeo da marca (Mesa Motion)

/** O filme criado na Mesa Motion a partir do projeto: conferido no banco antes de entrar em dados.videos. */
export async function videoRegistrar(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const filmeId = idDe(corpo.filme_id, "filme_id");
  const { data, error } = await servico().from("motion_filmes").select("id, client_id, marca_id, nome, tipo").eq("id", filmeId).maybeSingle();
  if (error) {
    registrarFalha("mesa-identidade: filme não lido", error, { filme_id: filmeId });
    throw new ErroHttp(503, "filme_indisponivel", "Não foi possível conferir o filme na Mesa Motion agora.");
  }
  const f = data as { id: string; client_id: string; marca_id: string | null; nome: string; tipo: string } | null;
  if (!f || f.client_id !== p.client_id) throw new ErroHttp(404, "filme_inexistente", "Este filme não é deste cliente.");
  if ((f.marca_id || null) !== (p.marca_id || null)) throw new ErroHttp(409, "filme_de_outra_marca", "Este filme é de outra marca.");
  const antes = Array.isArray(p.dados.videos) ? (p.dados.videos as Array<Record<string, unknown>>) : [];
  const lista = antes.filter((v) => v.filme_id !== f.id).concat([{ filme_id: f.id, tipo: f.tipo === "filme_marca" ? "filme_marca" : "apresentacao", nome: String(f.nome || "").slice(0, 120), criado_em: new Date().toISOString() }]).slice(-6);
  const projeto = await gravarProjeto(p, { dados: { ...p.dados, videos: lista } });
  await registrarEvento({ clientId: p.client_id, marcaId: p.marca_id, projetoId: p.id, tipo: "video_da_marca", resumo: `Vídeo da marca criado na Mesa Motion: ${f.nome}.`, provas: { filme_id: f.id, tipo: f.tipo }, userId: ch.userId });
  return json({ projeto, custo_usd: 0 });
}

// ------------------------------------------------------------------ fim da rodada (documento de entrega)

export async function completarRegistrar(ch: Chamador, corpo: Record<string, unknown>) {
  const p = await lerProjeto(ch, corpo.projeto_id);
  const e = normalizarExecucao(obj(p.dados.completar).execucao);
  if (!e) throw new ErroHttp(409, "sem_execucao", "Nenhuma rodada do Completar tudo neste projeto.");
  const feitos = e.passos.filter((x) => x.estado === "feito");
  const perguntas = Array.isArray(obj(p.dados.completar).perguntas) ? (obj(p.dados.completar).perguntas as unknown[]).length : 0;
  await registrarEvento({
    clientId: p.client_id,
    marcaId: p.marca_id,
    projetoId: p.id,
    tipo: "marca_completada",
    resumo: `Marca completada pela Mesa Identidade (${feitos.length} de ${e.passos.length} passos${e.parada_em ? ", parada no meio" : ""}).`,
    provas: { execucao_id: e.id, passos: e.passos.map((x) => ({ id: x.id, estado: x.estado, resumo: x.resumo })), custo_usd: e.custo_usd, perguntas_em_aberto: perguntas },
    userId: ch.userId,
  });
  return json({ projeto: p, custo_usd: 0 });
}

// ------------------------------------------------------------------ agente (completar_marca)

/**
 * O diretor de marca pede "complete a marca": a função roda o que faz
 * sozinha (leitura por visão e estratégia, só o que falta) e deixa o resto
 * pendente para a mesa (canvas no navegador), sem custo. Devolve o que o
 * Desfazer precisa (as partes de antes).
 */
export async function completarNoServidor(ch: Chamador, p0: LinhaDoProjeto, opcoes: OpcoesDoCompletar = {}) {
  const temLogo = !!obj(obj(obj(p0.dados.sistema).logos).principal).caminho;
  const plano = planoDeCompletar(p0.dados, { temLogo, modo: p0.modo, comNaming: p0.com_naming }, { ...opcoes, video: opcoes.video || { apresentacao: true, filme: false } });
  const execucao = novaExecucao(crypto.randomUUID(), plano, opcoes, "agente");
  const antes = { leitura_da_logo: p0.dados.leitura_da_logo ?? null, estrategia: p0.dados.estrategia ?? null, completar: p0.dados.completar ?? null };
  let p = p0;
  let custo = 0;
  const avisos: string[] = [];
  for (const passo of execucao.passos) {
    if (PASSOS_DO_SERVIDOR.indexOf(passo.id) < 0) continue;
    try {
      if (passo.id === "leitura") {
        const r = await lerLogoComVisao(ch, p);
        p = r.projeto;
        custo += r.custo_usd;
        passo.custo_usd = r.custo_usd;
        passo.resumo = [r.leitura.estilo, r.leitura.fonte.parecidas.length ? `fonte parecida: ${r.leitura.fonte.parecidas.map((x) => x.familia).join(", ")}` : ""].filter(Boolean).join("; ").slice(0, 300) || "Logo lida";
        passo.antes = { leitura_da_logo: antes.leitura_da_logo };
      } else if (passo.id === "estrategia") {
        const r = await montarEstrategia(ch, p);
        p = r.projeto;
        custo += r.custo_usd;
        passo.custo_usd = r.custo_usd;
        passo.resumo = `${r.mudaram.length} campos preenchidos${r.avisos.length ? `; ${r.avisos[0]}` : ""}`.slice(0, 300);
        passo.antes = { estrategia: r.antes };
        if (r.avisos.length) avisos.push(...r.avisos.slice(0, 2));
      }
      passo.estado = "feito";
      passo.em = new Date().toISOString();
    } catch (e) {
      registrarFalha(`mesa-identidade: completar_marca, passo ${passo.id}`, e);
      passo.estado = "falhou";
      passo.resumo = e instanceof Error ? e.message.slice(0, 300) : "Falhou";
      passo.em = new Date().toISOString();
    }
  }
  execucao.custo_usd = Math.round(custo * 1e6) / 1e6;
  const pendentes = execucao.passos.filter((x) => x.estado === "pendente").map((x) => rotuloDoPasso(x.id));
  const projeto = await gravarProjeto(p, { dados: dadosComParte(p.dados, "completar", { execucao }) });
  return { projeto, antes, execucao, pendentes, custo_usd: execucao.custo_usd, avisos };
}

/** Custo antes do cartão do agente: os passos da função (leitura por visão e estratégia) que ainda faltam. */
export async function estimativaDoCompletarNoServidor(p: LinhaDoProjeto | null): Promise<number> {
  if (!p) return 0;
  const temLogo = !!obj(obj(obj(p.dados.sistema).logos).principal).caminho;
  const plano = planoDeCompletar(p.dados, { temLogo, modo: p.modo, comNaming: p.com_naming }, {});
  let total = 0;
  for (const passo of plano) {
    if (!passo.roda || PASSOS_DO_SERVIDOR.indexOf(passo.id) < 0) continue;
    if (passo.id === "leitura") total += (await estimativaDaLeitura().catch(() => ({ estimativa_usd: 0 }))).estimativa_usd;
    if (passo.id === "estrategia") {
      const m = await modeloDoPapel("identidade").catch(() => null);
      if (m) total += estimarComModelo(m, { tokensEntrada: TAMANHOS_DA_IDENTIDADE.estrategia.entrada, tokensSaida: TAMANHOS_DA_IDENTIDADE.estrategia.saida });
    }
  }
  return Math.round(total * 1e6) / 1e6;
}
