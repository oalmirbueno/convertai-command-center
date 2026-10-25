/**
 * Jornada da Mesa Site (25/10/2026): os passos novos, enxutos, da tela.
 *
 * jornada_contexto { site_id } -> { contexto, origem, editado, salvo }:
 *   o que o painel já sabe do cliente (marca, contexto, estratégia, dossiê,
 *   Instagram, cadastro, dados do site), pela regra da marca (a outra marca
 *   nunca herda), com o que a equipe editou por cima. Sem IA, sem custo.
 * jornada_salvar { site_id, objetivo?, partida?, contexto? } -> { site }:
 *   grava a jornada em direcao.jornada. O objetivo, com o site ainda sem
 *   seção construída, troca o tipo e o mapa pelo do objetivo.
 * modelos_prontos_listar { site_id, objetivo? } -> { modelos, do_nicho, recomendado, porque }:
 *   a galeria de sites prontos filtrada pelo objetivo e pelo nicho; o Jev
 *   recomenda um (Choice, cobrado na carteira do cliente).
 * copy_da_pagina_gerar { site_id, modelo_id? } -> { site, escolhas }:
 *   o motor de copy da casa escreve 2 versões por seção pela estrutura que
 *   converte; o Jev escolhe uma por seção; humanizer e corte do que não tem fonte.
 *
 * Só equipe (a função mesa-site já confere). Sem travessão.
 */
import { chamarTexto, cobrarJev } from "../_shared/ia-motor.ts";
import { jevPerguntar } from "../_shared/jev.ts";
import { lerMarcaParaDirecaoDaMarca } from "../_shared/marca.ts";
import { lerContextoCompletoDaMarca } from "../_shared/contexto-completo-da-marca.ts";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { superpoderesPara } from "../_shared/superpoderes.ts";
import { regrasDaMesa } from "../_shared/aprendizado-das-mesas.ts";
import { baseDoAgente } from "../_shared/base-do-agente.ts";
import { blocoDoMotor } from "../_shared/motor-de-copy.ts";
import { vozDaMarca } from "../_shared/motor-de-copy-servidor.ts";
import { trabalhosDoProjeto } from "../_shared/motor-fila.ts";
import { copyEscolhida, type LinhaDoSite } from "../_shared/pacote-do-site.ts";
import { mapaDoSite, mapaPadrao, secaoDaBiblioteca, secoesDoMapa, tipoDoUid } from "../_shared/site-biblioteca.ts";
import { prepararCopyViral } from "../estudio-arte/modulos/copy-viral-servidor.ts";
import { modeloDoEscopo } from "../estudio-arte/modulos/copy-viral-servidor.ts";
import { nichosDoTexto, passadaFinal } from "../estudio-arte/modulos/copy-viral.ts";
import type { ChamadorDaEstrutura, ContextoDaEstrutura } from "./estrutura.ts";
import { guardarVersao } from "./versoes.ts";
import { camposDoModelo, modeloDePagina } from "./modulos/modelos-de-pagina.ts";
import { MODELOS_PRONTOS } from "./modulos/modelos-prontos.ts";
import {
  type ContextoDoCliente,
  contextoDasFontes,
  juntarContexto,
  modelosDoObjetivo,
  normalizarContexto,
  normalizarPartida,
  objetivoDoSite,
  perguntaDoModeloPronto,
} from "./modulos/jornada-do-site.ts";
import {
  ESQUEMA_DA_COPY_DA_PAGINA,
  montarCopyEscolhida,
  normalizarCopyEmDuasVersoes,
  perguntasDasVersoes,
  secoesComPapel,
  SISTEMA_DA_COPY_DA_PAGINA,
} from "./modulos/copy-da-pagina.ts";

const PAPEL = "site" as const;
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arred = (v: number) => Math.round(v * 1e6) / 1e6;

const jornadaDe = (s: LinhaDoSite) => obj(obj(s.direcao).jornada);

// ------------------------------------------------------------------ contexto do cliente

