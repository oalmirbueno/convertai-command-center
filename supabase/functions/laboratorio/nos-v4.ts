/**
 * laboratorio v4 (ESPEC-LABORATORIO-v4.md): o que cada nó novo gera.
 *
 * O texto vem do modelo (uma chamada com esquema, pela carteira do motor); o esqueleto das páginas vem de
 * modulos/funil.ts (sempre igual e seguro); as imagens vêm do motor de imagem de sempre. Nada aqui envia
 * mensagem, publica página, cria workflow ativo ou mexe em conta: tudo sai como rascunho e o que depende
 * de conta que o dono não tem aparece em "falta_conectar". O envio e a publicação só acontecem pelo
 * Pôr no ar, depois da aprovação do dono (operator_approvals).
 *
 * As funções de execução de executar.ts entram pelo `kit` (sem import de valor de lá: sem ciclo).
 */
import type { ImagemEntrada, Qualidade } from "../_shared/ia-motor.ts";
import { ErroHttp } from "./comum.ts";
import type { ArquivoSalvo } from "./workspace.ts";
import type { Contexto, Entradas, ImagemSaida, SaidaDoNo } from "./executar.ts";
import type { EntradaDoPacote } from "./no-ar.ts";
import { lerCrmDaCasa, lerMembrosDaCasa } from "./integracoes-da-casa.ts";
import {
  blocosSemFonte,
  configDe,
  entradasDo,
  gravityDe,
  imagensComPrincipal,
  limitar,
  linksDasReferencias,
  MODELO_IMAGEM_PADRAO,
  type NoDoCanvas,
  ROTULO_DO_GATILHO,
  ROTULO_DO_TIPO,
  SAIDA_ESPERADA,
  TAMANHO_DA_PROPORCAO,
  type Proporcao,
  proporcaoValida,
} from "./modulos/regras.ts";
import {
  CHAVE_PENDENTE,
  coresDaPagina,
  destinoPor,
  destinosDoNo,
  embedDoVideo,
  enderecoDoNo,
  EVENTOS_DO_CHECKOUT,
  fiosEmTexto,
  formularioDoSite,
  GATEWAYS,
  hashCurto,
  hrefDe,
  htmlDasBoasVindas,
  htmlDoCheckout,
  htmlDoEmail,
  htmlDoQuiz,
  htmlDoTemplate,
  htmlDoTesteAb,
  lerCamadas,
  lerCopyDoCheckout,
  lerCopyDoWebinar,
  lerEmails,
  lerModelosDeWhatsApp,
  lerModulos,
  linhasDaPlanilha,
  linkComUtm,
  paginasDoWebinar,
  parametrosDoCanal,
  pesosDoTeste,
  planoDoDominio,
  previaDosEmails,
  problemasDoModelo,
  proporcaoDoFormato,
  quizNormalizado,
  rascunhoDoN8n,
  scriptDeConversaoDoTeste,
  segundosDe,
  temperaturaDe,
  UPSELL_UM_CLIQUE,
  urlHttps,
  urlPublicaSegura,
} from "./modulos/funil.ts";
import {
  ESQUEMA_DA_AREA_DE_MEMBROS,
  ESQUEMA_DA_AUTOMACAO,
  ESQUEMA_DA_RECUPERACAO,
  ESQUEMA_DAS_REFERENCIAS,
  ESQUEMA_DO_CHECKOUT,
  ESQUEMA_DO_EMAIL,
  ESQUEMA_DO_INFLUENCIADOR,
  ESQUEMA_DO_QUIZ,
  ESQUEMA_DO_TEMPLATE,
  ESQUEMA_DO_UGC,
  ESQUEMA_DO_WEBINAR,
  ESQUEMA_DO_WHATSAPP,
  SISTEMA_DA_AREA_DE_MEMBROS,
  SISTEMA_DA_AUTOMACAO,
  SISTEMA_DAS_REFERENCIAS,
  SISTEMA_DO_CHECKOUT,
  SISTEMA_DO_EMAIL,
  SISTEMA_DO_INFLUENCIADOR,
  SISTEMA_DO_QUIZ,
  SISTEMA_DO_TEMPLATE,
  SISTEMA_DO_UGC,
  SISTEMA_DO_WEBINAR,
  SISTEMA_DO_WHATSAPP,
  sistemaDaPagina,
  sistemaDaRecuperacao,
} from "./modulos/prompts_v4.ts";

type Resultado = { saida: SaidaDoNo; custo: number; usoId: string | null; status?: "pronto" | "aguardando" };
type RespostaDeTexto = { texto: string; json?: unknown; custoUsd: number; usoId: string | null; modeloId?: string };

/** O que executar.ts empresta (as mesmas funções dos nós antigos). */
export type KitV4 = {
  texto(ctx: Contexto, o: { modelo?: unknown; sistema: string; mensagem: string; imagens?: ImagemEntrada[]; esquema?: unknown; maxSaida: number; execucaoId: string; timeoutMs?: number }): Promise<RespostaDeTexto>;
  salvarHtml(ctx: Contexto, execucaoId: string, rotulo: string, html: string, indice?: number, total?: number): Promise<ArquivoSalvo>;
  gerarImagens(
    ctx: Contexto,
    execucaoId: string,
    pedidos: Array<{ prompt: string; rotulo: string }>,
    o: { modeloId: string; qualidade: Qualidade; tamanho: string; referencias: ImagemEntrada[] },
  ): Promise<{ arquivos: Array<ArquivoSalvo | null>; custo: number; usos: string[]; avisos: string[]; erros: unknown[] }>;
  bytesDas(imagens: Array<{ path: string; bucket?: string }>, max?: number): Promise<ImagemEntrada[]>;
  imagemDoArquivo(a: ArquivoSalvo, ordem?: number): ImagemSaida;
  htmlDaResposta(t: string): string;
  saidasDasEntradas(ctx: Contexto, no: NoDoCanvas): Promise<EntradaDoPacote[]>;
};

