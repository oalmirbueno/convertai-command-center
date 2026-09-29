/**
 * Templates de design e referências de carrossel no agente de estilo (frente
 * T, 26/09/2026). Rotas, execução das ações confirmadas e a parte dos
 * templates na conversa. As funções do agente (banco, acesso, leitura de
 * imagem, modelos) chegam de index.ts por DepsDosTemplates: este arquivo não
 * repete nada do S2 e o index.ts só pluga (importa, espalha as rotas e
 * desvia as operações de template).
 *
 * Nada muda sem confirmação quando é proposta do agente (cartão com
 * Confirmar e Desfazer). As rotas diretas são pedidos explícitos da equipe
 * na tela (salvar, arquivar, reordenar, escolher no trabalho, testar).
 * Apagar é arquivar. Sem travessão.
 */

import {
  chamarImagem,
  chamarTexto,
  deBase64,
  type ImagemEntrada,
  type ModeloIa,
  TAMANHO_4X5,
} from "../_shared/ia-motor.ts";
import { jevPerguntar, type PerguntaJev } from "../_shared/jev.ts";
// Frente FS (29/09): falha que não para a ação fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";
// Frente AG2 (29/09): a troca da combinação gravada sem sumir; o que a equipe mandou evitar entra no teste; o motivo do descarte ensina.
import { AVISO_SEM_REGISTRO, gravarTroca } from "../_shared/conversa-das-mesas.ts";
import { aprenderDoPedido, regrasDaMesa } from "../_shared/aprendizado-das-mesas.ts";
import { lerContextoDaMarca, type MarcaDoCliente } from "../_shared/marca.ts";
import { type AcaoDoAgente, type AlvoComApelido, ErroDaAcao, type ItemDaAcaoDoAgente, type ResultadoDoItem } from "../_shared/acoes-do-agente.ts";
import { guiaAtual, guiaEmTexto, lerEstilo, type BancoDoEstilo } from "../_shared/estilo-do-cliente.ts";
import { ESQUEMA_PRANCHA, normalizarPrancha, retanguloDoQuadro, SISTEMA_PRANCHA } from "../_shared/prancha-de-referencias.ts";
import { continuidadeEmTexto, ESQUEMA_DA_LEITURA_DE_CARROSSEL, normalizarContinuidade, SISTEMA_DA_LEITURA_DE_CARROSSEL } from "../_shared/continuidade-do-carrossel.ts";
import { ESQUEMA_DAS_PARTES, normalizarLaminasDeReferencia, partesLidas, reordenarLaminas, SISTEMA_DAS_PARTES } from "../_shared/referencia-de-carrossel.ts";
import { neutralizarMarcaDaReferencia } from "../_shared/trava-da-marca.ts";
import { FIDELIDADES } from "../_shared/fidelidade-da-referencia.ts";
import {
  ancorasDasFontes,
  arquivado,
  type BancoDoTemplate,
  BUCKET_DOS_TEMPLATES,
  comAncoras,
  comGosto,
  comNovaVersaoDoTemplate,
  comTesteDoTemplateMudado,
  comTestesDoTemplate,
  type ContextoDaCombinacao,
  corpoAtual,
  corpoTemConteudo,
  DIMENSOES_DA_COMBINACAO,
  ESQUEMA_DA_COMBINACAO,
  escolherMelhoresPontos,
  escolhasDoDono,
  type EscopoDoTemplate,
  type FonteDaCombinacao,
  formatoValido,
  lerGosto,
  lerTemplate,
  lerTemplates,
  MAX_FONTES_DA_COMBINACAO,
  mudarTemplate,
  normalizarAncora,
  normalizarCorpo,
  normalizarProposta,
  pedidoDaRedacao,
  promptDoTesteDoTemplate,
  type PropostaDeTemplate,
  ROTULOS_DAS_DIMENSOES,
  semGosto,
  SISTEMA_DA_REDACAO,
  type TemplateDeDesign,
  templateNovo,
  type TesteDoTemplate,
  voltandoTemplatePara,
} from "../_shared/templates-de-design.ts";
import {
  acaoDaCombinacao,
  alvosDosTemplates,
  blocoDosAlvosDosTemplates,
  gostosDoPara,
  INSTRUCOES_DOS_TEMPLATES,
  lerPedidoDeTesteDoTemplate,
  normalizarAcoesDosTemplates,
  separarAcoes,
} from "./acoes-dos-templates.ts";

// ------------------------------------------------------------------ o que o index.ts empresta

// deno-lint-ignore no-explicit-any
type Chamador = { userId: string; token: string; doChamador: any };
type MarcaDoPedido = MarcaDoCliente | null;
type Pedido = { clientId: string; marcaId: string | null; marca: MarcaDoPedido };
// deno-lint-ignore no-explicit-any
type Servico = any;

export type DepsDosTemplates = {
  servico: () => Servico;
  pedidoDoCliente: (ch: Chamador, corpo: Record<string, unknown>) => Promise<Pedido>;
  garantirAcesso: (ch: Chamador, clientId: string) => Promise<void>;
  baixarImagem: (bucket: string, caminho: string, nome: string) => Promise<ImagemEntrada>;
  linksAssinados: (itens: Array<{ bucket: string; caminho: string }>) => Promise<string[]>;
  modeloPorPapel: (papel: "diretor_arte" | "leitura" | "imagem") => Promise<ModeloIa>;
  geradorDoEstudio: (pedido: unknown) => Promise<ModeloIa>;
  custoPorImagem: (m: ModeloIa, referencias: number) => number;
  nomeDoCliente: (clientId: string) => Promise<string>;
  paletaDoCliente: (p: Pedido) => Promise<string[]>;
  conversaDoAgente: (ch: Chamador, p: Pedido, conversaId: unknown, abrirNova: boolean) => Promise<string>;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Content-Type": "application/json",
    },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const idDe = (v: unknown, nome: string): string => {
  const s = String(v ?? "").trim();
  if (!UUID.test(s)) throw new ErroDaAcao(400, `${nome}_invalido`, `${nome} precisa ser um UUID.`);
  return s;
};
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u2014\u2013]/g, ",").trim().slice(0, max) : "");
const banco = (d: DepsDosTemplates) => d.servico() as unknown as BancoDoTemplate;
const arred = (n: number) => Math.round(n * 1e6) / 1e6;

const AVISO_ARQUIVO = "O banco ainda não tem a tabela dos templates (SQL T-01 pendente). Eles estão guardados num arquivo e funcionam igual.";
const MAX_LAMINAS_ENVIADAS = 12;
const MAX_BYTES = 4 * 1024 * 1024;

function mimeDe(b: Uint8Array): string | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}
const extensao = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");
const pastaDoDono = (escopo: EscopoDoTemplate, clientId: string) => (escopo === "agencia" ? "_agencia" : clientId);

async function mudar(d: DepsDosTemplates, ch: Chamador, clientId: string, id: string, f: (t: TemplateDeDesign | null) => TemplateDeDesign): Promise<TemplateDeDesign> {
  try {
    return await mudarTemplate(banco(d), clientId, id, f, ch.userId);
  } catch (e) {
    if (e instanceof ErroDaAcao) throw e;
    throw new ErroDaAcao(409, "template_nao_gravado", e instanceof Error ? e.message : "Não foi possível gravar o template.");
  }
}