/** Lê o que o painel sabe do cliente para a marca do site. Nunca lança: a parte que falha fica vazia. */
export async function contextoDoClienteDoSite(ctx: ContextoDaEstrutura, s: LinhaDoSite): Promise<{ contexto: ContextoDoCliente; origem: Record<string, string>; nichos: string[] }> {
  const db = ctx.servico();
  const marca = await ctx.marcaDoSite(s).catch(() => null);
  const seguro = <T,>(p: PromiseLike<T>, padrao: T, rotulo: string): Promise<T> =>
    Promise.resolve(p).then((x) => x, (e) => (registrarFalha(`mesa-site: jornada sem ${rotulo}`, e, { site_id: s.id }), padrao));
  const [pacote, direcao, perfil, fiscais, ofertas] = await Promise.all([
    seguro(lerContextoCompletoDaMarca(db as never, s.client_id, marca || s.marca_id, { area: "site" }), null, "contexto completo"),
    seguro(lerMarcaParaDirecaoDaMarca(db, s.client_id, marca), null, "kit da marca"),
    seguro(db.from("profiles").select("phone, email").eq("id", s.client_id).maybeSingle().then((r) => r.data as { phone: string | null; email: string | null } | null), null, "cadastro"),
    seguro(db.from("cliente_dados_fiscais").select("logradouro, numero, bairro, cidade, uf, telefone").eq("client_id", s.client_id).maybeSingle().then((r) => r.data as Record<string, string | null> | null), null, "endereço"),
    // As ofertas da Mesa Ads são do cliente inteiro: a regra (só a principal) mora em contextoDasFontes.
    seguro(db.from("ads_ofertas").select("nome").eq("client_id", s.client_id).order("atualizado_em", { ascending: false }).limit(6).then((r) => ((r.data as Array<{ nome: string | null }> | null) ?? []).map((x) => String(x.nome || "")).filter(Boolean)), [] as string[], "ofertas"),
  ]);
  const endereco = fiscais ? [[fiscais.logradouro, fiscais.numero].filter(Boolean).join(", "), fiscais.bairro, [fiscais.cidade, fiscais.uf].filter(Boolean).join("/")].filter(Boolean).join(", ") : "";
  const copy = copyEscolhida(s.conteudo || {});
  const r = contextoDasFontes({
    marca: marca ? { nome: marca.nome, principal: !!marca.principal } : null,
    nomeCliente: direcao ? direcao.nomeCliente : pacote ? pacote.nomeCliente : s.nome,
    kit: {
      cores: direcao ? direcao.paleta.map((p) => String(p.hex || "")) : [],
      fontes: direcao ? direcao.fontes.map((f) => f.nome) : [],
      temLogo: !!(direcao && direcao.temLogo),
      tom: direcao ? direcao.tomDeVoz : null,
    },
    contexto: pacote ? pacote.contexto : {},
    estrategia: pacote && pacote.estrategia ? { tagline: pacote.estrategia.tagline, estrategia: pacote.estrategia.estrategia } : null,
    dossie: pacote && pacote.dossie ? pacote.dossie.texto : null,
    instagram: pacote && pacote.instagram ? pacote.instagram.contas : [],
    cadastro: { telefone: (perfil && perfil.phone) || (fiscais && fiscais.telefone) || null, email: perfil ? perfil.email : null, endereco: endereco || null },
    site: { seo: s.seo || {}, integracoes: s.integracoes || {} },
    ofertas,
    copyDoSite: copy ? [copy.headline] : [],
  });
  const c = r.contexto;
  const nichos = nichosDoTexto(c.negocio, c.produtos.join(", "), c.oferta, c.marca.nome).map(String);
  const nichoDoSite = typeof obj(s.direcao).nicho === "string" ? [String(obj(s.direcao).nicho)] : [];
  return { contexto: c, origem: r.origem, nichos: nichoDoSite.concat(nichos) };
}

async function jornadaContexto(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const lido = await contextoDoClienteDoSite(ctx, s);
  const editado = obj(jornadaDe(s).contexto);
  return ctx.json({ contexto: juntarContexto(lido.contexto, editado), do_cliente: lido.contexto, origem: lido.origem, editado, nichos: lido.nichos, custo_usd: 0 });
}

// ------------------------------------------------------------------ salvar a jornada