const txt = (v: unknown, max = 8000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const rotuloDoNo = (no: NoDoCanvas) => (typeof no.dados.titulo === "string" && no.dados.titulo.trim() ? no.dados.titulo.trim() : ROTULO_DO_TIPO[no.tipo]);
const somar = (...v: number[]) => Math.round(v.reduce((a, b) => a + (Number(b) || 0), 0) * 1e6) / 1e6;

/** Endereço de uma função de borda deste projeto (o formulário e a contagem do A/B). */
function funcao(nome: string): string {
  const deno = (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno;
  const base = (deno && deno.env.get("SUPABASE_URL")) || "";
  return `${base.replace(/\/+$/, "")}/functions/v1/${nome}`;
}

/** O texto que fecha o resultado: o que foi feito e, por último, o que falta conectar. */
function textoFinal(linhas: Array<string | null | false | undefined>, falta: string[]): string {
  return [...linhas.filter(Boolean), falta.length ? `Falta conectar: ${falta.join(" · ")}` : ""].filter(Boolean).join("\n");
}

/** As cores e a marca: o que veio da Marca ligada vence; senão, a marca do cliente do projeto. */
function marcaDasEntradas(ctx: Contexto, e: Entradas): string {
  return [e.textos.find((t) => /^Marca/i.test(t)) || "", ctx.marca].filter(Boolean).join("\n");
}

/** O nó de um tipo ligado antes deste (o primeiro). */
const ligadoAntes = (ctx: Contexto, no: NoDoCanvas, tipo: string) => entradasDo(ctx.canvas, no.id).find((n) => n.tipo === tipo) || null;

// ------------------------------------------------------------------ Referências

/** Lê uma página pública com até 3 redirecionamentos (cada salto conferido), 12 s e 1,5 MB. */
export async function lerPaginaPublica(url: string, buscar: typeof fetch = fetch): Promise<{ url: string; html: string } | { url: string; erro: string }> {
  const primeira = urlPublicaSegura(url);
  if (!primeira) return { url, erro: "endereço não permitido" };
  let atual: string = primeira;
  for (let salto = 0; salto < 4; salto++) {
    const ctrl = new AbortController();
    const relogio = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const r: Response = await buscar(atual, { redirect: "manual", signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0 (compatible; AceleriqLaboratorio/1.0)", accept: "text/html,*/*;q=0.5" } });
      if (r.status >= 300 && r.status < 400) {
        const proximo: string | null = r.headers.get("location");
        const seguro: string | null = proximo ? urlPublicaSegura(new URL(proximo, atual).toString()) : null;
        if (!seguro) return { url, erro: "redirecionou para endereço não permitido" };
        atual = seguro;
        continue;
      }
      if (!r.ok) return { url, erro: `respondeu ${r.status}` };
      const corpo = await r.text();
      return { url: atual, html: corpo.slice(0, 1_500_000) };
    } catch (err) {
      return { url, erro: err instanceof Error && err.name === "AbortError" ? "demorou demais" : "não abriu" };
    } finally {
      clearTimeout(relogio);
    }
  }
  return { url, erro: "redirecionou demais" };
}

/** O que dá para tirar do HTML sem copiar: título, descrição, títulos das seções, cores e fontes. */
export function estruturaDaPagina(html: string): { titulo: string; descricao: string; titulos: string[]; secoes: number; cores: string[]; fontes: string[] } {
  const limpo = (t: string) => t.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const titulo = limpo((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "").slice(0, 200);
  const descricao = ((html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) || [])[1] || "").slice(0, 300);
  const titulos: string[] = [];
  const re = /<h([1-3])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && titulos.length < 40) {
    const t = limpo(m[2]).slice(0, 160);
    if (t) titulos.push(`H${m[1]}: ${t}`);
  }
  const contagem: Record<string, number> = {};
  for (const c of html.match(/#[0-9a-fA-F]{6}\b/g) || []) contagem[c.toLowerCase()] = (contagem[c.toLowerCase()] || 0) + 1;
  const cores = Object.keys(contagem).sort((a, b) => contagem[b] - contagem[a]).slice(0, 6);
  const fontes: string[] = [];
  for (const f of html.match(/font-family\s*:\s*([^;}<]+)/gi) || []) {
    const nome = f.replace(/font-family\s*:\s*/i, "").split(",")[0].replace(/['"]/g, "").trim();
    if (nome && fontes.indexOf(nome) < 0 && fontes.length < 4 && !/inherit|var\(/i.test(nome)) fontes.push(nome);
  }
  return { titulo, descricao, titulos, secoes: (html.match(/<section\b/gi) || []).length, cores, fontes };
}

async function noReferencias(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const links = linksDasReferencias(no.dados.links);
  const prints = arr(no.dados.imagens).map(obj).filter((i) => typeof i.path === "string" && i.path).map((i) => ({ path: String(i.path), url: typeof i.url === "string" ? i.url : null, bucket: typeof i.bucket === "string" ? i.bucket : "workspace" }));
  if (!links.length && !prints.length) throw new ErroHttp(400, "referencias_vazias", "Cole ao menos um link (site, Reels ou anúncio público) ou um print no nó Referências.");
  const lidos = await Promise.all(links.map((u) => lerPaginaPublica(u)));
  const blocos = lidos.map((r) => {
    if ("erro" in r) return `REFERÊNCIA ${r.url}: não abriu (${r.erro}).`;
    const s = estruturaDaPagina(r.html);
    return [`REFERÊNCIA ${r.url}`, s.titulo ? `Título: ${s.titulo}` : "", s.descricao ? `Descrição: ${s.descricao}` : "", `Seções (<section>): ${s.secoes}`, s.titulos.length ? `Títulos na ordem:\n${s.titulos.join("\n")}` : "", s.cores.length ? `Cores mais usadas: ${s.cores.join(", ")}` : "", s.fontes.length ? `Fontes: ${s.fontes.join(", ")}` : ""].filter(Boolean).join("\n");
  });
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DAS_REFERENCIAS,
    mensagem: [txt(no.dados.o_que_aproveitar) ? `O que aproveitar: ${txt(no.dados.o_que_aproveitar)}` : "", ...blocos, prints.length ? `${prints.length} print(s) junto (imagens).` : "", ...e.textos].filter(Boolean).join("\n\n"),
    imagens: await kit.bytesDas(prints, 4),
    esquema: ESQUEMA_DAS_REFERENCIAS,
    maxSaida: SAIDA_ESPERADA.referencias,
    timeoutMs: 180_000,
    execucaoId,
  });
  const j = obj(r.json);
  const naoAbriram = lidos.filter((x) => "erro" in x).map((x) => x.url);
  return {
    saida: {
      texto: [txt(j.resumo, 3000), arr(j.como_aplicar).length ? `Como aplicar: ${arr(j.como_aplicar).map((x) => txt(x, 300)).join("; ")}` : ""].filter(Boolean).join("\n") || r.texto,
      json: r.json ?? null,
      imagens: prints,
      lidas: lidos.filter((x) => !("erro" in x)).map((x) => x.url),
      avisos: naoAbriram.length ? [`Não abriram: ${naoAbriram.join(", ")}`] : [],
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Página do funil

const PAGINAS_COM_FORMULARIO = ["captura", "inscricao", "agendar", "institucional"];
const OBJETIVOS_COM_FORMULARIO = ["capturar", "inscrever", "agendar"];

async function noPagina(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const tipo = txt(no.dados.tipo_pagina, 30) || "captura";
  const objetivo = txt(no.dados.objetivo, 30);
  const { caminho } = enderecoDoNo(no);
  const destinos = destinosDoNo(ctx.canvas, no.id);
  const comFormulario = PAGINAS_COM_FORMULARIO.indexOf(tipo) >= 0 || OBJETIVOS_COM_FORMULARIO.indexOf(objetivo) >= 0;
  // Upsell e downsell: aceitar e recusar; o resto: o botão principal e o pós-formulário.
  const checkoutAntes = ligadoAntes(ctx, no, "checkout");
  const linkUmClique = checkoutAntes ? urlHttps(checkoutAntes.dados.upsell) : null;
  const principal = destinoPor(destinos, ["clicou_botao", "upsell_aceito"]) || destinos.find((d) => d.tipo === "checkout") || null;
  const recusa = destinoPor(destinos, ["upsell_recusado"]);
  const aposFormulario = destinoPor(destinos, ["enviou_formulario"]) || (comFormulario ? destinos.find((d) => d.tipo === "pagina") || null : null);
  const hrefPrincipal = tipo === "upsell" && linkUmClique ? linkUmClique : hrefDe(principal);
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: sistemaDaPagina(tipo),
    mensagem: [
      `Página do funil: ${tipo}${objetivo ? ` (objetivo: ${objetivo})` : ""}, no endereço ${caminho}.`,
      `DESTINOS DOS BOTÕES: botão principal href="${hrefPrincipal}"${tipo === "upsell" || tipo === "downsell" ? `; botão de recusar href="${hrefDe(recusa)}"` : ""}.`,
      comFormulario ? "Esta página tem formulário: marque o lugar dele com <!--FORMULARIO-->." : "Esta página não tem formulário.",
      txt(no.dados.instrucao) ? `Pedido extra: ${txt(no.dados.instrucao)}` : "",
      ...e.textos,
      e.imagens.filter((i) => i.url).length ? `Imagens que podem entrar (links válidos por 7 dias; use como src):\n${e.imagens.filter((i) => i.url).slice(0, 8).map((i, k) => `Imagem ${k + 1}: ${i.url}`).join("\n")}` : "",
    ].filter(Boolean).join("\n\n"),
    maxSaida: SAIDA_ESPERADA.pagina,
    timeoutMs: 300_000,
    execucaoId,
  });
  let html = kit.htmlDaResposta(r.texto);
  if (comFormulario) {
    const form = formularioDoSite({ endpoint: funcao("site-formulario"), pagina: caminho, depois: aposFormulario ? aposFormulario.caminho : null, botao: tipo === "inscricao" ? "Quero participar" : tipo === "agendar" ? "Quero agendar" : "Quero receber" });
    if (html.indexOf("<!--FORMULARIO-->") >= 0) html = html.replace("<!--FORMULARIO-->", form);
    else if (/<\/main>/i.test(html)) html = html.replace(/<\/main>/i, `${form}</main>`);
    else html = html.replace(/<\/body>/i, `${form}</body>`);
  }
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  const falta = comFormulario ? ["a chave do formulário sai quando o site for publicado pela Mesa Site (Pôr no ar)"] : [];
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([`Página ${tipo} pronta em ${caminho} (${Math.round(html.length / 1024)} KB)${comFormulario ? ", com formulário que cai no CRM" : ""}.`, destinos.length ? fiosEmTexto(destinos) : ""], falta),
      json: { tipo_pagina: tipo, caminho, objetivo, formulario: comFormulario, chave_do_formulario: comFormulario ? CHAVE_PENDENTE : null, destinos },
      falta_conectar: falta,
      rascunho_sem_fonte: blocosSemFonte({ textos: [html] }),
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Checkout

/** Preço e nome do produto: do Produto ligado (dado do dono) ou da Oferta ligada. */
async function produtoEPreco(kit: KitV4, ctx: Contexto, no: NoDoCanvas): Promise<{ produto: string; preco: string }> {
  const produto = ligadoAntes(ctx, no, "produto");
  if (produto && (txt(produto.dados.nome) || txt(produto.dados.preco))) return { produto: txt(produto.dados.nome, 200), preco: txt(produto.dados.preco, 60) };
  const oferta = (await kit.saidasDasEntradas(ctx, no)).find((x) => x.no.tipo === "oferta");
  const j = obj(oferta && oferta.saida ? oferta.saida.json : null);
  return { produto: txt(j.produto, 200), preco: txt(j.preco, 60) };
}

async function noCheckout(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const gateway = txt(no.dados.gateway, 20) || "outro";
  const link = urlHttps(no.dados.link_pagamento);
  const linkComBump = urlHttps(no.dados.order_bump);
  const linkUpsell = urlHttps(no.dados.upsell);
  const { caminho } = enderecoDoNo(no);
  const { produto, preco } = await produtoEPreco(kit, ctx, no);
  const temBump = !!linkComBump || !!ligadoAntes(ctx, no, "order_bump");
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_CHECKOUT,
    mensagem: [
      `Gateway: ${GATEWAYS[gateway] || gateway}.`,
      produto ? `Produto: ${produto}` : "",
      preco ? `Preço: ${preco}` : "",
      txt(no.dados.garantia) ? `Garantia (do dono): ${txt(no.dados.garantia)}` : "",
      temBump ? "Há order bump: escreva o texto_bump." : "Sem order bump: deixe texto_bump vazio.",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_CHECKOUT,
    maxSaida: SAIDA_ESPERADA.checkout,
    execucaoId,
  });
  const copy = lerCopyDoCheckout(r.json);
  const html = htmlDoCheckout({ copy, gateway, link, linkComBump: temBump ? linkComBump : null, preco, produto, garantia: txt(no.dados.garantia, 600), cores: coresDaPagina(marcaDasEntradas(ctx, e)) });
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  const nomeGateway = GATEWAYS[gateway] || "gateway";
  const falta = [`webhook de vendas do ${nomeGateway} (sem ele, só o clique é medido)`];
  if (!link) falta.unshift("o link de pagamento do gateway (https): o Pôr no ar trava até preencher");
  if (temBump && !linkComBump) falta.push("o link do checkout com o order bump marcado (ou o bump nativo do gateway)");
  const avisos: string[] = [];
  if (linkUpsell && !UPSELL_UM_CLIQUE[gateway]) avisos.push(`No ${nomeGateway} o upsell vira uma segunda compra (sem 1 clique).`);
  const destinos = destinosDoNo(ctx.canvas, no.id);
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([`Checkout pronto em ${caminho}: o botão leva ao ${nomeGateway}${link ? "" : " (falta o link)"}${temBump ? ", com order bump marcável" : ""}.`, destinos.length ? fiosEmTexto(destinos) : "", ...avisos], falta),
      json: {
        gateway,
        link_pagamento: link,
        order_bump: linkComBump,
        upsell: linkUpsell,
        produto_externo_id: txt(no.dados.produto_externo_id, 120) || null,
        caminho,
        produto,
        preco,
        eventos_esperados: [...EVENTOS_DO_CHECKOUT],
        upsell_um_clique: !!UPSELL_UM_CLIQUE[gateway],
        // O endereço do webhook aparece no nó pelo componente IntegracaoDeVendas (outro agente).
        integracao: { componente: "IntegracaoDeVendas", gateway },
        copy,
        blocos_sem_fonte: obj(r.json).blocos_sem_fonte,
      },
      falta_conectar: falta,
      avisos,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Quiz

async function noQuiz(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const n = limitar(no.dados.perguntas, 3, 12, 6);
  const { caminho } = enderecoDoNo(no);
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_QUIZ,
    mensagem: [`Quantidade de perguntas: ${n}.`, txt(no.dados.objetivo) ? `O que descobrir: ${txt(no.dados.objetivo)}` : "", txt(no.dados.faixas) ? `Faixas pedidas: ${txt(no.dados.faixas)}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_QUIZ,
    maxSaida: SAIDA_ESPERADA.quiz,
    execucaoId,
  });
  const quiz = quizNormalizado(r.json, n);
  if (quiz.perguntas.length < 3) throw new ErroHttp(502, "quiz_sem_perguntas", "O modelo não devolveu perguntas suficientes para o quiz; rode de novo.");
  const destinos = destinosDoNo(ctx.canvas, no.id);
  const porGatilho: Record<string, string> = {};
  for (const d of destinos) if (d.gatilho && !porGatilho[d.gatilho]) porGatilho[d.gatilho] = d.link || d.caminho;
  const captura = txt(no.dados.captura, 20) || "antes_resultado";
  const html = htmlDoQuiz({ quiz, endpoint: funcao("site-formulario"), pagina: caminho, captura, destinos: porGatilho, cores: coresDaPagina(marcaDasEntradas(ctx, e)) });
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  const faixas = quiz.faixas.map((f) => `${ROTULO_DO_GATILHO[f.id]} (${f.min} a ${f.max} pontos): ${f.titulo}${porGatilho[f.id] ? ` → ${porGatilho[f.id]}` : ""}`);
  const falta = ["a chave do formulário sai quando o site for publicado pela Mesa Site (Pôr no ar)"];
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([`Quiz pronto em ${caminho}: ${quiz.perguntas.length} perguntas, pontuação até ${quiz.pontuacao_maxima}.`, ...faixas, "O envio leva { quiz: { pontuacao, faixa, respostas } } para o CRM."], falta),
      json: { ...quiz, caminho, captura, destinos: porGatilho, envio: { campo: "quiz", formato: { pontuacao: "number", faixa: "string", respostas: "Record<string,string>" } }, blocos_sem_fonte: obj(r.json).blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Webinar

async function noWebinar(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const { caminho } = enderecoDoNo(no);
  const modo = txt(no.dados.modo, 20) || "gravado";
  const video = ligadoAntes(ctx, no, "video");
  const embed = embedDoVideo(no.dados.link_video) || (video ? embedDoVideo(video.dados.link) : null);
  const segundos = segundosDe(no.dados.minuto_oferta);
  const destinos = destinosDoNo(ctx.canvas, no.id);
  const oferta = destinoPor(destinos, ["clicou_botao"]) || destinos.find((d) => d.tipo === "checkout") || null;
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_WEBINAR,
    mensagem: [
      txt(no.dados.tema) ? `Tema: ${txt(no.dados.tema)}` : "",
      `Modo: ${modo}${txt(no.dados.data) ? `; data: ${txt(no.dados.data)}` : ""}.`,
      segundos !== null ? `A oferta aparece em ${txt(no.dados.minuto_oferta)} (min:seg).` : "",
      `Página de encerramento: ${txt(no.dados.encerramento, 30) || "ultima_chamada"}.`,
      video && txt(video.dados.transcricao) ? `Transcrição da aula: ${txt(video.dados.transcricao, 12000)}` : "",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_WEBINAR,
    maxSaida: SAIDA_ESPERADA.webinar,
    timeoutMs: 240_000,
    execucaoId,
  });
  const copy = lerCopyDoWebinar(r.json);
  const paginas = paginasDoWebinar({ copy, endpoint: funcao("site-formulario"), caminho, data: txt(no.dados.data, 120), modo, embed, segundosDaOferta: segundos, linkDaOferta: hrefDe(oferta, ""), encerramento: txt(no.dados.encerramento, 30), cores: coresDaPagina(marcaDasEntradas(ctx, e)) });
  const rotulo = rotuloDoNo(no);
  const ins = await kit.salvarHtml(ctx, execucaoId, `${rotulo} inscrição`, paginas.inscricao, 0, 3);
  const sala = await kit.salvarHtml(ctx, execucaoId, `${rotulo} sala`, paginas.sala, 1, 3);
  const fim = await kit.salvarHtml(ctx, execucaoId, `${rotulo} encerramento`, paginas.encerramento, 2, 3);
  const falta = ["a chave do formulário sai quando o site for publicado pela Mesa Site (Pôr no ar)", "envio dos lembretes: domínio de e-mail do cliente verificado no Resend, só depois da sua aprovação"];
  if (!embed) falta.unshift(modo === "ao_vivo" ? "a transmissão ao vivo (link do YouTube ou do Meet do cliente)" : "o link do vídeo da aula (YouTube ou Vimeo)");
  if (!oferta) falta.push("ligar um Checkout ou uma página de vendas no fio [Clicou no botão] para o botão da oferta");
  return {
    saida: {
      html_path: ins.path,
      html_url: ins.url,
      no_workspace_id: ins.no_id,
      paginas: [
        { nome: "Inscrição", caminho, html_path: ins.path, html_url: ins.url },
        { nome: "Sala", caminho: `${caminho}/sala`, html_path: sala.path, html_url: sala.url },
        { nome: "Encerramento", caminho: `${caminho}/encerramento`, html_path: fim.path, html_url: fim.url },
      ],
      texto: textoFinal([
        `Webinar pronto: inscrição em ${caminho}, sala em ${caminho}/sala${segundos !== null ? ` (oferta aos ${txt(no.dados.minuto_oferta)})` : ""} e encerramento.`,
        copy.roteiro.length ? `Roteiro: ${copy.roteiro.map((b) => `${b.minuto} ${b.bloco}`).join(" · ")}` : "",
        copy.lembretes.length ? `${copy.lembretes.length} lembrete(s) em rascunho.` : "",
        "Fora daqui: chat ao vivo, sala de controle e transmissão própria.",
      ], falta),
      json: { modo, data: txt(no.dados.data, 120), caminho, minuto_oferta: txt(no.dados.minuto_oferta, 12), embed, oferta: oferta ? hrefDe(oferta) : null, roteiro: copy.roteiro, lembretes: copy.lembretes, copy, blocos_sem_fonte: obj(r.json).blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Domínio, teste A/B, CRM e fontes de tráfego (sem custo)

const PECAS_COM_ENDERECO = ["pagina", "checkout", "quiz", "webinar", "teste_ab", "area_membros", "landing"];

async function noDominio(_kit: KitV4, ctx: Contexto, no: NoDoCanvas, _e: Entradas, _execucaoId: string): Promise<Resultado> {
  const paginas = entradasDo(ctx.canvas, no.id).filter((n) => PECAS_COM_ENDERECO.indexOf(n.tipo) >= 0).map((n) => ({ rotulo: rotuloDoNo(n), caminho: n.tipo === "landing" ? "/" : enderecoDoNo(n).caminho }));
  const plano = planoDoDominio(no.dados, paginas);
  if (plano.erro) throw new ErroHttp(400, "dominio_invalido", plano.erro);
  const erros = plano.redirecionamentos.filter((r) => r.erro).map((r) => `${r.de || "?"}: ${r.erro}`);
  const dns = plano.cartao ? plano.cartao.registros.map((r) => `${r.tipo} ${r.nome} → ${r.valor || "aparece quando a Vercel responder"}`) : [];
  return {
    saida: {
      texto: textoFinal([
        `Domínio ${plano.host}${plano.estrutura === "subdominio" ? " (subdomínio)" : ""}.`,
        plano.enderecos.length ? `Endereços:\n${plano.enderecos.map((x) => `${x.rotulo}: ${x.url}`).join("\n")}` : "Ligue as páginas do funil neste nó para ver os endereços.",
        dns.length ? `DNS:\n${dns.join("\n")}` : "",
        plano.redirecionamentos.length ? `Links curtos: ${plano.redirecionamentos.filter((r) => !r.erro).map((r) => `${r.de} → ${r.para}`).join("; ")}` : "",
        erros.length ? `Links curtos com problema: ${erros.join("; ")}` : "",
      ], ["acesso ao DNS do domínio do cliente (aplicar o cartão no registrador); publicar é no Pôr no ar"]),
      json: plano,
      falta_conectar: ["acesso ao DNS do domínio do cliente"],
      avisos: erros,
    },
    custo: 0,
    usoId: null,
  };
}

async function noTesteAb(kit: KitV4, ctx: Contexto, no: NoDoCanvas, _e: Entradas, execucaoId: string): Promise<Resultado> {
  const variantes = entradasDo(ctx.canvas, no.id).filter((n) => n.tipo === "pagina" || n.tipo === "quiz");
  const { pesos, erro } = pesosDoTeste(no.dados.pesos, variantes.length);
  if (erro) throw new ErroHttp(400, "teste_ab_invalido", erro);
  const testeId = `teste-ab-${hashCurto(`${ctx.projeto.id}:${no.id}`)}`;
  const caminho = enderecoDoNo(no).caminho;
  const cfg = {
    teste_id: testeId,
    caminho: caminho.indexOf("/teste") === 0 && !txt(no.dados.caminho) ? `/${testeId}` : caminho,
    variantes: variantes.map((n, i) => ({ letra: String.fromCharCode(65 + i), no_id: n.id, rotulo: rotuloDoNo(n), caminho: enderecoDoNo(n).caminho, peso: pesos[i] })),
    metrica: txt(no.dados.metrica, 20) || "lead",
    limite: txt(no.dados.limite, 20) || "sem_limite",
    variavel: txt(no.dados.variavel, 30) || "titulo",
  };
  // O endereço do site: o Domínio ligado depois do teste ou o endereço das Fontes de tráfego ligadas antes.
  const dominio = ctx.canvas.ligacoes.filter((l) => l.de === no.id).map((l) => ctx.canvas.nos.find((n) => n.id === l.para)).find((n) => n && n.tipo === "dominio");
  const fontes = ligadoAntes(ctx, no, "fontes_trafego");
  const host = dominio ? planoDoDominio(dominio.dados, []).host : null;
  const base = host ? `https://${host}` : fontes ? urlHttps(fontes.dados.url_base) : null;
  const html = htmlDoTesteAb(cfg, funcao("ab-contar"), base);
  const conversao = scriptDeConversaoDoTeste(testeId, funcao("ab-contar"));
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([
        `Teste ${testeId} em ${cfg.caminho}: ${cfg.variantes.map((v) => `${v.letra} ${v.peso}% → ${v.caminho}`).join(" · ")}. Quem ganha: ${cfg.metrica}.`,
        "Uma variável por vez, métrica escolhida antes e semanas inteiras de teste. Com poucas conversões por versão o resultado não conclui nada.",
      ], []),
      json: { ...cfg, variantes: cfg.variantes.map((v) => ({ ...v, id: v.letra.toLowerCase() })), base, vencedora: null, encerrado: false, contagem: "ab-contar", script_de_conversao: conversao },
    },
    custo: 0,
    usoId: null,
  };
}

async function noCrm(_kit: KitV4, ctx: Contexto, no: NoDoCanvas, _e: Entradas, _execucaoId: string): Promise<Resultado> {
  const nativo = await lerCrmDaCasa(ctx, no);
  const quando = ctx.canvas.ligacoes
    .filter((l) => l.para === no.id)
    .map((l) => {
      const origem = ctx.canvas.nos.find((n) => n.id === l.de);
      return origem ? { no_id: origem.id, origem: rotuloDoNo(origem), gatilho: typeof l.gatilho === "string" ? l.gatilho : null } : null;
    })
    .filter(Boolean) as Array<{ no_id: string; origem: string; gatilho: string | null }>;
  if (nativo && (!quando.length || !txt(no.dados.etapa, 120))) return { saida: nativo, custo: 0, usoId: null };
  if (!quando.length) throw new ErroHttp(400, "crm_sem_origem", "Ligue a página, o quiz, o checkout ou o webinar que põe o lead nesta etapa.");
  const etapa = txt(no.dados.etapa, 120);
  if (!etapa) throw new ErroHttp(400, "crm_sem_etapa", "Escreva a etapa do CRM (ex.: Lead novo, Agendou, Cliente).");
  const temperatura = temperaturaDe(no.dados.temperatura);
  const regra = { pipeline: txt(no.dados.pipeline, 120) || "Funil", etapa, temperatura, responsavel: txt(no.dados.responsavel, 120) || null, quando, nunca_volta: true };
  return {
    saida: {
      texto: textoFinal([
        nativo?.texto || "",
        `Lead vai para "${regra.etapa}" (${regra.pipeline})${temperatura ? `, temperatura ${temperatura > 0 ? "+" : ""}${temperatura}` : ""}, quando: ${quando.map((q) => `${q.origem}${q.gatilho ? ` [${ROTULO_DO_GATILHO[q.gatilho as keyof typeof ROTULO_DO_GATILHO] || q.gatilho}]` : ""}`).join("; ")}.`,
        "O fio não ocupa o redirecionamento da página e o lead nunca volta para uma etapa anterior.",
      ], ["a regra entra no CRM quando o funil for ao ar (Pôr no ar)"]),
      json: { ...regra, ...(nativo ? { contexto_nativo: nativo.json } : {}) },
      falta_conectar: ["a regra entra no CRM quando o funil for ao ar"],
    },
    custo: 0,
    usoId: null,
  };
}

async function noFontesTrafego(_kit: KitV4, ctx: Contexto, no: NoDoCanvas, _e: Entradas, _execucaoId: string): Promise<Resultado> {
  const canais = txt(no.dados.canais, 2000).split(/\n|,/).map((c) => c.trim()).filter(Boolean).slice(0, 12);
  if (!canais.length) throw new ErroHttp(400, "sem_canais", "Escreva os canais (um por linha: instagram, anuncio meta, email...).");
  const base = urlHttps(no.dados.url_base);
  const destinos = destinosDoNo(ctx.canvas, no.id);
  const links = destinos.length
    ? destinos.flatMap((d) => canais.map((c) => ({ canal: c, destino: d.rotulo, url: linkComUtm(base || "", d.caminho, parametrosDoCanal(c, txt(no.dados.campanha, 120))) })))
    : [];
  const avisos: string[] = [];
  if (!destinos.length) avisos.push("Seu link está sem destino: ligue este nó na página, quiz, webinar ou teste A/B.");
  if (!base) avisos.push("Preencha o endereço do site (https://...) para o link sair completo.");
  return {
    saida: {
      texto: textoFinal([links.length ? links.map((l) => `${l.canal} → ${l.destino}: ${l.url}`).join("\n") : "", ...avisos, links.some((l) => /anuncio|meta/i.test(l.canal)) ? "No anúncio da Meta, os parâmetros {{ad.id}} ligam o lead ao anúncio no CRM." : ""], []),
      json: { links, base, campanha: txt(no.dados.campanha, 120) },
      avisos,
    },
    custo: 0,
    usoId: null,
  };
}

// ------------------------------------------------------------------ Mensagens (tudo rascunho)

async function noAutomacao(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const quandoEntra = ctx.canvas.ligacoes.filter((l) => l.para === no.id && l.gatilho).map((l) => `${rotuloDoNo(ctx.canvas.nos.find((n) => n.id === l.de) as NoDoCanvas)} [${l.gatilho}]`);
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DA_AUTOMACAO,
    mensagem: [
      `Quando começa: ${txt(no.dados.quando, 40) || "formulario"}${quandoEntra.length ? ` (fios: ${quandoEntra.join(", ")})` : ""}.`,
      txt(no.dados.condicoes) ? `Caminhos: ${txt(no.dados.condicoes)}` : "",
      txt(no.dados.espera) ? `Esperas: ${txt(no.dados.espera)}` : "",
      `Sai do fluxo quando: ${txt(no.dados.objetivo_saida, 20) || "comprou"}; atendente que assume também tira.`,
      txt(no.dados.horario) === "nao" ? "Pode enviar fora do horário comercial." : "Só em horário comercial.",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DA_AUTOMACAO,
    maxSaida: SAIDA_ESPERADA.automacao,
    execucaoId,
  });
  const j = obj(r.json);
  const passos = arr(j.passos).map((p, i) => ({ ordem: i + 1, tipo: txt(obj(p).tipo, 60) || "passo", detalhe: txt(obj(p).detalhe, 1500), espera: txt(obj(p).espera, 120) })).slice(0, 20);
  const n8n = rascunhoDoN8n({ nome: txt(j.nome, 100) || rotuloDoNo(no), gatilho: txt(j.gatilho, 200) || txt(no.dados.quando, 40), passos, saiQuando: txt(j.sai_quando, 300), horarioComercial: txt(no.dados.horario) !== "nao" });
  const usaWhats = passos.some((p) => /whats/i.test(`${p.tipo} ${p.detalhe}`));
  const falta = ["o workflow vai ao n8n INATIVO pelo Pôr no ar (Ligar automação e mensagens); ativar é seu"];
  if (usaWhats) falta.push("WhatsApp Cloud API do cliente para os passos de WhatsApp");
  return {
    saida: {
      texto: textoFinal([txt(j.explicacao, 4000) || passos.map((p) => `${p.ordem}. ${p.tipo}: ${p.detalhe}`).join("\n"), txt(j.sai_quando) ? `Sai do fluxo: ${txt(j.sai_quando, 300)}` : ""], falta),
      json: { nome: txt(j.nome, 100), gatilho: txt(j.gatilho, 200), passos, sai_quando: txt(j.sai_quando, 300), explicacao: txt(j.explicacao, 6000), n8n, rascunho: true, blocos_sem_fonte: j.blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

async function noEmail(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const n = limitar(no.dados.mensagens, 1, 10, 3);
  const enderecos = destinosDoNo(ctx.canvas, no.id).concat(entradasDo(ctx.canvas, no.id).filter((x) => PECAS_COM_ENDERECO.indexOf(x.tipo) >= 0).map((x) => ({ no_id: x.id, tipo: x.tipo, rotulo: rotuloDoNo(x), caminho: enderecoDoNo(x).caminho, link: enderecoDoNo(x).link, gatilho: null })));
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_EMAIL,
    mensagem: [
      `Quantidade de e-mails: ${n}. Tipo: ${txt(no.dados.tipo_email, 30) || "sequencia"}.`,
      txt(no.dados.objetivo) ? `Objetivo: ${txt(no.dados.objetivo)}` : "",
      enderecos.length ? `Endereços para os botões: ${enderecos.map((d) => `${d.rotulo}: ${d.link || d.caminho}`).join("; ")}` : "",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_EMAIL,
    maxSaida: SAIDA_ESPERADA.email,
    timeoutMs: 240_000,
    execucaoId,
  });
  const emails = lerEmails(obj(r.json).emails, n);
  if (!emails.length) throw new ErroHttp(502, "email_vazio", "O modelo não devolveu os e-mails; rode de novo.");
  const cores = coresDaPagina(marcaDasEntradas(ctx, e));
  const remetente = txt(no.dados.remetente, 120);
  const previa = previaDosEmails(emails, cores, remetente);
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), previa);
  const falta = ["domínio de e-mail do cliente verificado no Resend (registros DNS)", "envio só depois da sua aprovação no Pôr no ar"];
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([`${emails.length} e-mail(s) em rascunho: ${emails.map((x) => `dia ${x.dia}: ${x.assunto}`).join(" · ")}. Nada foi enviado.`], falta),
      json: { tipo_email: txt(no.dados.tipo_email, 30), remetente, emails: emails.map((x) => ({ ...x, html: htmlDoEmail(x, cores, remetente) })), rascunho: true, enviado: false, blocos_sem_fonte: obj(r.json).blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

async function noWhatsapp(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const n = limitar(no.dados.mensagens, 1, 10, 3);
  const via = txt(no.dados.via, 20) || "cloud_api";
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_WHATSAPP,
    mensagem: [
      `Quantidade de mensagens: ${n}.`,
      txt(no.dados.tipo_mensagem) === "dentro_janela" ? "As mensagens saem dentro da janela de 24 h (a pessoa escreveu antes)." : "O gatilho não abre a janela de 24 h: precisa de modelo aprovado.",
      `Categoria do modelo: ${txt(no.dados.categoria, 20) || "utilidade"}.`,
      txt(no.dados.objetivo) ? `Objetivo: ${txt(no.dados.objetivo)}` : "",
      ...e.textos,
    ].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_WHATSAPP,
    maxSaida: SAIDA_ESPERADA.whatsapp,
    execucaoId,
  });
  const j = obj(r.json);
  const mensagens = arr(j.mensagens).map((m) => ({ dia: Math.max(0, Math.round(Number(obj(m).dia) || 0)), texto: txt(obj(m).texto, 1500), precisa_modelo: obj(m).precisa_modelo === true })).filter((m) => m.texto).slice(0, n);
  const modelos = lerModelosDeWhatsApp(j.modelos).map((m) => ({ ...m, problemas: problemasDoModelo(m) }));
  const comProblema = modelos.filter((m) => m.problemas.length);
  const falta = via === "evolution"
    ? ["o Evolution está desligado para cliente: nada é enviado por ele"]
    : ["WhatsApp Cloud API do cliente (WABA verificada, número dedicado, token) e os modelos aprovados pela Meta; enviar para análise só com a sua confirmação"];
  return {
    saida: {
      texto: textoFinal([
        `${mensagens.length} mensagem(ns) e ${modelos.length} modelo(s) no formato da Meta, em rascunho. Nada foi enviado.`,
        comProblema.length ? `Modelos que a Meta recusaria: ${comProblema.map((m) => `${m.nome}: ${m.problemas.join(" ")}`).join(" | ")}` : modelos.length ? "Os modelos passam nas regras da Meta." : "",
      ], falta),
      json: { via, mensagens, modelos, rascunho: true, enviado: false, blocos_sem_fonte: j.blocos_sem_fonte },
      falta_conectar: falta,
      avisos: comProblema.map((m) => `${m.nome}: ${m.problemas.join(" ")}`),
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

async function noRecuperacao(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const situacao = txt(no.dados.situacao, 30) || "carrinho_abandonado";
  const toques = limitar(no.dados.toques, 1, 3, 3);
  const via = txt(no.dados.via, 20) || "email";
  const checkout = ligadoAntes(ctx, no, "checkout");
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: sistemaDaRecuperacao(situacao),
    mensagem: [`Toques: ${toques}. Canal: ${via === "ambos" ? "e-mail e WhatsApp" : via}.`, checkout && urlHttps(checkout.dados.link_pagamento) ? `Link para voltar a pagar: ${urlHttps(checkout.dados.link_pagamento)}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DA_RECUPERACAO,
    maxSaida: SAIDA_ESPERADA.recuperacao,
    execucaoId,
  });
  const j = obj(r.json);
  const lista = arr(j.toques).map((t) => ({ quando: txt(obj(t).quando, 60), canal: txt(obj(t).canal, 30), assunto: txt(obj(t).assunto, 150), texto: txt(obj(t).texto, 1500), objetivo: txt(obj(t).objetivo, 200) })).filter((t) => t.texto).slice(0, toques);
  const falta = [`webhook de vendas do gateway (nó Checkout) para saber de ${situacao === "pix_pendente" ? "Pix gerado" : situacao === "carrinho_abandonado" ? "carrinho abandonado" : "pagamento"}`, "envio só depois da sua aprovação no Pôr no ar"];
  if (via !== "email") falta.push("WhatsApp Cloud API do cliente (fora da janela de 24 h só modelo aprovado)");
  return {
    saida: {
      texto: textoFinal([`${lista.length} toque(s) de recuperação em rascunho: ${lista.map((t) => `${t.quando} (${t.canal}): ${t.objetivo}`).join(" · ")}. Sai na compra.`], falta),
      json: { situacao, via, toques: lista, sai_quando: txt(j.sai_quando, 300) || "comprou", rascunho: true, enviado: false, blocos_sem_fonte: j.blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Área de membros

const PLATAFORMAS: Record<string, string> = { hotmart_club: "Hotmart Club", kiwify: "Kiwify", memberkit: "Memberkit", cademi: "Cademí", outra: "plataforma de membros", pagina_simples: "página do site" };

async function noAreaMembros(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const nativo = await lerMembrosDaCasa(ctx, no.dados.plataforma ? no : { ...no, dados: { ...no.dados, plataforma: "painel" } });
  if (nativo) {
    const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), nativo.html);
    return { saida: { texto: nativo.texto, json: nativo.json, html_path: arquivo.path, html_url: arquivo.url, no_workspace_id: arquivo.no_id, motor: "painel", pagamentos_ativados: false }, custo: 0, usoId: null };
  }
  const nm = limitar(no.dados.modulos, 1, 12, 4);
  const na = limitar(no.dados.aulas_por_modulo, 1, 15, 4);
  const plataforma = txt(no.dados.plataforma, 30) || "painel";
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DA_AREA_DE_MEMBROS,
    mensagem: [`Módulos: ${nm}. Aulas por módulo: ${na}. Liberação: ${txt(no.dados.liberacao, 20) === "por_dia" ? "um módulo por vez, por dia" : "tudo de uma vez"}.`, `Entrega em: ${PLATAFORMAS[plataforma] || plataforma}.`, ...e.textos].join("\n\n"),
    esquema: ESQUEMA_DA_AREA_DE_MEMBROS,
    maxSaida: SAIDA_ESPERADA.area_membros,
    timeoutMs: 240_000,
    execucaoId,
  });
  const j = obj(r.json);
  const modulos = lerModulos(j.modulos, nm, na);
  if (!modulos.length) throw new ErroHttp(502, "membros_vazio", "O modelo não devolveu os módulos; rode de novo.");
  const pagina = obj(j.pagina_boas_vindas);
  const html = htmlDasBoasVindas({ titulo: txt(pagina.titulo, 200) || "Boas-vindas", texto: txt(pagina.texto, 3000), modulos, plataforma: PLATAFORMAS[plataforma] || "plataforma", cores: coresDaPagina(marcaDasEntradas(ctx, e)) });
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  const falta = plataforma === "pagina_simples" ? [] : [`conta do cliente na ${PLATAFORMAS[plataforma] || "plataforma de membros"} (a entrega é lá; o painel não hospeda curso)`];
  return {
    saida: {
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: textoFinal([`${modulos.length} módulo(s), ${modulos.reduce((s, m) => s + m.aulas.length, 0)} aula(s) com roteiro: ${modulos.map((m, i) => `${i + 1}. ${m.titulo}`).join(" · ")}.`, "E-mail e página de boas-vindas prontos (rascunho)."], falta),
      json: { plataforma, liberacao: txt(no.dados.liberacao, 20) || "tudo", modulos, email_boas_vindas: obj(j.email_boas_vindas), blocos_sem_fonte: j.blocos_sem_fonte },
      falta_conectar: falta,
    },
    custo: r.custoUsd,
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ Criação: UGC, influenciador e template

/** A ficha do personagem ligado (Influenciador digital), quando há. */
async function personagemLigado(kit: KitV4, ctx: Contexto, no: NoDoCanvas): Promise<{ ficha: string; imagens: ImagemSaida[] } | null> {
  const s = (await kit.saidasDasEntradas(ctx, no)).find((x) => x.no.tipo === "influenciador");
  if (!s || !s.saida) return null;
  const j = obj(s.saida.json);
  const imagens = imagensComPrincipal(s.no, arr(s.saida.imagens).map(obj), s.saida.escolha).filter((i) => typeof i.path === "string").map((i) => ({ path: String(i.path), url: typeof i.url === "string" ? i.url : null, bucket: "workspace" }));
  return { ficha: [txt(j.nome, 80), txt(j.aparencia_fixa, 2000)].filter(Boolean).join(": "), imagens };
}

async function noUgc(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const variacoes = limitar(no.dados.variacoes, 1, 5, 3);
  const duracao = limitar(no.dados.duracao, 8, 45, 20);
  const personagem = await personagemLigado(kit, ctx, no);
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_UGC,
    mensagem: [`Formato: ${txt(no.dados.estilo_ugc, 30) || "depoimento"}. Duração: ${duracao} s. Variações: ${variacoes} (gancho diferente em cada).`, personagem ? `PERSONAGEM (sempre a mesma pessoa): ${personagem.ficha}` : "Sem personagem ligado: pessoa fictícia.", txt(no.dados.instrucao) ? `Pedido extra: ${txt(no.dados.instrucao)}` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_UGC,
    maxSaida: SAIDA_ESPERADA.ugc,
    execucaoId,
  });
  const lista = arr(obj(r.json).variacoes).map(obj).slice(0, variacoes);
  if (!lista.length) throw new ErroHttp(502, "ugc_vazio", "O modelo não devolveu os roteiros; rode de novo.");
  const cfg = configDe(ctx.canvas, no);
  const proporcao: Proporcao = proporcaoValida(no.dados.proporcao) ?? (ligadoAntes(ctx, no, "config") ? cfg.proporcao : "9:16");
  const referencias = await kit.bytesDas([...(personagem ? personagem.imagens : []), ...e.imagens], 4);
  const rotulo = rotuloDoNo(no);
  const pedidos = lista.map((v) => {
    const primeira = obj(arr(v.cenas)[0]);
    return { rotulo, prompt: [`Quadro de vídeo UGC vertical gravado no celular, luz natural, sem texto na imagem.`, personagem ? `Pessoa: ${personagem.ficha}` : "", txt(primeira.prompt_quadro, 1500) || txt(v.gancho, 500), ctx.marca ? `Marca: ${ctx.marca.slice(0, 800)}` : ""].filter(Boolean).join("\n") };
  });
  const g = await kit.gerarImagens(ctx, execucaoId, pedidos, { modeloId: cfg.motor || txt(no.dados.motor, 200) || MODELO_IMAGEM_PADRAO, qualidade: cfg.qualidade, tamanho: TAMANHO_DA_PROPORCAO[proporcao], referencias });
  const imagens = g.arquivos.map((a, i) => (a ? kit.imagemDoArquivo(a, i + 1) : null)).filter((a): a is ImagemSaida => !!a);
  const roteiros = lista.map((v, i) => `Variação ${i + 1}: ${txt(v.gancho, 300)}\n${arr(v.cenas).map((c) => `${txt(String(obj(c).segundo ?? ""), 6)}s: ${txt(obj(c).fala, 400)} (${txt(obj(c).acao, 200)})`).join("\n")}`);
  const falta = ["o vídeo sai na Mesa Vídeos (Seedance, Veo ou Kling) com este roteiro e a voz do ElevenLabs; o Laboratório ainda não renderiza vídeo de UGC"];
  return {
    saida: {
      imagens,
      texto: textoFinal([`${lista.length} roteiro(s) de UGC de ${duracao} s com o quadro-chave de cada.`, ...roteiros], falta),
      json: { variacoes: lista, duracao, proporcao, personagem: personagem ? personagem.ficha : null, blocos_sem_fonte: obj(r.json).blocos_sem_fonte },
      falta_conectar: falta,
      avisos: g.avisos,
      usos: [r.usoId, ...g.usos].filter(Boolean) as string[],
    },
    custo: somar(r.custoUsd, g.custo),
    usoId: r.usoId,
  };
}

async function noInfluenciador(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const poses = limitar(no.dados.poses, 1, 8, 4);
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_INFLUENCIADOR,
    mensagem: [txt(no.dados.nome) ? `Nome: ${txt(no.dados.nome)}` : "", txt(no.dados.aparencia) ? `Aparência pedida: ${txt(no.dados.aparencia)}` : "", txt(no.dados.estilo) ? `Estilo e nicho: ${txt(no.dados.estilo)}` : "", `Poses: ${poses}.`, ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_INFLUENCIADOR,
    maxSaida: SAIDA_ESPERADA.influenciador,
    execucaoId,
  });
  const ficha = obj(r.json);
  const aparencia = txt(ficha.aparencia_fixa, 2500) || txt(no.dados.aparencia, 2000);
  if (!aparencia) throw new ErroHttp(502, "personagem_sem_aparencia", "O modelo não devolveu a aparência do personagem; rode de novo.");
  const listaDePoses = arr(ficha.poses).map((p) => txt(p, 300)).filter(Boolean);
  const cfg = configDe(ctx.canvas, no);
  const proporcao: Proporcao = ligadoAntes(ctx, no, "config") ? cfg.proporcao : "4:5";
  const gravity = gravityDe(ctx.canvas, no);
  const prompt = (i: number) => [
    "Foto realista de um personagem digital FICTÍCIO (não é pessoa real), mesma pessoa em todas as fotos.",
    `APARÊNCIA FIXA (igual em todas): ${aparencia}`,
    `POSE ${i + 1}: ${listaDePoses[i] || ["retrato de frente, meio corpo", "perfil três quartos", "corpo inteiro andando", "sentada sorrindo"][i % 4]}`,
    arr(ficha.roupas).length ? `Roupa: ${txt(arr(ficha.roupas)[i % arr(ficha.roupas).length], 200)}` : "",
    gravity && gravity.prompt_base ? `Base comum: ${gravity.prompt_base}` : "",
    "Sem texto na imagem.",
  ].filter(Boolean).join("\n");
  const base = await kit.bytesDas([...e.imagens, ...(gravity ? gravity.referencias : [])], 3);
  const modeloId = cfg.motor || txt(no.dados.motor, 200) || MODELO_IMAGEM_PADRAO;
  const tamanho = TAMANHO_DA_PROPORCAO[proporcao];
  // A 1ª foto vira a referência das outras: é o que segura o mesmo rosto.
  const primeira = await kit.gerarImagens(ctx, execucaoId, [{ rotulo: `${rotuloDoNo(no)} pose`, prompt: prompt(0) }], { modeloId, qualidade: cfg.qualidade, tamanho, referencias: base });
  const ref = primeira.arquivos[0] ? await kit.bytesDas([{ path: primeira.arquivos[0].path }], 1) : [];
  const resto = poses > 1
    ? await kit.gerarImagens(ctx, execucaoId, Array.from({ length: poses - 1 }, (_, i) => ({ rotulo: `${rotuloDoNo(no)} pose`, prompt: prompt(i + 1) })), { modeloId, qualidade: cfg.qualidade, tamanho, referencias: [...ref, ...base].slice(0, 4) })
    : { arquivos: [], custo: 0, usos: [], avisos: [], erros: [] };
  const arquivos = [...primeira.arquivos, ...resto.arquivos];
  const imagens = arquivos.map((a, i) => (a ? kit.imagemDoArquivo(a, i + 1) : null)).filter((a): a is ImagemSaida => !!a);
  return {
    saida: {
      imagens,
      texto: `${txt(ficha.nome, 80) || txt(no.dados.nome, 80) || "Personagem"} (${txt(ficha.idade_aparente, 30)}): ${txt(ficha.personalidade, 400)} Nicho: ${txt(ficha.nicho, 200)}. ${imagens.length} foto(s) de referência com o mesmo rosto. Personagem fictício: rosto ou voz de pessoa real só com autorização por escrito.`,
      json: { ...ficha, aparencia_fixa: aparencia, personagem: true },
      avisos: [...primeira.avisos, ...resto.avisos],
      usos: [r.usoId, ...primeira.usos, ...resto.usos].filter(Boolean) as string[],
    },
    custo: somar(r.custoUsd, primeira.custo, resto.custo),
    usoId: r.usoId,
  };
}

async function noTemplateDesigner(kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string): Promise<Resultado> {
  const formato = txt(no.dados.formato_arte, 20) || "feed_4_5";
  const entradas = await kit.saidasDasEntradas(ctx, no);
  const planilha = entradas.find((x) => x.no.tipo === "arquivo");
  const linhas = txt(no.dados.lote) === "planilha" && planilha && planilha.saida ? linhasDaPlanilha(txt(planilha.saida.texto, 60000).split("\n").filter((l) => !/^(Documentos|DOCUMENTO|Planilha|---)/i.test(l.trim())).join("\n")) : [];
  const r = await kit.texto(ctx, {
    modelo: no.dados.modelo_id,
    sistema: SISTEMA_DO_TEMPLATE,
    mensagem: [`Formato: ${formato} (proporção ${proporcaoDoFormato(formato)}).`, txt(no.dados.estilo) ? `Estilo: ${txt(no.dados.estilo)}` : "", `Campos que mudam: ${txt(no.dados.campos_variaveis, 500) || "titulo"}`, linhas.length ? `Colunas da planilha: ${Object.keys(linhas[0]).join(", ")} (use esses nomes como campo)` : "", ...e.textos].filter(Boolean).join("\n\n"),
    esquema: ESQUEMA_DO_TEMPLATE,
    maxSaida: SAIDA_ESPERADA.template_designer,
    execucaoId,
  });
  const j = obj(r.json);
  const camadas = lerCamadas(j.camadas);
  const cfg = configDe(ctx.canvas, no);
  const proporcao = proporcaoDoFormato(formato) as Proporcao;
  const g = await kit.gerarImagens(ctx, execucaoId, [{ rotulo: `${rotuloDoNo(no)} fundo`, prompt: [`Fundo de arte (${proporcao}) SEM nenhum texto, letra, número ou logo; deixe áreas limpas para os textos.`, txt(j.fundo_prompt, 2500), ctx.marca ? `Marca: ${ctx.marca.slice(0, 800)}` : ""].filter(Boolean).join("\n") }], { modeloId: cfg.motor || txt(no.dados.motor, 200) || MODELO_IMAGEM_PADRAO, qualidade: cfg.qualidade, tamanho: TAMANHO_DA_PROPORCAO[proporcao], referencias: await kit.bytesDas(e.imagens, 2) });
  const fundo = g.arquivos[0] ? kit.imagemDoArquivo(g.arquivos[0], 1) : null;
  // A logo vem da imagem ligada (Logo escolhida pelo Jev ou a logo da Marca), nunca redesenhada.
  const daLogo = entradas.find((x) => x.no.tipo === "logo" || x.no.tipo === "marca");
  // A logo principal escolhida na tela (dados.principal); sem ela, a escolha do Jev; sem nada, a primeira.
  const imgsDaLogo = daLogo && daLogo.saida ? imagensComPrincipal(daLogo.no, arr(daLogo.saida.imagens).map(obj), daLogo.saida.escolha) : [];
  const logo = imgsDaLogo.length ? txt(imgsDaLogo[0].url, 2000) || null : null;
  const html = htmlDoTemplate({ formato, fundo: fundo ? fundo.url : null, logo, camadas, linhas, cores: coresDaPagina(marcaDasEntradas(ctx, e)) });
  const arquivo = await kit.salvarHtml(ctx, execucaoId, rotuloDoNo(no), html);
  const avisos = [...g.avisos];
  if (txt(no.dados.lote) === "planilha" && !linhas.length) avisos.push("Lote pedido, mas nenhuma planilha veio: ligue um nó Documento (uso: planilha) com cabeçalho na 1ª linha.");
  if (camadas.some((c) => c.tipo === "logo") && !logo) avisos.push("A camada da logo ficou vazia: ligue a Logo ou a Marca com a logo.");
  return {
    saida: {
      imagens: fundo ? [fundo] : [],
      html_path: arquivo.path,
      html_url: arquivo.url,
      no_workspace_id: arquivo.no_id,
      texto: `Template ${formato} com ${camadas.length} camada(s) editável(is)${linhas.length ? ` e ${linhas.length} arte(s) da planilha` : ""}. Editar o texto na prévia não gasta.`,
      json: { formato, proporcao, camadas, linhas: linhas.length, fundo: fundo ? fundo.path : null, logo: !!logo, modelo: true, blocos_sem_fonte: j.blocos_sem_fonte },
      avisos,
      usos: [r.usoId, ...g.usos].filter(Boolean) as string[],
    },
    custo: somar(r.custoUsd, g.custo),
    usoId: r.usoId,
  };
}

// ------------------------------------------------------------------ o mapa

type Executor = (ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string) => Promise<Resultado>;

/** Os executores dos nós da v4, com o kit de executar.ts. */
export function executoresDaV4(kit: KitV4): Record<string, Executor> {
  const com = (fn: (kit: KitV4, ctx: Contexto, no: NoDoCanvas, e: Entradas, execucaoId: string) => Promise<Resultado>): Executor => (ctx, no, e, id) => fn(kit, ctx, no, e, id);
  return {
    referencias: com(noReferencias),
    pagina: com(noPagina),
    checkout: com(noCheckout),
    quiz: com(noQuiz),
    webinar: com(noWebinar),
    dominio: com(noDominio),
    teste_ab: com(noTesteAb),
    automacao: com(noAutomacao),
    email: com(noEmail),
    whatsapp: com(noWhatsapp),
    area_membros: com(noAreaMembros),
    ugc: com(noUgc),
    influenciador: com(noInfluenciador),
    template_designer: com(noTemplateDesigner),
    crm: com(noCrm),
    recuperacao: com(noRecuperacao),
    fontes_trafego: com(noFontesTrafego),
  };
}

/** Saída dos nós estáticos da v4 (marca, cliente, vídeo, documento e produto): sai dos dados, sem custo. */
export function saidaEstaticaDaV4(ctx: Pick<Contexto, "marca" | "nomeDoCliente" | "projeto">, no: NoDoCanvas, documentos: string): SaidaDoNo | null {
  const d = no.dados;
  if (no.tipo === "marca") {
    const digitado = [txt(d.paleta) ? `Paleta: ${txt(d.paleta)}` : "", txt(d.tom) ? `Tom de voz: ${txt(d.tom)}` : "", txt(d.fontes) ? `Fontes: ${txt(d.fontes)}` : "", txt(d.regras) ? `A marca nunca: ${txt(d.regras)}` : ""].filter(Boolean);
    const logo = arr(d.logo).map(obj).filter((i) => typeof i.path === "string" && i.path).map((i) => ({ path: String(i.path), url: typeof i.url === "string" ? i.url : null, bucket: typeof i.bucket === "string" ? i.bucket : "workspace" }));
    const texto = [`Marca${digitado.length ? " (definida no nó)" : ""}:`, ...digitado, ctx.marca && !digitado.length ? ctx.marca : ctx.marca ? `Do cliente do projeto: ${ctx.marca}` : ""].filter(Boolean).join("\n");
    return { texto, imagens: logo };
  }
  if (no.tipo === "cliente") {
    if (!ctx.projeto.client_id) return { texto: "Cliente: o projeto não tem cliente escolhido (Livre)." };
    return { texto: [`Cliente: ${ctx.nomeDoCliente || "do projeto"}`, txt(d.foco) ? `O que importa agora: ${txt(d.foco)}` : "", ctx.marca].filter(Boolean).join("\n") };
  }
  if (no.tipo === "video") {
    const nomes = arr(d.arquivos).map(obj).map((a) => txt(a.nome, 120)).filter(Boolean);
    return {
      texto: [`Vídeo de entrada${txt(d.link) ? `: ${txt(d.link, 500)}` : ""}`, nomes.length ? `Arquivos: ${nomes.join(", ")}` : "", txt(d.transcricao) ? `Transcrição: ${txt(d.transcricao, 20000)}` : "Sem transcrição colada no nó."].filter(Boolean).join("\n"),
      video_url: txt(d.link, 500),
    };
  }
  if (no.tipo === "arquivo") {
    if (!documentos) return { texto: "" };
    const uso = txt(d.uso, 30);
    const cabeca = uso === "depoimentos"
      ? "DEPOIMENTOS E NÚMEROS COM FONTE (documento anexado pelo dono; pode usar como prova citando o documento):"
      : uso === "dados_produto" ? "Dados do produto (documento do dono):" : uso === "planilha" ? "Planilha do lote:" : "Documento:";
    return { texto: `${cabeca}\n${documentos}` };
  }
  if (no.tipo === "produto") {
    const linhas = [txt(d.nome) ? `Produto: ${txt(d.nome)}` : "", txt(d.formato_produto) ? `Formato: ${txt(d.formato_produto)}` : "", txt(d.preco) ? `Preço: ${txt(d.preco)}` : "", txt(d.entregavel) ? `O que a pessoa recebe: ${txt(d.entregavel)}` : "", txt(d.link_externo) ? `Página ou checkout que já existe: ${txt(d.link_externo, 500)}` : ""].filter(Boolean);
    return { texto: linhas.join("\n"), json: { nome: txt(d.nome), formato: txt(d.formato_produto), preco: txt(d.preco), entregavel: txt(d.entregavel), link_externo: txt(d.link_externo, 500) } };
  }
  return null;
}

/** O que o nó Cliente com cliente próprio usa de fora (o teste troca por uma falsa). */
export type PortaDoNoCliente = {
  podeAcessar(clientId: string, token: string): Promise<boolean>;
  marca(clientId: string): Promise<string>;
  nome(clientId: string): Promise<string>;
};

const UUID_DO_NO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Saída do nó Cliente (20/10). Com `dados.client_id` (o cliente escolhido no próprio nó, diferente do do projeto),
 * confere can_access_client de quem roda: sem acesso, erro claro e nada é lido. Sem o campo, o do projeto.
 */
export async function saidaDoNoCliente(ctx: Pick<Contexto, "marca" | "nomeDoCliente" | "projeto" | "token">, no: NoDoCanvas, porta?: PortaDoNoCliente): Promise<SaidaDoNo | null> {
  const escolhido = typeof no.dados.client_id === "string" && UUID_DO_NO.test(no.dados.client_id) ? no.dados.client_id.toLowerCase() : null;
  if (!escolhido || escolhido === String(ctx.projeto.client_id || "").toLowerCase()) return saidaEstaticaDaV4(ctx, no, "");
  const p = porta || (await portaDoNoClienteReal());
  if (!(await p.podeAcessar(escolhido, ctx.token))) throw new ErroHttp(403, "sem_acesso_ao_cliente", "Você não tem acesso ao cliente escolhido no nó Cliente. Escolha outro ou peça o acesso.");
  const [marca, nome] = await Promise.all([p.marca(escolhido), p.nome(escolhido)]);
  return saidaEstaticaDaV4({ marca, nomeDoCliente: nome, projeto: { ...ctx.projeto, client_id: escolhido } }, no, "");
}

async function portaDoNoClienteReal(): Promise<PortaDoNoCliente> {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const { marcaEmTexto, nomeDoCliente } = await import("./comum.ts");
  return {
    async podeAcessar(clientId, token) {
      if (!token) return false;
      const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await doChamador.rpc("can_access_client", { _client_id: clientId });
      if (error) throw new ErroHttp(503, "autorizacao_indisponivel", "Não foi possível conferir o acesso ao cliente do nó Cliente agora.");
      return data === true;
    },
    marca: (id) => marcaEmTexto(id),
    nome: (id) => nomeDoCliente(id),
  };
}