async function existente(d: DepsDosTemplates, clientId: string, id: string): Promise<TemplateDeDesign> {
  const t = await lerTemplate(banco(d), clientId, id).catch((e) => (registrarFalha("agente-estilo: lerTemplate falhou", e), null));
  if (!t) throw new ErroDaAcao(404, "template_inexistente", "Template não encontrado.");
  return t;
}

const exigir = (t: TemplateDeDesign | null): TemplateDeDesign => {
  if (!t) throw new ErroDaAcao(404, "template_inexistente", "Template não encontrado.");
  return t;
};

// ------------------------------------------------------------------ estado para a tela

async function paraATela(d: DepsDosTemplates, templates: TemplateDeDesign[]) {
  // Miniaturas próprias: a cópia leve (<caminho>.mini.jpg) quando existe, senão o original. Nunca transform do Storage.
  const pedidos: Array<{ bucket: string; caminho: string }> = [];
  const marcar = (bucket: string, caminho: string) => {
    const i = pedidos.length;
    pedidos.push({ bucket, caminho: `${caminho}.mini.jpg` }, { bucket, caminho });
    return i;
  };
  const indices = templates.map((t) => {
    const c = corpoAtual(t);
    return {
      ancoras: (c ? c.ancoras : []).map((a) => marcar(a.bucket, a.caminho)),
      laminas: (c ? c.laminas_referencia : []).map((l) => marcar(l.bucket, l.caminho)),
      testes: t.testes.map((x) => marcar(BUCKET_DOS_TEMPLATES, x.caminho)),
    };
  });
  const links = pedidos.length ? await d.linksAssinados(pedidos).catch((e) => (registrarFalha("agente-estilo: linksAssinados falhou", e), pedidos.map(() => ""))) : [];
  const url = (i: number) => ({ mini: links[i] || links[i + 1] || "", url: links[i + 1] || links[i] || "" });
  return templates.map((t, k) => {
    const c = corpoAtual(t);
    return {
      id: t.id,
      tipo: t.tipo,
      escopo: t.escopo,
      nome: t.nome,
      formato: t.formato,
      status: t.status,
      origem: t.origem,
      versao_atual: t.versao_atual,
      atualizado_em: t.atualizado_em,
      corpo: c,
      versoes: t.versoes.slice().reverse().map((v) => ({ numero: v.numero, origem: v.origem, nota: v.nota, criado_em: v.criado_em, de_onde: v.de_onde })),
      gostos: t.gostos.slice().reverse(),
      testes: t.testes.slice().reverse().map((x, j) => ({ ...x, ...url(indices[k].testes[t.testes.length - 1 - j]) })),
      ancoras: (c ? c.ancoras : []).map((a, j) => ({ id: a.id, nome: a.nome, papel: a.papel, origem: a.origem, ...url(indices[k].ancoras[j]) })),
      laminas: (c ? c.laminas_referencia : []).map((l, j) => ({ id: l.id, nome: l.nome, papel: l.papel, partes: l.partes, ...url(indices[k].laminas[j]) })),
    };
  });
}

async function estado(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  let r: Awaited<ReturnType<typeof lerTemplates>>;
  try {
    r = await lerTemplates(banco(d), p.clientId, p.marcaId, { incluirArquivados: corpo.arquivados === true });
  } catch (e) {
    throw new ErroDaAcao(503, "templates_indisponiveis", e instanceof Error ? e.message : "Não foi possível ler os templates agora.");
  }
  return json({ client_id: p.clientId, marca_id: p.marcaId, guardado_em: r.guardado_em, aviso: r.guardado_em === "arquivo" ? AVISO_ARQUIVO : null, templates: await paraATela(d, r.templates), custo_usd: 0 });
}

const respostaComEstado = async (d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
  const r = await estado(d, ch, corpo);
  const base = await r.json();
  return json({ ...base, ...extra });
};

// ------------------------------------------------------------------ edição direta da equipe

async function salvar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const agora = new Date().toISOString();
  const nome = limpo(corpo.nome, 80);
  const nota = limpo(corpo.nota, 200) || "Editado pela equipe.";
  if (corpo.id) {
    const id = idDe(corpo.id, "id");
    await mudar(d, ch, p.clientId, id, (t) => {
      const x = exigir(t);
      const atual = corpoAtual(x);
      let y = { ...x, nome: nome || x.nome };
      if (corpo.corpo && typeof corpo.corpo === "object") {
        const novo = normalizarCorpo({ ...(corpo.corpo as Record<string, unknown>), formato: x.formato }, x.formato);
        // Âncoras e lâminas continuam as de hoje (mudam pelas ações próprias).
        y = comNovaVersaoDoTemplate(y, { ...novo, ancoras: atual ? atual.ancoras : [], laminas_referencia: atual ? atual.laminas_referencia : [] }, "equipe", nota, ch.userId, agora);
      }
      return y;
    });
    return await respostaComEstado(d, ch, corpo);
  }
  const formato = formatoValido(corpo.formato);
  const c = normalizarCorpo({ ...((corpo.corpo as Record<string, unknown>) || {}), formato }, formato);
  if (!nome) throw new ErroDaAcao(400, "nome_vazio", "Dê um nome ao template.");
  const escopo: EscopoDoTemplate = corpo.escopo === "agencia" ? "agencia" : "cliente";
  const id = crypto.randomUUID();
  await mudar(d, ch, p.clientId, id, () => templateNovo({ id, escopo, clientId: p.clientId, marcaId: p.marcaId, nome, origem: "equipe", corpo: c, nota, por: ch.userId, agora }));
  return await respostaComEstado(d, ch, corpo, { criado_id: id });
}

async function arquivar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  await mudar(d, ch, p.clientId, id, (t) => arquivado(exigir(t), corpo.arquivar !== false));
  return await respostaComEstado(d, ch, corpo);
}

async function versaoVoltar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const numero = Number(corpo.numero);
  await mudar(d, ch, p.clientId, id, (t) => {
    const x = exigir(t);
    if (!x.versoes.some((v) => v.numero === numero)) throw new ErroDaAcao(404, "versao_inexistente", "Versão não encontrada.");
    return voltandoTemplatePara(x, numero, ch.userId, new Date().toISOString());
  });
  return await respostaComEstado(d, ch, corpo);
}

async function gosto(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const g = lerGosto(corpo.texto);
  if (!g) throw new ErroDaAcao(400, "gosto_vazio", "Escreva o que foi de gosto.");
  if (corpo.quem === "dono" || corpo.quem === "cliente") g.quem = corpo.quem;
  if (corpo.tipo === "gostou" || corpo.tipo === "nao_gostou") g.tipo = corpo.tipo;
  await mudar(d, ch, p.clientId, id, (t) => comGosto(exigir(t), g, ch.userId, new Date().toISOString(), crypto.randomUUID().slice(0, 12)));
  return await respostaComEstado(d, ch, corpo);
}

async function gostoApagar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const gostoId = limpo(corpo.gosto_id, 40);
  await mudar(d, ch, p.clientId, id, (t) => semGosto(exigir(t), gostoId));
  return await respostaComEstado(d, ch, corpo);
}

async function ancoraTirar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const ancora = idDe(corpo.ancora_id, "ancora_id");
  await mudar(d, ch, p.clientId, id, (t) => comAncoras(exigir(t), [], [ancora], ch.userId, new Date().toISOString(), "Âncora tirada pela equipe."));
  return await respostaComEstado(d, ch, corpo);
}