async function jornadaSalvar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const jornada = { ...jornadaDe(s) };
  const campos: Record<string, unknown> = {};
  let direcao = { ...obj(s.direcao) };
  if (c.objetivo !== undefined) {
    const o = objetivoDoSite(c.objetivo);
    if (!o) throw ctx.erro(400, "objetivo_invalido", "Esse objetivo não existe.");
    jornada.objetivo = o.id;
    // Com seção já construída, o mapa fica como está (trocar o mapa jogaria fora o que o motor fez).
    const trabalhos = await trabalhosDoProjeto(ctx.servico(), s.client_id, s.id, 30).catch(() => []);
    const construido = trabalhos.some((t) => t.estado === "feito" && (t.tipo === "construir" || t.tipo === "textos"));
    if (!construido && c.aplicar_mapa !== false) {
      const modelo = o.modelo ? modeloDePagina(o.modelo) : null;
      if (modelo) {
        const m = camposDoModelo(modelo, { direcao, briefing: obj(s.briefing), estilo: obj(s.estilo) });
        Object.assign(campos, { tipo: m.tipo, mapa: m.mapa, estilo: m.estilo, briefing: m.briefing });
        direcao = m.direcao;
      } else {
        const mapa = mapaPadrao(o.tipo);
        const respostas = { ...obj(obj(s.briefing).respostas) };
        if (!respostas.objetivo) respostas.objetivo = o.rotulo;
        if (!respostas.acao) respostas.acao = o.acao;
        Object.assign(campos, { tipo: o.tipo, mapa, briefing: { ...obj(s.briefing), respostas } });
        direcao = { ...direcao, secoes: secoesDoMapa(mapa) };
      }
    }
  }
  if (c.partida !== undefined) {
    const p = normalizarPartida(c.partida);
    if (!p) throw ctx.erro(400, "partida_invalida", "Escolha do zero, uma referência com endereço público (https) ou um site pronto.");
    if (p.tipo === "modelo_pronto" && !MODELOS_PRONTOS.some((m) => m.id === p.modelo_id)) throw ctx.erro(404, "modelo_pronto_inexistente", "Esse site pronto não está na galeria.");
    jornada.partida = p;
  }
  if (c.contexto !== undefined) {
    // Só o que a equipe mudou; a marca é do kit (nunca vem daqui).
    const e = obj(c.contexto);
    delete e.marca;
    const limpo = normalizarContexto(e);
    const editado: Record<string, unknown> = {};
    Object.keys(e).forEach((k) => {
      if (k in limpo && k !== "marca" && k !== "dossie") editado[k] = (limpo as unknown as Record<string, unknown>)[k];
    });
    jornada.contexto = { ...obj(jornada.contexto), ...editado };
  }
  jornada.atualizada_em = new Date().toISOString();
  campos.direcao = { ...direcao, jornada };
  if (campos.mapa) {
    const v = await guardarVersao(ctx.servico(), s as unknown as Record<string, unknown> & { id: string; client_id: string }, "objetivo da jornada", ch.userId);
    if (v.erro) registrarFalha("mesa-site: versão não guardada", new Error(v.erro), { site_id: s.id });
  }
  return ctx.json({ site: await ctx.atualizarSite(s.id, campos), custo_usd: 0 });
}

// ------------------------------------------------------------------ galeria de sites prontos

async function modelosProntosListar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const objetivo = objetivoDoSite(c.objetivo !== undefined ? c.objetivo : jornadaDe(s).objetivo);
  const lido = await contextoDoClienteDoSite(ctx, s);
  const { lista, doNicho } = modelosDoObjetivo(MODELOS_PRONTOS, objetivo ? objetivo.id : null, lido.nichos);
  let recomendado: string | null = lista.length === 1 ? lista[0].id : null;
  let confianca: number | null = null;
  let custo = 0;
  if (lista.length > 1 && c.recomendar !== false) {
    try {
      const r = await jevPerguntar({
        state: {
          cliente: { nome: lido.contexto.marca.nome, negocio: lido.contexto.negocio, publico: lido.contexto.publico, oferta: lido.contexto.oferta, nicho: lido.nichos.join(", ") },
          objetivo: objetivo ? `${objetivo.rotulo}: ${objetivo.descricao}` : "site da marca",
        },
        questions: { modelo: perguntaDoModeloPronto(lista) },
      });
      const a = r.answers.modelo;
      if (a && typeof a.choice === "string" && lista.some((m) => m.id === a.choice)) {
        recomendado = a.choice;
        confianca = typeof a.confidence === "number" ? a.confidence : null;
      }
      const cobrado = await cobrarJev(r, { clientId: s.client_id, tarefa: PAPEL, referencia: { tipo: "site", id: s.id }, criadoPor: ch.userId });
      custo = cobrado ? cobrado.custoUsd : 0;
    } catch (e) {
      // Sem o Jev, sem recomendação: a galeria segue, com o do nicho primeiro.
      registrarFalha("mesa-site: Jev da galeria de sites prontos", e, { site_id: s.id });
    }
  }
  return ctx.json({ modelos: lista, do_nicho: doNicho, nichos: lido.nichos.slice(0, 6), objetivo: objetivo ? objetivo.id : null, recomendado, confianca, custo_usd: arred(custo) });
}