/** Reordenar as lâminas da referência de carrossel: versão nova (dá para voltar). */
async function reordenar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  await mudar(d, ch, p.clientId, id, (t) => {
    const x = exigir(t);
    const c = corpoAtual(x);
    if (x.tipo !== "referencia_carrossel" || !c) throw new ErroDaAcao(409, "nao_e_referencia", "Só referência de carrossel tem lâminas para ordenar.");
    const nova = reordenarLaminas(c.laminas_referencia, corpo.ordem);
    if (!nova) throw new ErroDaAcao(400, "ordem_invalida", "A ordem precisa ter todas as lâminas, sem repetir.");
    return comNovaVersaoDoTemplate(x, { ...c, laminas_referencia: nova }, "equipe", "Lâminas reordenadas.", ch.userId, new Date().toISOString());
  });
  return await respostaComEstado(d, ch, corpo);
}

// ------------------------------------------------------------------ escolher no trabalho (Estúdio)

function idsDeTrabalho(v: unknown): string[] {
  const l = (Array.isArray(v) ? v : []).map((x) => String(x || "").trim()).filter((x) => UUID.test(x));
  if (!l.length) throw new ErroDaAcao(400, "trabalho_ids_invalido", "Diga quais trabalhos.");
  if (l.length > 60) throw new ErroDaAcao(400, "trabalhos_demais", "Até 60 trabalhos por vez.");
  return Array.from(new Set(l));
}

async function noTrabalhoLer(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await d.garantirAcesso(ch, clientId);
  const ids = idsDeTrabalho(corpo.trabalho_ids);
  const { data } = await d.servico().from("estudio_trabalhos").select("id, direcao").eq("client_id", clientId).in("id", ids);
  const escolhas: Record<string, { id: string; fidelidade: string | null } | null> = {};
  for (const t of (data as Array<{ id: string; direcao: Record<string, unknown> | null }> | null) ?? []) {
    const e = t.direcao && t.direcao.template_de_design && typeof t.direcao.template_de_design === "object" ? (t.direcao.template_de_design as Record<string, unknown>) : null;
    escolhas[t.id] = e && UUID.test(String(e.id || "")) ? { id: String(e.id), fidelidade: typeof e.fidelidade === "string" ? e.fidelidade : null } : null;
  }
  return json({ escolhas, custo_usd: 0 });
}

/** Grava direcao.template_de_design nos trabalhos (ou tira, com template_id null: "Nenhum"). Trava otimista como o interruptor do estilo. */
async function noTrabalho(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const clientId = idDe(corpo.client_id, "client_id");
  await d.garantirAcesso(ch, clientId);
  const ids = idsDeTrabalho(corpo.trabalho_ids);
  const templateId = corpo.template_id == null || corpo.template_id === "" ? null : idDe(corpo.template_id, "template_id");
  const fidelidade = FIDELIDADES.indexOf(corpo.fidelidade as never) >= 0 ? String(corpo.fidelidade) : null;
  if (templateId) {
    const t = await existente(d, clientId, templateId);
    if (t.status !== "ativo") throw new ErroDaAcao(409, "template_arquivado", "Este template está arquivado.");
  }
  const falhas: string[] = [];
  for (const id of ids) {
    let feito = false;
    for (let tentativa = 0; tentativa < 5 && !feito; tentativa++) {
      const { data } = await d.servico().from("estudio_trabalhos").select("id, client_id, direcao, atualizado_em").eq("id", id).maybeSingle();
      const t = data as { id: string; client_id: string; direcao: Record<string, unknown> | null; atualizado_em: string } | null;
      if (!t || t.client_id !== clientId) break;
      const direcao = { ...(t.direcao || {}) };
      if (templateId) direcao.template_de_design = { id: templateId, ...(fidelidade ? { fidelidade } : {}) };
      else delete direcao.template_de_design;
      const { data: gravado, error } = await d.servico().from("estudio_trabalhos").update({ direcao }).eq("id", id).eq("atualizado_em", t.atualizado_em).select("id").maybeSingle();
      if (error) break;
      feito = !!gravado;
    }
    if (!feito) falhas.push(id);
  }
  return json({ template_id: templateId, fidelidade, feitos: ids.length - falhas.length, falhas, custo_usd: 0 });
}

// ------------------------------------------------------------------ testes (mesmo caminho do teste do estilo)

async function gerarTestes(d: DepsDosTemplates, ch: Chamador, p: Pedido, id: string, quantos: number, tema: string, modeloPedido: unknown) {
  if (!Number.isInteger(quantos) || quantos < 1 || quantos > 4) throw new ErroDaAcao(400, "quantos_invalido", "Peça de 1 a 4 imagens de teste.");
  const t = await existente(d, p.clientId, id);
  const c = corpoAtual(t);
  if (!c || !corpoTemConteudo(c)) throw new ErroDaAcao(409, "template_vazio", "Este template ainda não diz nada para testar.");
  const [gerador, cliente, paleta, ensinadas] = await Promise.all([
    d.geradorDoEstudio(modeloPedido),
    d.nomeDoCliente(p.clientId),
    d.paletaDoCliente(p),
    regrasDaMesa(d.servico(), { clientId: p.clientId, mesa: "estilo", marcaId: p.marcaId }),
  ]);
  const evitarLista = ensinadas.regras.filter((r) => r.tipo === "evitar").slice(0, 8).map((r) => r.texto.slice(0, 160));
  const evitar = evitarLista.length ? `\nEVITAR (a equipe pediu): ${evitarLista.join("; ")}.` : "";
  const fontes = t.tipo === "referencia_carrossel" ? c.laminas_referencia.slice(0, 1).map((l) => ({ bucket: l.bucket, caminho: l.caminho, id: l.id })) : c.ancoras.slice(0, 3).map((a) => ({ bucket: a.bucket, caminho: a.caminho, id: a.id }));
  const refs: ImagemEntrada[] = [];
  for (const f of fontes) {
    try {
      refs.push(await d.baixarImagem(f.bucket, f.caminho, `template-${f.id.slice(0, 8)}`));
    } catch {
      // Âncora sumida fica de fora.
    }
  }
  const indices = refs.map((_, i) => i + 1);
  const avisos: string[] = [];
  const feitos = await Promise.all(Array.from({ length: quantos }, async (_, k) => {
    try {
      const img = await chamarImagem({
        clientId: p.clientId,
        modeloId: gerador.id,
        prompt: `${promptDoTesteDoTemplate({ nome: t.nome, corpo: c }, { cliente, tema, paleta, indices, variacao: k + 1, total: quantos })}${evitar}`,
        referencias: refs,
        qualidade: "media",
        tamanho: TAMANHO_4X5,
        referencia: { tipo: "template_de_design", id: t.id },
        criadoPor: ch.userId,
        tarefa: "estudio",
        agente: "gerador_imagem",
      });
      const tid = crypto.randomUUID();
      const caminho = `${p.clientId}/estilo/templates/${t.id}/testes/${tid}.${extensao(img.mime || "image/png")}`;
      const { error } = await d.servico().storage.from(BUCKET_DOS_TEMPLATES).upload(caminho, new Blob([new Uint8Array(img.png)], { type: img.mime || "image/png" }), { contentType: img.mime || "image/png", upsert: false });
      if (error) throw new Error("A imagem foi gerada, mas não foi guardada.");
      if (img.avisos) avisos.push(...img.avisos);
      const teste: TesteDoTemplate = { id: tid, caminho, tema, versao: t.versao_atual, custo_usd: img.custoUsd, criado_em: new Date().toISOString(), status: "novo" };
      return { teste, custo: img.custoUsd, erro: null as unknown };
    } catch (erro) {
      registrarFalha("agente-estilo: teste do template falhou", erro, { template_id: t.id });
      return { teste: null, custo: 0, erro };
    }
  }));
  const testes = feitos.map((f) => f.teste).filter((x): x is TesteDoTemplate => !!x);
  if (!testes.length) throw feitos[0].erro || new ErroDaAcao(502, "teste_falhou", "Nenhuma imagem de teste saiu. Tente de novo.");
  if (testes.length < quantos) avisos.push(`${quantos - testes.length} de ${quantos} não saíram.`);
  await mudar(d, ch, p.clientId, t.id, (x) => comTestesDoTemplate(exigir(x), testes));
  return { testes, custo: feitos.reduce((s, f) => s + f.custo, 0), avisos };
}

async function testeGerar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const r = await gerarTestes(d, ch, p, idDe(corpo.id, "id"), Number(corpo.quantos ?? 1), limpo(corpo.tema, 200), corpo.modelo_imagem_id);
  return await respostaComEstado(d, ch, corpo, { gerados: r.testes.length, avisos: r.avisos, custo_usd: arred(r.custo) });
}

/** Teste aprovado vira âncora do template (versão nova) e gosto do dono. */
async function testeAprovar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const testeId = limpo(corpo.teste_id, 60);
  const agora = new Date().toISOString();
  await mudar(d, ch, p.clientId, id, (t) => {
    const x = exigir(t);
    const teste = x.testes.find((y) => y.id === testeId);
    if (!teste) throw new ErroDaAcao(404, "teste_inexistente", "Imagem de teste não encontrada.");
    if (teste.status === "aprovado") return x;
    const ancora = normalizarAncora({ id: crypto.randomUUID(), origem: "teste", bucket: BUCKET_DOS_TEMPLATES, caminho: teste.caminho, nome: teste.tema || "teste aprovado", papel: x.formato === "carrossel" ? "capa" : "geral" });
    let y = comTesteDoTemplateMudado(x, testeId, (z) => ({ ...z, status: "aprovado" }));
    if (ancora) y = comAncoras(y, [ancora], [], ch.userId, agora, "Teste aprovado virou âncora.");
    return comGosto(y, { quem: "dono", tipo: "gostou", texto: `aprovou o teste${teste.tema ? ` "${teste.tema}"` : ""} da versão ${teste.versao}` }, ch.userId, agora, crypto.randomUUID().slice(0, 12));
  });
  return await respostaComEstado(d, ch, corpo);
}

async function testeDescartar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const id = idDe(corpo.id, "id");
  const testeId = limpo(corpo.teste_id, 60);
  await mudar(d, ch, p.clientId, id, (t) => {
    const x = exigir(t);
    const teste = x.testes.find((y) => y.id === testeId);
    if (!teste) throw new ErroDaAcao(404, "teste_inexistente", "Imagem de teste não encontrada.");
    if (teste.status === "aprovado") throw new ErroDaAcao(409, "teste_aprovado", "Este teste já virou âncora.");
    return comTesteDoTemplateMudado(x, testeId, (z) => ({ ...z, status: "descartado" }));
  });
  // Frente AG2: descarte com motivo ensina (vira regra do cliente quando é preferência duradoura).
  const motivo = limpo(corpo.motivo, 300);
  const aprendido = motivo
    ? await aprenderDoPedido(d.servico(), { clientId: p.clientId, mesa: "estilo", pedido: `Descartei o teste do template: ${motivo}`, motivo, marcaId: p.marcaId, userId: ch.userId, forcar: true })
    : null;
  return await respostaComEstado(d, ch, corpo, aprendido ? { aprendido } : {});
}

// ------------------------------------------------------------------ referência de carrossel

type AnexoRecebido = { bytes: Uint8Array; mime: string; nome: string };

function lerLaminasEnviadas(v: unknown): AnexoRecebido[] {
  const lista = Array.isArray(v) ? v : [];
  if (!lista.length) throw new ErroDaAcao(400, "sem_laminas", "Mande as lâminas do carrossel, na ordem.");
  if (lista.length > MAX_LAMINAS_ENVIADAS) throw new ErroDaAcao(400, "laminas_demais", `Mande até ${MAX_LAMINAS_ENVIADAS} lâminas.`);
  return lista.map((a, i) => {
    const o = (a ?? {}) as Record<string, unknown>;
    let bytes: Uint8Array;
    try {
      bytes = deBase64(String(o.base64 || "").replace(/^data:[^,]*,/, ""));
    } catch {
      throw new ErroDaAcao(400, "anexo_invalido", `A lâmina ${i + 1} não pôde ser lida.`);
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) throw new ErroDaAcao(413, "anexo_grande_demais", `A lâmina ${i + 1} passou de 4 MB.`);
    const mime = mimeDe(bytes);
    if (!mime) throw new ErroDaAcao(415, "anexo_invalido", `A lâmina ${i + 1} não é PNG, JPG nem WEBP.`);
    return { bytes, mime, nome: limpo(o.nome, 80).replace(/[^\w.\- ]+/g, "") || `lamina-${i + 1}` };
  });
}

/** Print com as lâminas lado a lado: lê os quadros (mesmo leitor da prancha do Estúdio) e recorta em código. */
async function laminasDoPrint(d: DepsDosTemplates, ch: Chamador, p: Pedido, print: AnexoRecebido): Promise<{ laminas: AnexoRecebido[]; custo: number }> {
  const leitor = await d.modeloPorPapel("leitura");
  const r = await chamarTexto({
    clientId: p.clientId,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: SISTEMA_PRANCHA,
    mensagens: [{ papel: "usuario", conteudo: "Leia esta imagem.", imagens: [{ bytes: print.bytes, mime: print.mime, nome: `print.${extensao(print.mime)}` }] }],
    esquemaJson: ESQUEMA_PRANCHA,
    maxTokensSaida: 2_000,
    criadoPor: ch.userId,
  });
  const prancha = normalizarPrancha(r.json);
  if (!prancha.prancha) return { laminas: [print], custo: r.custoUsd };
  const { decodificar } = await import("../_shared/imagem-local.ts");
  const img = await decodificar(print.bytes);
  const laminas: AnexoRecebido[] = [];
  for (const [i, q] of prancha.quadros.entries()) {
    const ret = retanguloDoQuadro(q, img.width, img.height);
    if (!ret) continue;
    laminas.push({ bytes: await img.clone().crop(ret.x, ret.y, ret.largura, ret.altura).encode(1), mime: "image/png", nome: `lamina-${i + 1}` });
    if (laminas.length >= MAX_LAMINAS_ENVIADAS) break;
  }
  return { laminas: laminas.length >= 2 ? laminas : [print], custo: r.custoUsd };
}