// ------------------------------------------------------------------ copy da página

async function copyDaPaginaGerar(ctx: ContextoDaEstrutura, ch: ChamadorDaEstrutura, c: Record<string, unknown>) {
  const s = await ctx.lerSite(ch, c.site_id);
  const db = ctx.servico();
  const objetivo = objetivoDoSite(jornadaDe(s).objetivo);
  const modelo = await modeloDoEscopo(db, s.client_id, "site", c.modelo_id);
  if (!modelo) throw ctx.erro(409, "sem_modelo", "Nenhum modelo de copy ativo no catálogo.");
  const mapa = mapaDoSite(s);
  const secoes = secoesComPapel(
    secoesDoMapa(mapa).map((id) => {
      const tipo = tipoDoUid(mapa, id);
      const lib = secaoDaBiblioteca(tipo);
      return { id, tipo, nome: lib ? lib.rotulo : id, formula: lib ? lib.formula : "", so_dado_real: !!(lib && lib.so_real) };
    }),
    objetivo,
  );
  if (!secoes.length) throw ctx.erro(409, "sem_secoes", "O mapa do site não tem seção com texto.");
  const lido = await contextoDoClienteDoSite(ctx, s);
  const contexto = juntarContexto(lido.contexto, obj(jornadaDe(s).contexto));
  // O perfil do nicho sai do contexto da marca do site (nunca do kit de outra marca).
  const perfil = { cliente: contexto.marca.nome || s.nome, segmento: null, nichos: lido.nichos.length ? lido.nichos : ["geral"], publico: contexto.publico || null, dor: null, oferta: contexto.oferta || null, negocio: contexto.negocio || null };
  const [regras, voz, base, viral, metodo] = await Promise.all([
    regrasDaMesa(db, { clientId: s.client_id, mesa: "site", marcaId: s.marca_id }),
    vozDaMarca(db, s.client_id, s.marca_id ? { marca_id: s.marca_id } : null),
    baseDoAgente(db, { agente: "site.agente", clientId: s.client_id, pedido: `Copy da página do site ${s.nome}${objetivo ? ` para ${objetivo.rotulo.toLowerCase()}` : ""}`, tarefa: PAPEL, referencia: { tipo: "site", id: s.id }, criadoPor: ch.userId }),
    prepararCopyViral(db, { clientId: s.client_id, formato: "anuncio", versoes: 2, semente: s.id, perfil }),
    superpoderesPara(db, { agente: "site.geracao", momento: s.conteudo && copyEscolhida(s.conteudo) ? "ajustar" : "gerar" }),
  ]);
  const dados = {
    cliente: { nome: contexto.marca.nome, negocio: contexto.negocio, publico: contexto.publico, oferta: contexto.oferta, diferenciais: contexto.diferenciais, produtos: contexto.produtos, contatos: contexto.contatos, endereco: contexto.endereco, horarios: contexto.horarios, copy_aprovada: contexto.copy_aprovada },
    objetivo: objetivo ? { nome: objetivo.rotulo, proximo_passo: objetivo.acao } : null,
    tipo_de_site: mapa.tipo,
    SECOES: secoes,
    motor_de_copy: blocoDoMotor({ canal: "site", objetivo: objetivo ? objetivo.copy : "contato", variacoes: 2, estruturaPedida: "a página que converte: gancho, dor, oferta, prova, objeções e chamada (a MISSAO de cada seção)", regras: voz.regras }),
  };
  const saida = await chamarTexto({
    clientId: s.client_id,
    tarefa: PAPEL,
    agente: PAPEL,
    modeloId: modelo.id,
    sistema: [SISTEMA_DA_COPY_DA_PAGINA, viral.bloco, voz.bloco, regras.bloco, base.bloco].filter(Boolean).join("\n\n"),
    mensagens: [{ papel: "usuario", conteudo: `DADOS:\n${JSON.stringify(dados)}` }],
    esquemaJson: ESQUEMA_DA_COPY_DA_PAGINA,
    maxTokensSaida: 9_000,
    metodo,
    referencia: { tipo: "site", id: s.id },
    criadoPor: ch.userId,
  });
  const copy = normalizarCopyEmDuasVersoes(saida.json, secoes.map((x) => x.id));
  if (!copy.abertura.length || !copy.secoes.length) throw ctx.erro(502, "conteudo_vazio", "O modelo não devolveu a copy da página. Tente de novo.");
  const papeis: Record<string, { PAPEL: string; MISSAO: string }> = {};
  secoes.forEach((x) => (papeis[x.id] = { PAPEL: x.PAPEL, MISSAO: x.MISSAO }));
  let respostas: Record<string, { choice?: string; probabilities?: Record<string, number> } | undefined> = {};
  let custoJev = 0;
  let avisoJev: string | null = null;
  const perguntas = perguntasDasVersoes(copy, papeis);
  if (Object.keys(perguntas).length) {
    try {
      const r = await jevPerguntar({ state: { cliente: { nome: contexto.marca.nome, negocio: contexto.negocio, publico: contexto.publico, nicho: perfil.nichos.join(", ") }, objetivo: objetivo ? `${objetivo.rotulo}: ${objetivo.acao}` : "contato" }, questions: perguntas });
      respostas = r.answers;
      const cobrado = await cobrarJev(r, { clientId: s.client_id, tarefa: PAPEL, referencia: { tipo: "site", id: s.id }, criadoPor: ch.userId });
      custoJev = cobrado ? cobrado.custoUsd : 0;
    } catch (e) {
      registrarFalha("mesa-site: Jev da copy da página", e, { site_id: s.id });
      avisoJev = "O Jev não respondeu: ficou a primeira versão de cada seção (a outra continua para trocar).";
    }
  }
  const fontes = JSON.stringify(dados.cliente);
  const escolha = montarCopyEscolhida(copy, respostas, objetivo, (t) => passadaFinal(t, fontes).texto || t);
  if (!escolha) throw ctx.erro(502, "conteudo_vazio", "A copy da página veio vazia. Tente de novo.");
  const v = await guardarVersao(db, s as unknown as Record<string, unknown> & { id: string; client_id: string }, "copy da página (motor de copy)", ch.userId);
  if (v.erro) registrarFalha("mesa-site: versão não guardada", new Error(v.erro), { site_id: s.id });
  const conteudo = { ...obj(s.conteudo), opcoes: [escolha.opcao], escolhida: 0, por_secao: { ...obj(obj(s.conteudo).por_secao), ...escolha.por_secao }, abertura_versoes: escolha.abertura, gerado_em: new Date().toISOString(), modelo: modelo.id, motor: "copy_da_pagina", objetivo: objetivo ? objetivo.id : null };
  const site = await ctx.atualizarSite(s.id, { conteudo });
  return ctx.json({ site, escolhas: escolha.por_secao, aviso_jev: avisoJev, custo_usd: arred(saida.custoUsd + custoJev), saldo_usd: saida.saldoUsd });
}

export function rotasDaJornada(ctx: ContextoDaEstrutura): Record<string, (ch: ChamadorDaEstrutura, c: Record<string, unknown>) => Promise<Response>> {
  return {
    jornada_contexto: (ch, c) => jornadaContexto(ctx, ch, c),
    jornada_salvar: (ch, c) => jornadaSalvar(ctx, ch, c),
    modelos_prontos_listar: (ch, c) => modelosProntosListar(ctx, ch, c),
    copy_da_pagina_gerar: (ch, c) => copyDaPaginaGerar(ctx, ch, c),
  };
}

export const ACOES_LONGAS_DA_JORNADA = ["modelos_prontos_listar", "copy_da_pagina_gerar"];