const ESQUEMA_DA_SEQUENCIA = {
  nome: "sequencia_do_carrossel",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["sequencia", "partes"],
    properties: { sequencia: ESQUEMA_DA_LEITURA_DE_CARROSSEL.schema, partes: ESQUEMA_DAS_PARTES.schema },
  },
};

/** Lê a sequência (continuidade) e as partes de cada lâmina numa chamada só do leitor. */
async function lerSequencia(d: DepsDosTemplates, ch: Chamador, p: Pedido, imagens: ImagemEntrada[]) {
  const leitor = await d.modeloPorPapel("leitura");
  const r = await chamarTexto({
    clientId: p.clientId,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: `${SISTEMA_DA_LEITURA_DE_CARROSSEL}\n\nPARTES: ${SISTEMA_DAS_PARTES}\n\nDevolva sequencia (a leitura da continuidade) e partes (as partes de cada lâmina).`,
    mensagens: [{ papel: "usuario", conteudo: `Leia este carrossel de ${imagens.length} lâmina${imagens.length === 1 ? "" : "s"}, na ordem.`, imagens }],
    esquemaJson: ESQUEMA_DA_SEQUENCIA,
    maxTokensSaida: 4_000,
    criadoPor: ch.userId,
  });
  const j = (r.json || {}) as Record<string, unknown>;
  return { continuidade: normalizarContinuidade(j.sequencia), partes: partesLidas(j.partes, imagens.length), custo: r.custoUsd };
}

/**
 * Cria a referência de carrossel com as lâminas já guardadas (na ordem): lê a
 * sequência e as partes, e grava como template do tipo referencia_carrossel.
 */
async function criarReferencia(d: DepsDosTemplates, ch: Chamador, p: Pedido, e: { id: string; nome: string; escopo: EscopoDoTemplate; laminas: Array<{ bucket: string; caminho: string; nome: string }>; imagens?: ImagemEntrada[] }) {
  const imagens = e.imagens || (await Promise.all(e.laminas.map((l, i) => d.baixarImagem(l.bucket, l.caminho, `lamina-${i + 1}`))));
  const lida = await lerSequencia(d, ch, p, imagens);
  const laminas = normalizarLaminasDeReferencia(e.laminas.map((l, i) => ({ id: crypto.randomUUID(), bucket: l.bucket, caminho: l.caminho, nome: l.nome, partes: lida.partes[i] || {} })));
  const corpo = normalizarCorpo({ formato: "carrossel", resumo: lida.continuidade ? neutralizarMarcaDaReferencia(lida.continuidade.descricao) : "", continuidade: lida.continuidade, laminas_referencia: laminas }, "carrossel");
  const agora = new Date().toISOString();
  const t = await mudar(d, ch, p.clientId, e.id, () =>
    templateNovo({ id: e.id, tipo: "referencia_carrossel", escopo: e.escopo, clientId: p.clientId, marcaId: p.marcaId, nome: e.nome || "Carrossel de referência", origem: "referencias", corpo, nota: `${laminas.length} lâminas na ordem.`, por: ch.userId, agora }),
  );
  return { template: t, custo: lida.custo };
}

async function referenciaCriar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const escopo: EscopoDoTemplate = corpo.escopo === "agencia" ? "agencia" : "cliente";
  let enviadas = lerLaminasEnviadas(corpo.laminas);
  let custo = 0;
  if (enviadas.length === 1) {
    const r = await laminasDoPrint(d, ch, p, enviadas[0]);
    enviadas = r.laminas;
    custo += r.custo;
  }
  const id = crypto.randomUUID();
  const pasta = `${pastaDoDono(escopo, p.clientId)}/estilo/carrosseis/${id}`;
  const guardadas: Array<{ bucket: string; caminho: string; nome: string }> = [];
  for (const [i, a] of enviadas.entries()) {
    const caminho = `${pasta}/${String(i + 1).padStart(2, "0")}-${crypto.randomUUID().slice(0, 8)}.${extensao(a.mime)}`;
    const { error } = await d.servico().storage.from(BUCKET_DOS_TEMPLATES).upload(caminho, new Blob([new Uint8Array(a.bytes)], { type: a.mime }), { contentType: a.mime, upsert: false });
    if (error) throw new ErroDaAcao(503, "lamina_nao_guardada", "Não foi possível guardar as lâminas. Tente de novo.");
    guardadas.push({ bucket: BUCKET_DOS_TEMPLATES, caminho, nome: a.nome });
  }
  const r = await criarReferencia(d, ch, p, { id, nome: limpo(corpo.nome, 80), escopo, laminas: guardadas, imagens: enviadas.map((a) => ({ bytes: a.bytes, mime: a.mime, nome: `${a.nome}.${extensao(a.mime)}` })) });
  custo += r.custo;
  return await respostaComEstado(d, ch, corpo, { criado_id: id, laminas: guardadas.length, custo_usd: arred(custo) });
}

// ------------------------------------------------------------------ combinação

async function contextoDaCombinacao(d: DepsDosTemplates, p: Pedido, objetivo: string): Promise<ContextoDaCombinacao> {
  const [cliente, contexto, estilo] = await Promise.all([
    d.nomeDoCliente(p.clientId),
    lerContextoDaMarca(d.servico(), p.clientId, p.marca).catch((e) => (registrarFalha("agente-estilo: lerContextoDaMarca falhou", e), ({}))),
    lerEstilo(d.servico() as unknown as BancoDoEstilo, p.clientId, p.marcaId).catch((e) => (registrarFalha("agente-estilo: lerEstilo falhou", e), null)),
  ]);
  const c = contexto as Record<string, unknown>;
  return {
    cliente,
    objetivo,
    negocio: c.negocio ? String(c.negocio).slice(0, 400) : null,
    publico: c.publico ? String(c.publico).slice(0, 300) : null,
    estilo_do_cliente: estilo ? guiaEmTexto(guiaAtual(estilo)).slice(0, 900) : null,
    aprendizados: estilo ? estilo.aprendizados.slice(-10).map((a) => `${a.tipo === "gostou" ? "gostou" : "não gostou"}: ${a.texto}`) : [],
  };
}

/** Fontes pedidas (templates por id e referências do cliente por id) viram fontes com apelido (t1.., r1..). */
async function fontesDaCombinacao(d: DepsDosTemplates, p: Pedido, pedidas: unknown): Promise<FonteDaCombinacao[]> {
  const lista = (Array.isArray(pedidas) ? pedidas : []).slice(0, MAX_FONTES_DA_COMBINACAO);
  const fontes: FonteDaCombinacao[] = [];
  let t = 0;
  let r = 0;
  for (const x of lista) {
    const o = (x ?? {}) as Record<string, unknown>;
    const id = idDe(o.id, "fonte");
    if (o.tipo === "referencia") {
      const { data } = await d.servico().from("cliente_referencias").select("id, client_id, leitura, tags").eq("id", id).maybeSingle();
      const ref = data as { id: string; client_id: string; leitura: string | null; tags: string[] | null } | null;
      if (!ref || ref.client_id !== p.clientId) throw new ErroDaAcao(404, "referencia_inexistente", "Referência não encontrada para este cliente.");
      if (!ref.leitura) throw new ErroDaAcao(409, "referencia_sem_leitura", "Esta referência ainda não foi lida. Mande-a na conversa do estilo antes de combinar.");
      fontes.push({ apelido: `r${++r}`, nome: (ref.tags || []).indexOf("arte-aprovada") >= 0 ? "arte aprovada" : "referência", tipo: "referencia", leitura: ref.leitura, id: ref.id });
    } else {
      const tpl = await existente(d, p.clientId, id);
      fontes.push({ apelido: `t${++t}`, nome: tpl.nome, tipo: "template", corpo: corpoAtual(tpl), gostos: tpl.gostos.map((g) => `${g.quem} ${g.tipo === "gostou" ? "gostou" : "não gostou"}: ${g.texto}`), id: tpl.id });
    }
  }
  if (fontes.length < 2) throw new ErroDaAcao(400, "fontes_poucas", "Escolha 2 ou 3 fontes para combinar.");
  return fontes;
}

const perguntarAoJev = (pedido: { state: unknown; questions: Record<string, unknown> }) =>
  jevPerguntar({ state: pedido.state, questions: pedido.questions as Record<string, PerguntaJev> });

/**
 * Combina: o Jev escolhe o melhor de cada fonte por dimensão (ou o dono, na
 * tela), o diretor de arte do catálogo redige o template (1 proposta, ou 2
 * variações de uma vez quando a coerência é baixa) e a proposta vira um
 * cartão para confirmar. Falha do Jev: nada de combinação automática, a tela
 * pede a escolha ao dono (sem custo).
 */
async function combinarInterno(d: DepsDosTemplates, ch: Chamador, p: Pedido, e: { fontes: FonteDaCombinacao[]; objetivo: string; formato: unknown; escopo: EscopoDoTemplate; escolhas?: unknown; referenciaUso: string }) {
  const ctx = await contextoDaCombinacao(d, p, e.objetivo);
  const formato = e.formato ? formatoValido(e.formato) : (e.fontes.find((f) => f.corpo)?.corpo?.formato ?? "post");
  const escolha = escolhasDoDono(e.escolhas, e.fontes) || (await escolherMelhoresPontos(e.fontes, ctx, perguntarAoJev));
  if (escolha.modo === "pedir_ao_dono") return { pedir: escolha.motivo, acao: null as AcaoDoAgente | null, escolha, custo: 0, propostas: [] as PropostaDeTemplate[] };
  const modelo = await d.modeloPorPapel("diretor_arte");
  const saida = await chamarTexto({
    clientId: p.clientId,
    tarefa: "estudio",
    agente: "diretor_arte",
    modeloId: modelo.id,
    sistema: SISTEMA_DA_REDACAO,
    mensagens: [{ papel: "usuario", conteudo: pedidoDaRedacao(e.fontes, escolha, ctx, formato) }],
    esquemaJson: ESQUEMA_DA_COMBINACAO,
    maxTokensSaida: 5_000,
    referencia: { tipo: "agente_conversa", id: e.referenciaUso },
    criadoPor: ch.userId,
  });
  const j = (saida.json || {}) as { variacoes?: unknown[] };
  const ancoras = ancorasDasFontes(e.fontes);
  const propostas = (Array.isArray(j.variacoes) ? j.variacoes : [])
    .slice(0, escolha.variacoes)
    .map((v) => normalizarProposta(v, formato, e.fontes, ancoras))
    .filter((x): x is PropostaDeTemplate => !!x);
  const acao = acaoDaCombinacao(propostas, { clientId: p.clientId, marcaId: p.marcaId, fontes: e.fontes.map((f) => f.id || "").filter((x) => UUID.test(x)), escopo: e.escopo, coerencia: escolha.coerencia });
  return { pedir: null as string | null, acao, escolha, custo: saida.custoUsd, propostas };
}

function fraseDaCombinacao(fontes: FonteDaCombinacao[], escolha: { escolhas: Record<string, { fonte: string; duvida: boolean } | undefined>; coerencia: number | null }, propostas: PropostaDeTemplate[]): string {
  const nome = (a: string) => (a === "combinar" ? "as duas" : fontes.find((f) => f.apelido === a)?.nome || a);
  const partes = DIMENSOES_DA_COMBINACAO.filter((x) => escolha.escolhas[x]).map((x) => `${ROTULOS_DAS_DIMENSOES[x]}: ${nome(escolha.escolhas[x]!.fonte)}${escolha.escolhas[x]!.duvida ? " (dúvida)" : ""}`);
  const fim = propostas.length > 1 ? "O conjunto pode brigar: trouxe duas variações para você escolher." : propostas.length ? "Proposta pronta para confirmar." : "Não saiu proposta. Tente de novo ou escolha você as dimensões.";
  return `Combinei ${fontes.map((f) => `"${f.nome}"`).join(" e ")}. ${partes.join("; ")}. ${fim}`;
}

async function combinar(d: DepsDosTemplates, ch: Chamador, corpo: Record<string, unknown>) {
  const p = await d.pedidoDoCliente(ch, corpo);
  const fontes = await fontesDaCombinacao(d, p, corpo.fontes);
  const objetivo = limpo(corpo.objetivo, 300);
  const conversaId = await d.conversaDoAgente(ch, p, corpo.conversa_id, false);
  const escopo: EscopoDoTemplate = corpo.escopo === "agencia" ? "agencia" : "cliente";
  const r = await combinarInterno(d, ch, p, { fontes, objetivo, formato: corpo.formato, escopo, escolhas: corpo.escolhas, referenciaUso: conversaId });
  if (r.pedir) {
    return json({ pedir_ao_dono: true, motivo: r.pedir, fontes: fontes.map((f) => ({ apelido: f.apelido, nome: f.nome })), dimensoes: DIMENSOES_DA_COMBINACAO.map((x) => ({ valor: x, rotulo: ROTULOS_DAS_DIMENSOES[x] })), custo_usd: 0 });
  }
  const e = r.escolha as { escolhas: Record<string, { fonte: string; duvida: boolean } | undefined>; coerencia: number | null };
  const resposta = fraseDaCombinacao(fontes, e, r.propostas);
  const anexos = r.acao ? [r.acao] : [];
  // Frente AG2: sem o insert em lote que ignorava o erro (cartão sem mensagem_id = Confirmar impossível).
  const troca = await gravarTroca(d.servico(), {
    conversaId,
    clientId: p.clientId,
    usuario: { conteudo: `Combinar ${fontes.map((f) => `"${f.nome}"`).join(" + ")}${objetivo ? ` para ${objetivo}` : ""}.`, anexos: [] },
    agente: { conteudo: resposta, anexos },
    onde: "agente-estilo (combinar templates)",
  });
  return json({ conversa_id: conversaId, mensagem_id: troca.agenteId, resposta, anexos, escolha: r.escolha, custo_usd: arred(r.custo), ...(troca.erro ? { aviso_registro: AVISO_SEM_REGISTRO } : {}) });
}

// ------------------------------------------------------------------ rotas

type Rota = (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>;

/** As rotas dos templates, para o index.ts espalhar em ACOES. */
export function rotasDosTemplates(d: DepsDosTemplates): Record<string, Rota> {
  return {
    templates_estado: (ch, c) => estado(d, ch, c),
    template_salvar: (ch, c) => salvar(d, ch, c),
    template_arquivar: (ch, c) => arquivar(d, ch, c),
    template_versao_voltar: (ch, c) => versaoVoltar(d, ch, c),
    template_gosto: (ch, c) => gosto(d, ch, c),
    template_gosto_apagar: (ch, c) => gostoApagar(d, ch, c),
    template_ancora_tirar: (ch, c) => ancoraTirar(d, ch, c),
    template_teste_gerar: (ch, c) => testeGerar(d, ch, c),
    template_teste_aprovar: (ch, c) => testeAprovar(d, ch, c),
    template_teste_descartar: (ch, c) => testeDescartar(d, ch, c),
    template_combinar: (ch, c) => combinar(d, ch, c),
    template_no_trabalho_ler: (ch, c) => noTrabalhoLer(d, ch, c),
    template_no_trabalho: (ch, c) => noTrabalho(d, ch, c),
    referencia_carrossel_criar: (ch, c) => referenciaCriar(d, ch, c),
    referencia_carrossel_reordenar: (ch, c) => reordenar(d, ch, c),
  };
}

/** Rotas que podem passar de 150 s (IA). */
export const ROTAS_LONGAS_DOS_TEMPLATES = ["template_teste_gerar", "template_combinar", "referencia_carrossel_criar"];

// ------------------------------------------------------------------ na conversa do estilo

const PEDE_CARROSSEL = /carross|sequ[eê]ncia|l[aâ]mina|continuidade|pegada/i;

export type TemplatesNaConversa = {
  templates: TemplateDeDesign[];
  texto: string;
  dados: Record<string, unknown>;
  custo: number;
  carrossel: Array<{ bucket: string; caminho: string; nome: string }>;
};

/**
 * Antes do modelo: os templates do cliente (apelidos t*), a leitura do
 * carrossel anexado quando a mensagem fala de carrossel (continuidade, uma
 * chamada do leitor) e o texto que entra no sistema.
 */
export async function templatesNaConversa(
  d: DepsDosTemplates,
  ch: Chamador,
  p: Pedido,
  e: { novas: Array<{ dados: { bucket: string; caminho: string } ; titulo: string }>; imagens: ImagemEntrada[]; mensagem: string; candidatas: Array<AlvoComApelido> },
): Promise<TemplatesNaConversa> {
  const { templates } = await lerTemplates(banco(d), p.clientId, p.marcaId).catch((e) => (registrarFalha("agente-estilo: lerTemplates falhou", e), ({ templates: [] as TemplateDeDesign[] })));
  const carrossel = e.novas.map((n) => ({ bucket: n.dados.bucket, caminho: n.dados.caminho, nome: n.titulo }));
  let custo = 0;
  let leitura = "";
  if (e.imagens.length >= 1 && PEDE_CARROSSEL.test(e.mensagem)) {
    try {
      const lida = await lerSequencia(d, ch, p, e.imagens);
      custo += lida.custo;
      leitura = neutralizarMarcaDaReferencia(continuidadeEmTexto(lida.continuidade));
    } catch (erro) {
      // Sem leitura do carrossel: o agente segue com a leitura das referências do estilo. Frente FS: com log.
      registrarFalha("agente-estilo: leitura do carrossel falhou (vale a leitura das referências do estilo)", erro, { client_id: p.clientId });
    }
  }
  const alvos = alvosDosTemplates(templates, e.candidatas, carrossel.length);
  return {
    templates,
    texto: `\n${INSTRUCOES_DOS_TEMPLATES}\n${blocoDosAlvosDosTemplates(alvos, templates)}`,
    dados: leitura ? { leitura_do_carrossel_anexado: leitura } : {},
    custo,
    carrossel: carrossel.length >= 2 ? carrossel : [],
  };
}

/** Depois do modelo: o cartão das ações de template e, com pedido_de_combinacao, o cartão da combinação. */
export async function acoesDosTemplatesNaConversa(
  d: DepsDosTemplates,
  ch: Chamador,
  p: Pedido,
  j: Record<string, unknown>,
  prep: TemplatesNaConversa,
  e: { candidatas: Array<AlvoComApelido & { dados?: Record<string, unknown> }>; gerador: ModeloIa | null; conversaId: string },
): Promise<{ anexos: AcaoDoAgente[]; custo: number; aviso: string | null }> {
  const alvos = alvosDosTemplates(prep.templates, e.candidatas, prep.carrossel.length);
  const candidatas: Record<string, { bucket: string; caminho: string; nome: string; origem: string; leitura?: string | null }> = {};
  for (const c of e.candidatas) {
    const x = (c.dados || {}) as Record<string, unknown>;
    if (x.bucket && x.caminho) candidatas[c.id] = { bucket: String(x.bucket), caminho: String(x.caminho), nome: c.titulo, origem: String(x.origem || "referencia"), leitura: x.leitura ? String(x.leitura) : null };
  }
  const saida: AcaoDoAgente[] = [];
  const acao = normalizarAcoesDosTemplates(separarAcoes(j.acoes).dosTemplates, alvos, {
    proposta: j.proposta_de_template,
    formato: j.formato_da_proposta,
    clientId: p.clientId,
    marcaId: p.marcaId,
    custoPorImagem: e.gerador ? d.custoPorImagem(e.gerador, 2) : 0,
    carrossel: prep.carrossel,
    candidatas,
    id: `templates-${Date.now().toString(36)}`,
  });
  if (acao) {
    if (e.gerador) acao.contexto = { ...(acao.contexto || {}), modelo_imagem_id: e.gerador.id };
    saida.push(acao);
  }
  let custo = 0;
  let aviso: string | null = null;
  const pedido = j.pedido_de_combinacao && typeof j.pedido_de_combinacao === "object" ? (j.pedido_de_combinacao as Record<string, unknown>) : null;
  if (pedido && Array.isArray(pedido.fontes)) {
    try {
      const refs = (pedido.fontes as unknown[]).map((x) => String(x || "").toLowerCase()).slice(0, MAX_FONTES_DA_COMBINACAO);
      const pedidas = refs
        .map((ref) => {
          const t = alvos.templates.find((a) => a.ref === ref);
          if (t) return { tipo: "template", id: t.id };
          const c = e.candidatas.find((a) => a.ref === ref);
          return c && c.dados && (c.dados as Record<string, unknown>).origem === "referencia" ? { tipo: "referencia", id: c.id } : null;
        })
        .filter(Boolean);
      const fontes = await fontesDaCombinacao(d, p, pedidas);
      const r = await combinarInterno(d, ch, p, { fontes, objetivo: limpo(pedido.objetivo, 300), formato: j.formato_da_proposta, escopo: "cliente", referenciaUso: e.conversaId });
      custo += r.custo;
      if (r.acao) {
        r.acao.id = `combinacao-${Date.now().toString(36)}`;
        saida.push(r.acao);
      }
      if (r.pedir) aviso = `${r.pedir} Use Combinar na aba Templates.`;
    } catch (erro) {
      aviso = `Não deu para combinar agora: ${erro instanceof Error ? erro.message : "tente pela aba Templates"}.`;
    }
  }
  return { anexos: saida, custo, aviso };
}

// ------------------------------------------------------------------ execução das ações confirmadas

export async function executarItemDeTemplate(
  d: DepsDosTemplates,
  ch: Chamador,
  p: Pedido,
  acao: AcaoDoAgente,
  item: ItemDaAcaoDoAgente,
): Promise<{ desfazer?: Record<string, unknown> | null; aviso?: string; custo: number }> {
  const agora = new Date().toISOString();
  const ctx = (acao.contexto || {}) as Record<string, unknown>;
  const versao = (id: string, antes: number, depois: TemplateDeDesign) => ({ tipo: "template_versao", id, antes, nova: depois.versao_atual });
  if (item.operacao === "criar_template") {
    const propostas = (ctx.propostas || {}) as Record<string, unknown>;
    const bruta = (propostas[item.alvo_id] || ctx.proposta_de_template) as Record<string, unknown> | undefined;
    const prop = bruta && bruta.corpo ? (bruta as unknown as PropostaDeTemplate) : null;
    if (!prop) throw new Error("A proposta do template não veio junto.");
    const corpo = normalizarCorpo(prop.corpo, prop.corpo.formato);
    if (!corpoTemConteudo(corpo)) throw new Error("A proposta do template está vazia.");
    const id = crypto.randomUUID();
    const escopo: EscopoDoTemplate = ctx.escopo === "agencia" ? "agencia" : "cliente";
    const nome = typeof item.para === "string" && item.para ? item.para : prop.nome;
    await mudar(d, ch, p.clientId, id, () =>
      templateNovo({
        id,
        escopo,
        clientId: p.clientId,
        marcaId: p.marcaId,
        nome,
        origem: ctx.combinacao ? "combinacao" : "agente",
        corpo,
        nota: ctx.combinacao ? "Combinação confirmada." : "Proposta do agente.",
        por: ch.userId,
        agora,
        deOnde: prop.de_onde || [],
        fontes: Array.isArray(ctx.fontes) ? (ctx.fontes as string[]) : [],
      })
    );
    return { desfazer: { tipo: "template_criado", id }, custo: 0 };
  }
  if (item.operacao === "atualizar_template") {
    const prop = ctx.proposta_de_template as PropostaDeTemplate | undefined;
    if (!prop || !prop.corpo) throw new Error("A proposta do template não veio junto.");
    let antes = 0;
    const t = await mudar(d, ch, p.clientId, item.alvo_id, (x) => {
      const y = exigir(x);
      antes = y.versao_atual;
      const atual = corpoAtual(y);
      const novo = normalizarCorpo({ ...prop.corpo, formato: y.formato }, y.formato);
      return comNovaVersaoDoTemplate(y, { ...novo, ancoras: atual ? atual.ancoras : [], laminas_referencia: atual ? atual.laminas_referencia : [] }, "agente", String(item.para || "Proposta do agente."), ch.userId, agora, prop.de_onde || []);
    });
    return { desfazer: versao(item.alvo_id, antes, t), custo: 0 };
  }
  if (item.operacao === "arquivar_template") {
    await mudar(d, ch, p.clientId, item.alvo_id, (x) => arquivado(exigir(x), true));
    return { desfazer: { tipo: "template_arquivado", id: item.alvo_id }, custo: 0 };
  }
  if (item.operacao === "registrar_gosto_template") {
    const lista = gostosDoPara(item.para);
    if (!lista.length) throw new Error("Gosto vazio.");
    const ids = lista.map(() => crypto.randomUUID().slice(0, 12));
    await mudar(d, ch, p.clientId, item.alvo_id, (x) => lista.reduce((y, g, k) => comGosto(y, g, ch.userId, agora, ids[k]), exigir(x)));
    return { desfazer: { tipo: "template_gostos", id: item.alvo_id, ids }, custo: 0 };
  }
  if (item.operacao === "ancora_no_template") {
    const [ref, papel] = String(item.para || "").split(":");
    const destino = ((ctx.destinos || {}) as Record<string, string>)[ref];
    const dados = ((ctx.ancoras || {}) as Record<string, Record<string, unknown>>)[item.alvo_id];
    if (!destino || !dados) throw new Error("O template ou a imagem desta âncora não foram encontrados.");
    const ancora = normalizarAncora({ id: item.alvo_id, origem: dados.origem === "acervo" ? "arte_aprovada" : "referencia", bucket: dados.bucket, caminho: dados.caminho, nome: dados.nome, papel, leitura: dados.leitura });
    if (!ancora) throw new Error("A imagem desta âncora não é válida.");
    let antes = 0;
    const t = await mudar(d, ch, p.clientId, destino, (x) => {
      const y = exigir(x);
      antes = y.versao_atual;
      return comAncoras(y, [ancora], [], ch.userId, agora, `Âncora nova: ${item.titulo}.`);
    });
    return { desfazer: versao(destino, antes, t), custo: 0 };
  }
  if (item.operacao === "gerar_teste_template") {
    const pedido = lerPedidoDeTesteDoTemplate(item.para) || { n: 1, tema: "" };
    const r = await gerarTestes(d, ch, p, item.alvo_id, pedido.n, pedido.tema, ctx.modelo_imagem_id);
    return { desfazer: null, aviso: r.avisos.length ? r.avisos.join(" ") : undefined, custo: r.custo };
  }
  if (item.operacao === "guardar_referencia_carrossel") {
    const laminas = (Array.isArray(ctx.carrossel) ? ctx.carrossel : []) as Array<{ bucket: string; caminho: string; nome: string }>;
    if (laminas.length < 2) throw new Error("As lâminas desta mensagem não vieram junto.");
    const id = crypto.randomUUID();
    const r = await criarReferencia(d, ch, p, { id, nome: typeof item.para === "string" ? item.para : "Carrossel de referência", escopo: "cliente", laminas });
    return { desfazer: { tipo: "template_criado", id }, custo: r.custo };
  }
  throw new Error("Operação desconhecida.");
}

export const ehDesfazerDeTemplate = (r: ResultadoDoItem) => String(((r.desfazer || {}) as Record<string, unknown>).tipo || "").indexOf("template_") === 0;

export async function reverterItemDeTemplate(d: DepsDosTemplates, ch: Chamador, p: Pedido, r: ResultadoDoItem) {
  const x = (r.desfazer || {}) as Record<string, unknown>;
  const id = String(x.id || "");
  if (!UUID.test(id)) throw new Error("Sem o que desfazer.");
  if (x.tipo === "template_criado") {
    // Apagar é arquivar: o template criado sai da lista e do seletor, mas fica guardado.
    await mudar(d, ch, p.clientId, id, (t) => arquivado(exigir(t), true));
    return;
  }
  if (x.tipo === "template_arquivado") {
    await mudar(d, ch, p.clientId, id, (t) => arquivado(exigir(t), false));
    return;
  }
  if (x.tipo === "template_versao") {
    const nova = Number(x.nova);
    const antes = Number(x.antes);
    await mudar(d, ch, p.clientId, id, (t) => {
      const y = exigir(t);
      if (y.versao_atual !== nova) throw new Error("O template mudou depois desta ação. Volte a versão pela aba Templates.");
      const versoes = y.versoes.filter((v) => v.numero !== nova);
      return { ...y, versoes, versao_atual: versoes.some((v) => v.numero === antes) ? antes : versoes.length ? versoes[versoes.length - 1].numero : 0 };
    });
    return;
  }
  if (x.tipo === "template_gostos") {
    const ids = Array.isArray(x.ids) ? x.ids.map(String) : [];
    await mudar(d, ch, p.clientId, id, (t) => ids.reduce((y, g) => semGosto(y, g), exigir(t)));
    return;
  }
  throw new Error("Sem o que desfazer.");
}
