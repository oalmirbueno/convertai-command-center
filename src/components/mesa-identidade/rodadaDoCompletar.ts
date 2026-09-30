import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { preencherComIA } from "@/lib/mesa/preencherComIA";
import { carregarFontesGoogle } from "@/lib/identidade/fontesGoogle";
// Canvas, versões da logo e mockups (WebGL) só baixam quando o passo roda: a mesa abre leve.
const desenho = () => import("@/lib/identidade/desenharPeca");
const versoes = () => import("@/lib/identidade/versoesDaLogo");
const mockups = () => Promise.all([import("@/lib/mockups/api"), import("@/lib/mockups/catalogo"), import("@/lib/mockups/renderizar")]);
import type { LogoDoBrandbook } from "../../../supabase/functions/_shared/brandbook";
import { CAMPOS_DO_BRIEFING, valoresDoBriefing, type BriefingDaIdentidade } from "../../../supabase/functions/_shared/briefing-da-identidade";
import { juntarProposta, normalizarEstrategia, type Estrategia } from "../../../supabase/functions/_shared/estrategia-de-marca";
import { descricaoDoPadrao, svgDoPadrao, type TipoDePadrao } from "../../../supabase/functions/_shared/grafismos-da-marca";
import { layoutDaPeca, PECAS_DA_MARCA, svgDoLayout } from "../../../supabase/functions/_shared/aplicacoes-da-marca";
import { luminanciaRelativa, normalizarHex } from "../../../supabase/functions/_shared/cores-da-marca";
import { svgDoPadraoDoSimbolo, type LeituraPorVisao } from "../../../supabase/functions/_shared/leitura-da-logo";
import {
  camposDasFalasVazias,
  camposDoBriefing,
  camposDosContatos,
  camposDosTextos,
  fontesDoCompletar,
  juntarPerguntas,
  type ExecucaoDoCompletar,
  type OpcoesDoCompletar,
  paletaCompleta,
  type PassoId,
  tipografiaCompleta,
} from "../../../supabase/functions/_shared/completar-marca";
import { brandDaEstrategia, cenasDaApresentacao, entrevistaDaEstrategia, insumosDaIdentidade } from "../../../supabase/functions/_shared/motion-da-identidade";
import { chamarIdentidade, pastaDoProjeto, type ProjetoDeIdentidade } from "./identidadeApi";
import { enviarFeitoNaTela, enviarImagemDeApoio, pngDoSvg } from "./arquivosDaMarca";
import { contextoParaPreencher } from "./Comuns";

/**
 * "Completar tudo" da marca existente (frente IDV3), no navegador: cada
 * passo usa a ação que já existe na mesa (estrategia_propor, brandbook_montar,
 * logo_ler), o "Preencher com IA" (preencher-ia) ou as contas por código
 * (paleta, versões da logo, padrões, peças, mockups). Só preenche o que está
 * vazio; o que não tem base volta como pergunta; a logo nunca é redesenhada.
 *
 * A rodada guarda o projeto mais novo a cada gravação (trava de versão da
 * função) e o estado de cada passo em dados.completar.execucao, com o que o
 * Desfazer precisa. Parar vale entre um passo e outro.
 */

export type ModelosDaRodada = { texto?: string | null; visao?: string | null; motion?: string | null };

export type ContextoDaRodada = {
  clientId: string;
  marcaId: string | null;
  nomeDaMarca: string;
  modelos: ModelosDaRodada;
  opcoes: OpcoesDoCompletar;
  /** Kit da marca aberta (paleta e tipografia reais, regra de herança). */
  kit: { paleta?: Array<{ nome?: unknown; papel?: unknown; hex?: unknown }> | null; tipografia?: { titulo?: string | null; texto?: string | null } | null } | null;
  /** Guarda o projeto novo no cache da tela. */
  guardar: (p: ProjetoDeIdentidade) => void;
};

export type ResultadoDoPasso = { resumo: string; custo: number; antes: Record<string, unknown> | null; perguntas: string[]; pulado?: boolean };

/**
 * O que o Desfazer de um passo precisa: cada parte do projeto como estava
 * (inteira = volta a parte toda; parcial = volta só as chaves guardadas) e os
 * filmes criados (arquivados no Desfazer).
 */
type ParteDeAntes = { parte: string; valor: unknown; inteira: boolean };
const inteira = (parte: string, valor: unknown): ParteDeAntes => ({ parte, valor: valor == null ? {} : valor, inteira: true });
const parcial = (parte: string, valor: Record<string, unknown>): ParteDeAntes => ({ parte, valor, inteira: false });
const comoAntes = (partes: ParteDeAntes[], extra: Record<string, unknown> = {}): Record<string, unknown> => ({ partes, ...extra });

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const temTexto = (v: unknown) => (Array.isArray(v) ? v.some((x) => String(x || "").trim()) : String(v == null ? "" : v).trim().length > 0);

const CAMPOS_DO_PROJETO = "id, client_id, marca_id, modo, com_naming, titulo, etapa, concluidas, dados, versao, estado, custo_usd, criado_em, atualizado_em";

/** O projeto de novo do banco (quando uma ação não devolve a linha nova). */
export async function relerProjeto(id: string): Promise<ProjetoDeIdentidade> {
  const { data, error } = await (supabase as any).from("idv_projetos").select(CAMPOS_DO_PROJETO).eq("id", id).maybeSingle();
  if (error || !data) throw error || new Error("Projeto não encontrado.");
  return { ...data, dados: data.dados || {}, versao: Number(data.versao) || 1, custo_usd: Number(data.custo_usd) || 0, concluidas: Array.isArray(data.concluidas) ? data.concluidas : ["inicio"] } as ProjetoDeIdentidade;
}

/**
 * A rodada: o projeto mais novo, gravação parcial com a versão lida e as
 * chamadas das ações da mesa. Uma instância por "Completar tudo".
 */
export class Rodada {
  projeto: ProjetoDeIdentidade;
  ctx: ContextoDaRodada;
  constructor(projeto: ProjetoDeIdentidade, ctx: ContextoDaRodada) {
    this.projeto = projeto;
    this.ctx = ctx;
  }

  aceitar(p: ProjetoDeIdentidade | null | undefined) {
    if (p && p.id === this.projeto.id) {
      this.projeto = p;
      this.ctx.guardar(p);
    }
  }

  async salvar(parte: string, valor: Record<string, unknown>, substituir = false): Promise<ProjetoDeIdentidade> {
    const tentar = () => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("projeto_salvar", { projeto_id: this.projeto.id, versao: this.projeto.versao, parte, valor, substituir });
    try {
      this.aceitar((await tentar()).projeto);
    } catch (e) {
      // Outra gravação passou na frente (a própria ação que somou custo): relê e tenta uma vez.
      if ((e as { codigo?: string }).codigo !== "versao_mudou") throw e;
      this.aceitar(await relerProjeto(this.projeto.id));
      this.aceitar((await tentar()).projeto);
    }
    return this.projeto;
  }

  get dados(): Record<string, any> {
    return this.projeto.dados || {};
  }

  get sistema(): Record<string, any> {
    return obj(this.dados.sistema);
  }

  get leitura(): LeituraPorVisao | null {
    const v = obj(obj(this.dados.leitura_da_logo).visao);
    return v.em ? (v as LeituraPorVisao) : null;
  }

  get logo(): LogoDoBrandbook | null {
    const l = obj(obj(this.sistema.logos).principal);
    return l.caminho ? (l as LogoDoBrandbook) : null;
  }

  async preencher(campos: Parameters<typeof preencherComIA>[0]["campos"], extra?: string) {
    return await preencherComIA({
      papel: "identidade",
      clientId: this.ctx.clientId,
      marcaId: this.projeto.marca_id,
      modeloId: this.ctx.modelos.texto || null,
      campos,
      fontes: fontesDoCompletar(this.ctx.opcoes.usarWeb),
      contexto: contextoParaPreencher(this.projeto, extra),
      substituir: false,
    });
  }
}

// ------------------------------------------------------------------ os passos

async function passoLeitura(r: Rodada): Promise<ResultadoDoPasso> {
  const logo = r.logo;
  if (!logo) throw new Error("Falta a logo principal.");
  const antes = comoAntes([inteira("leitura_da_logo", r.dados.leitura_da_logo)]);
  const { lerLogoPorCodigo } = await versoes();
  const lida = await lerLogoPorCodigo(logo);
  const a = lida.analise;
  await r.salvar("leitura_da_logo", { cores: a.cores, analise: { fundo: a.fundo, cor_do_fundo: a.cor_do_fundo, orientacao: a.orientacao, caixa: a.caixa, monocromatica: a.monocromatica, simbolo: a.simbolo, largura: a.largura, altura: a.altura, mime: lida.mime } });
  // Visão já feita (o agente lê na função) e sem "refazer": fica a leitura de antes, sem custo.
  const jaLida = r.leitura;
  let custo = 0;
  let v: LeituraPorVisao;
  if (jaLida && !r.ctx.opcoes.refazer) v = jaLida;
  else {
    const resp = await chamarIdentidade<{ projeto: ProjetoDeIdentidade; leitura: LeituraPorVisao; custo_usd: number }>("logo_ler", { projeto_id: r.projeto.id, modelo_id: r.ctx.modelos.visao || undefined });
    r.aceitar(resp.projeto);
    v = resp.leitura;
    custo = Number(resp.custo_usd) || 0;
  }
  const fonte = v.fonte.parecidas.length ? `fonte parecida: ${v.fonte.parecidas.map((x) => x.familia).join(", ")}` : v.fonte.tem_texto ? "fonte sem equivalente no catálogo" : "logo sem texto";
  return { resumo: `${a.cores.length} cores por código; ${v.estilo || v.forma || "forma lida"}; ${fonte}`.slice(0, 300), custo, antes, perguntas: [] };
}

async function passoVersoes(r: Rodada): Promise<ResultadoDoPasso> {
  const logo = r.logo;
  if (!logo) throw new Error("Falta a logo principal.");
  const logos = obj(r.sistema.logos);
  const antes = comoAntes([parcial("sistema", { logos }), parcial("leitura_da_logo", { versoes: obj(r.dados.leitura_da_logo).versoes ?? null })]);
  const { gerarVersoesDaLogo } = await versoes();
  const v = await gerarVersoesDaLogo(pastaDoProjeto(r.ctx.clientId, r.projeto.id), logo);
  // Só acrescenta: as versões que a equipe já enviou ficam (e uma versão com o mesmo rótulo não se repete).
  const rotulos = (l: LogoDoBrandbook[]) => l.map((x) => x.rotulo);
  const alternativasAntes = arr(logos.alternativas) as LogoDoBrandbook[];
  const iconesAntes = arr(logos.icone) as LogoDoBrandbook[];
  const alternativas = alternativasAntes.concat(v.alternativas.filter((x) => rotulos(alternativasAntes).indexOf(x.rotulo) < 0)).slice(0, 4);
  const icone = iconesAntes.concat(v.icone.filter((x) => rotulos(iconesAntes).indexOf(x.rotulo) < 0)).slice(0, 3);
  await r.salvar("sistema", { logos: { ...logos, alternativas, icone } });
  await r.salvar("leitura_da_logo", { versoes: { geradas: v.geradas, designer: v.designer, simbolo: v.simbolo ? { caminho: v.simbolo.caminho, proporcao: v.simbolo.proporcao } : null } });
  return { resumo: `${v.geradas.length} versões por código; ${v.designer.length} para o designer`, custo: 0, antes, perguntas: v.designer.filter((d) => d.versao === "vertical" || d.versao === "horizontal").map((d) => `Existe a logo ${d.versao} feita pelo designer? ${d.motivo}`) };
}

async function passoBriefing(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([inteira("briefing", r.dados.briefing)]);
  const montado = await chamarIdentidade<{ briefing: BriefingDaIdentidade }>("briefing_montar", { projeto_id: r.projeto.id });
  const atual = obj(r.dados.briefing);
  const vindos = valoresDoBriefing(montado.briefing);
  const novos: Record<string, unknown> = {};
  for (const k of Object.keys(vindos)) if (!temTexto(atual[k])) novos[k] = vindos[k];
  if (montado.briefing.origem.briefing_id && !atual.briefing_id) novos.briefing_id = montado.briefing.origem.briefing_id;
  if (Object.keys(novos).length) await r.salvar("briefing", novos);
  let custo = 0;
  const campos = camposDoBriefing(r.dados);
  let preenchidos = 0;
  if (campos.length) {
    const ia = await r.preencher(campos);
    custo += Number(ia.custo_usd) || 0;
    const vals: Record<string, unknown> = {};
    for (const c of campos) if (temTexto(ia.valores[c.chave])) vals[c.chave] = ia.valores[c.chave];
    preenchidos = Object.keys(vals).length;
    if (preenchidos) await r.salvar("briefing", vals);
  }
  const vazios = camposDoBriefing(r.dados).map((c) => c.chave);
  const perguntas = CAMPOS_DO_BRIEFING.filter((c) => c.essencial && vazios.indexOf(c.campo) >= 0).map((c) => c.pergunta);
  return { resumo: `${Object.keys(novos).length} do painel, ${preenchidos} pela IA; ${vazios.length} em aberto`, custo, antes, perguntas };
}

async function passoEstrategia(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([inteira("estrategia", r.dados.estrategia)]);
  const resp = await chamarIdentidade<{ proposta: Estrategia; avisos: string[]; custo_usd: number; projeto: ProjetoDeIdentidade | null }>("estrategia_propor", { projeto_id: r.projeto.id, modelo_id: r.ctx.modelos.texto || undefined, usar_web: r.ctx.opcoes.usarWeb === true });
  if (resp.projeto) r.aceitar(resp.projeto);
  else r.aceitar(await relerProjeto(r.projeto.id));
  const junta = juntarProposta(normalizarEstrategia(r.dados.estrategia), resp.proposta, { substituir: false });
  const nova = { ...junta.estrategia, atualizado_em: new Date().toISOString() };
  await r.salvar("estrategia", nova as unknown as Record<string, unknown>, true);
  return { resumo: `${junta.mudaram.length} campos preenchidos (só os vazios)`, custo: Number(resp.custo_usd) || 0, antes, perguntas: arr(resp.avisos).map(String).slice(0, 4) };
}

async function passoPaleta(r: Rodada): Promise<ResultadoDoPasso> {
  const coresAntes = arr(r.sistema.cores);
  const antes = comoAntes([parcial("sistema", { cores: coresAntes })]);
  const leitura = obj(r.dados.leitura_da_logo);
  // As cores que a equipe já pôs vêm primeiro (valem como as do kit), depois o kit e os pixels da logo.
  const p = paletaCompleta({ doKit: coresAntes.concat(arr(r.ctx.kit && r.ctx.kit.paleta)), daLogo: arr(leitura.cores) });
  if (!p.cores.length) return { resumo: "Sem cor com base", custo: 0, antes, perguntas: p.perguntas, pulado: true };
  await r.salvar("sistema", { cores: p.cores });
  return { resumo: `${p.cores.length} cores (${p.fontes.join(" e ") || "logo"})${p.avisos.length ? `; ${p.avisos.length} avisos de contraste` : "; contraste ok"}`, custo: 0, antes, perguntas: p.perguntas };
}

async function passoTipografia(r: Rodada): Promise<ResultadoDoPasso> {
  const tiposAntes = arr(r.sistema.tipografia);
  const antes = comoAntes([parcial("sistema", { tipografia: tiposAntes })]);
  const doKit = r.ctx.kit && r.ctx.kit.tipografia ? r.ctx.kit.tipografia : null;
  const jaTitulo = tiposAntes.filter((t: any) => t.uso === "titulo" && t.familia)[0];
  const jaTexto = tiposAntes.filter((t: any) => t.uso === "texto" && t.familia)[0];
  const t = tipografiaCompleta({ doKit: { titulo: (jaTitulo && jaTitulo.familia) || (doKit && doKit.titulo) || null, texto: (jaTexto && jaTexto.familia) || (doKit && doKit.texto) || null }, leitura: r.leitura, estrategia: r.dados.estrategia });
  if (!t.tipografia.length) return { resumo: "Sem base para a tipografia", custo: 0, antes, perguntas: t.perguntas, pulado: true };
  const novos = t.tipografia.filter((x) => !tiposAntes.some((a: any) => a.uso === x.uso && a.familia));
  const lista = tiposAntes.concat(novos).slice(0, 4);
  await r.salvar("sistema", { tipografia: lista });
  return { resumo: `${t.tipografia.map((x) => x.familia).filter((x, i, l) => l.indexOf(x) === i).join(" + ")}${t.avisos.length ? `; ${t.avisos[0]}` : ""}`.slice(0, 300), custo: 0, antes, perguntas: t.perguntas };
}

function coresDoSistema(r: Rodada): { primaria: string; apoio: string; clara: string; escura: string } {
  const cores = arr(r.sistema.cores).map(obj).filter((c) => normalizarHex(c.hex));
  const hex = (c: any) => normalizarHex(c && c.hex) as string;
  const primaria = cores.filter((c) => c.papel === "primaria")[0] || cores[0];
  const apoio = cores.filter((c) => c.papel === "secundaria" || c.papel === "destaque")[0] || primaria;
  const clara = cores.filter((c) => luminanciaRelativa(hex(c)) > 0.8)[0];
  const escura = cores.filter((c) => luminanciaRelativa(hex(c)) < 0.05)[0];
  return { primaria: primaria ? hex(primaria) : "#151B17", apoio: apoio ? hex(apoio) : "#157330", clara: clara ? hex(clara) : "#F4F6F4", escura: escura ? hex(escura) : "#151B17" };
}

async function passoGrafismos(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([parcial("sistema", { grafismos: arr(r.sistema.grafismos) })]);
  const c = coresDoSistema(r);
  const leitura = r.leitura;
  const titulo = (arr(r.sistema.tipografia).filter((t: any) => t.uso === "titulo")[0] || { familia: "Helvetica" }).familia;
  const tipos: TipoDePadrao[] = (leitura && leitura.formas_para_grafismo.length ? leitura.formas_para_grafismo : (["pontos", "grade"] as TipoDePadrao[])).slice(0, 2);
  const novos: Array<{ tipo: "pattern"; descricao: string; imagem: string; svg: string | null }> = [];
  for (let i = 0; i < tipos.length; i++) {
    const o = { tipo: tipos[i], fundo: i === 0 ? c.clara : c.primaria, forma: i === 0 ? c.primaria : c.clara, apoio: c.apoio, escala: 56, peso: 0.4, giro: 0, letra: (r.ctx.nomeDaMarca || "A").charAt(0).toUpperCase(), familia: titulo };
    const svg = svgDoPadrao({ ...o, largura: 1600, altura: 1200 });
    const png = await pngDoSvg(svg, 1600, 1200);
    const f = await enviarFeitoNaTela(r.ctx.clientId, r.projeto.id, "grafismos", `padrao-${tipos[i]}`, png, svg);
    novos.push({ tipo: "pattern", descricao: `${descricaoDoPadrao(o)}. Ecoa as formas da logo.`.slice(0, 300), imagem: f.png, svg: f.svg });
  }
  // O próprio símbolo repetido (recorte da logo, sem redesenho), quando ele se separa do nome.
  const simb = obj(obj(obj(r.dados.leitura_da_logo).versoes).simbolo);
  if (typeof simb.caminho === "string" && simb.caminho) {
    const { dataUrlDoBucket } = await desenho();
    const href = await dataUrlDoBucket(simb.caminho);
    if (href) {
      const svg = svgDoPadraoDoSimbolo({ href, proporcao: Number(simb.proporcao) || 1, fundo: c.clara, opacidade: 0.16, celula: 160 });
      const png = await pngDoSvg(svg, 1600, 1200);
      const f = await enviarFeitoNaTela(r.ctx.clientId, r.projeto.id, "grafismos", "padrao-simbolo", png, svg);
      novos.push({ tipo: "pattern", descricao: "Padrão com o símbolo da logo repetido em grade, em transparência sobre o fundo claro.", imagem: f.png, svg: f.svg });
    }
  }
  const lista = arr(r.sistema.grafismos).concat(novos).slice(-6);
  await r.salvar("sistema", { grafismos: lista });
  return { resumo: `${novos.length} padrões em SVG e PNG`, custo: 0, antes, perguntas: [] };
}

async function passoTextos(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([parcial("sistema", { significado_do_logo: r.sistema.significado_do_logo ?? "", fotografia: obj(r.sistema.fotografia) })]);
  const campos = camposDosTextos(r.dados, r.leitura);
  if (!campos.length) return { resumo: "Já estava preenchido", custo: 0, antes: null, perguntas: [], pulado: true };
  const leitura = r.leitura;
  const ia = await r.preencher(campos, leitura ? `Leitura da logo: ${[leitura.forma, leitura.estilo].filter(Boolean).join(" ")}` : undefined);
  const v = ia.valores;
  const valor: Record<string, unknown> = {};
  if (temTexto(v.significado_do_logo)) valor.significado_do_logo = String(v.significado_do_logo).slice(0, 1500);
  const foto = { ...obj(r.sistema.fotografia) };
  for (const k of ["coloracao", "evitar", "ia"]) if (temTexto(v[`fotografia.${k}`])) foto[k] = String(v[`fotografia.${k}`]).slice(0, 600);
  valor.fotografia = foto;
  await r.salvar("sistema", valor);
  const perguntas = temTexto(valor.significado_do_logo) || temTexto(r.sistema.significado_do_logo) ? [] : ["Qual é a história ou o significado da logo? O manual ficou sem o conceito."];
  return { resumo: `${Object.keys(v).filter((k) => temTexto(v[k])).length} de ${campos.length} campos`, custo: Number(ia.custo_usd) || 0, antes, perguntas };
}

/** Imagem do bucket mesa pronta para o canvas e com o data URL (o SVG da peça leva a imagem dentro). */
async function imagemComHref(caminho: string): Promise<HTMLImageElement | null> {
  try {
    const [{ carregarImagem }] = await mockups();
    const { dataUrlDoBucket } = await desenho();
    const img = await carregarImagem(caminho, "mesa");
    const href = await dataUrlDoBucket(caminho);
    if (href && href.length < 2_500_000) img.setAttribute("data-href", href);
    return img;
  } catch {
    return null;
  }
}

async function passoAplicacoes(r: Rodada): Promise<ResultadoDoPasso> {
  const aplic = obj(r.dados.aplicacoes);
  const antes = comoAntes([parcial("aplicacoes", { itens: arr(aplic.itens), assinatura: obj(aplic.assinatura) })]);
  let custo = 0;
  const perguntas: string[] = [];
  const contatos = camposDosContatos(r.dados);
  let assinatura = { ...obj(aplic.assinatura) };
  if (contatos.length) {
    const ia = await r.preencher(contatos);
    custo += Number(ia.custo_usd) || 0;
    for (const c of contatos) if (temTexto(ia.valores[c.chave])) assinatura[c.chave] = String(ia.valores[c.chave]).slice(0, 120);
    await r.salvar("aplicacoes", { assinatura });
    assinatura = obj(obj(r.dados.aplicacoes).assinatura);
  }
  if (!temTexto(assinatura.email) && !temTexto(assinatura.telefone)) perguntas.push("Qual é o contato da marca (telefone, e-mail, site) para o cartão, o timbrado e a assinatura de e-mail?");
  const d = r.dados;
  const cores = arr(r.sistema.cores) as Array<{ hex: string; papel: string }>;
  const tipos = arr(r.sistema.tipografia) as Array<{ familia: string; uso: string }>;
  const titulo = (tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || { familia: "" }).familia;
  const corpo = (tipos.filter((t) => t.uso === "texto")[0] || { familia: titulo }).familia;
  if (titulo) await carregarFontesGoogle([{ familia: titulo, pesos: [700] }, { familia: corpo || titulo, pesos: [400] }]);
  const logo = r.logo;
  const padrao = arr(r.sistema.grafismos).filter((g: any) => g.tipo === "pattern" && g.imagem)[0];
  const imagens = { logo: logo && logo.previa_png ? await imagemComHref(logo.previa_png) : null, padrao: padrao ? await imagemComHref(padrao.imagem) : null };
  const nome = String((d.naming && d.naming.nome) || r.ctx.nomeDaMarca || "Marca");
  const contato = [assinatura.telefone, assinatura.email, String(assinatura.site || "").replace(/^https?:\/\//i, ""), assinatura.instagram ? `@${String(assinatura.instagram).replace(/^@/, "")}` : ""].filter((x) => temTexto(x)).map(String);
  const dados = { nome, slogan: String((d.naming && d.naming.slogan) || ""), contato, pessoa: { nome: String(assinatura.pessoa || ""), cargo: String(assinatura.cargo || "") }, cores, tituloFamilia: titulo, textoFamilia: corpo, temLogo: !!imagens.logo, temPadrao: !!imagens.padrao };
  const itens = arr(obj(r.dados.aplicacoes).itens).slice();
  const { desenharLayout } = await desenho();
  const [, , { paraBlob }] = await mockups();
  let feitas = 0;
  for (const peca of PECAS_DA_MARCA) {
    if (itens.some((i: any) => i.tipo === peca.rotulo && i.imagem)) continue;
    const layout = layoutDaPeca(peca.valor, dados);
    const png = await paraBlob(desenharLayout(layout, imagens, 1), "image/png");
    const svg = svgDoLayout(layout, { logo: imagens.logo ? imagens.logo.getAttribute("data-href") : null, padrao: imagens.padrao ? imagens.padrao.getAttribute("data-href") : null });
    const f = await enviarFeitoNaTela(r.ctx.clientId, r.projeto.id, "aplicacoes", peca.valor, png, svg);
    itens.push({ tipo: peca.rotulo, descricao: `${peca.grupo === "redes" ? "Rede social" : "Papelaria"}: ${peca.rotulo}, montada com a logo real e as cores do sistema.`, imagem: f.png });
    feitas += 1;
  }
  await r.salvar("aplicacoes", { itens: itens.slice(-8) });
  return { resumo: `${feitas} peças novas${contatos.length ? `; contato: ${Object.keys(assinatura).filter((k) => temTexto(assinatura[k])).length} campos` : ""}`, custo, antes, perguntas };
}

async function passoMockups(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([inteira("mockups", { itens: arr(r.dados.mockups) })]);
  const logo = r.logo;
  if (!logo || !logo.previa_png) throw new Error("Falta a prévia da logo principal.");
  const [{ lerCatalogoDeMockups, sugerirMockups }, { candidatosDaSugestao }, { carregarLogos, paraBlob, renderizarMockup }] = await mockups();
  const cat = await lerCatalogoDeMockups();
  if (cat.semBanco || !cat.itens.length) return { resumo: "O catálogo de mockups está vazio", custo: 0, antes: null, perguntas: [], pulado: true };
  const candidatos = candidatosDaSugestao(cat.itens, [], 40);
  const faltam = Math.max(1, 3 - arr(r.dados.mockups).length);
  let escolhidos = candidatos.slice(0, faltam);
  let custo = 0;
  try {
    const s = await sugerirMockups({ clientId: r.ctx.clientId, marcaId: r.projeto.marca_id, candidatos, quantos: Math.min(8, candidatos.length) });
    custo += Number(s.custo_usd) || 0;
    const ids = s.sugestoes.slice().sort((a, b) => b.nota - a.nota).map((x) => x.mockup_id);
    const porJev = ids.map((id) => candidatos.filter((m) => m.id === id)[0]).filter(Boolean);
    if (porJev.length) escolhidos = porJev.slice(0, faltam);
  } catch {
    // Sem o Jev, os primeiros do catálogo na sequência (a equipe troca no estúdio).
  }
  const logos = await carregarLogos([{ id: "principal", path: logo.previa_png, fileId: null, tom: null }]);
  if (!logos.length) throw new Error("A logo não abriu para o mockup.");
  const c = coresDoSistema(r);
  const tipos = arr(r.sistema.tipografia) as Array<{ familia: string; uso: string }>;
  const titulo = (tipos.filter((t) => t.uso === "titulo")[0] || tipos[0] || { familia: "" }).familia;
  if (titulo) await carregarFontesGoogle([{ familia: titulo, pesos: [700] }]);
  const assinatura = String((r.dados.naming && (r.dados.naming.slogan || r.dados.naming.nome)) || "");
  const escolhas = { fundo: c.primaria, segunda: c.clara, escala: 0.6, assinatura: assinatura && titulo ? { texto: assinatura, familia: titulo } : null };
  const itens: Array<{ titulo: string; imagem: string }> = [];
  for (const m of escolhidos) {
    const feito = await renderizarMockup(m, "alta", logos, escolhas);
    const png = await paraBlob(feito.canvas, "image/png");
    const arquivo = new File([png], `${m.nome || "mockup"}.png`, { type: "image/png" });
    const caminho = await enviarImagemDeApoio(r.ctx.clientId, r.projeto.id, arquivo, "mockups");
    itens.push({ titulo: String(m.nome || "Mockup").slice(0, 120), imagem: caminho });
  }
  if (itens.length) await r.salvar("mockups", { itens });
  return { resumo: `${itens.length} mockups com a logo e as cores`, custo, antes, perguntas: [] };
}

async function passoGuideline(r: Rodada): Promise<ResultadoDoPasso> {
  // Sem Desfazer: a versão montada fica no histórico e a equipe escolhe outra no Guideline.
  const antes = null;
  if (r.ctx.opcoes.tema) await r.salvar("guideline", { tema: r.ctx.opcoes.tema });
  const resp = await chamarIdentidade<{ projeto: ProjetoDeIdentidade; brandbook: { versao: number }; lacunas: string[] }>("brandbook_montar", { projeto_id: r.projeto.id, modelo: r.ctx.opcoes.modeloDoBrandbook || "paginado" });
  r.aceitar(resp.projeto);
  const lacunas = arr(resp.lacunas).map(String);
  return { resumo: `Versão ${resp.brandbook ? resp.brandbook.versao : "nova"}${lacunas.length ? `; faltam ${lacunas.length}: ${lacunas.slice(0, 3).join(", ")}` : "; completo"}`.slice(0, 300), custo: 0, antes, perguntas: [] };
}

async function passoApresentacao(r: Rodada): Promise<ResultadoDoPasso> {
  const ap = obj(r.dados.apresentacao);
  const antes = comoAntes([inteira("apresentacao", ap)]);
  const campos = camposDasFalasVazias(r.dados, r.projeto.modo === "zero" || r.projeto.com_naming, r.projeto.modo === "completar");
  if (!campos.length) return { resumo: "Falas já prontas", custo: 0, antes: null, perguntas: [], pulado: true };
  const ia = await r.preencher(campos.slice(0, 30));
  const falas = { ...obj(ap.falas) };
  let n = 0;
  for (const c of campos) {
    const v = ia.valores[c.chave];
    if (temTexto(v)) {
      falas[c.chave.replace(/^falas\./, "")] = String(v).slice(0, 1500);
      n += 1;
    }
  }
  await r.salvar("apresentacao", { falas });
  return { resumo: `${n} de ${campos.length} falas`, custo: Number(ia.custo_usd) || 0, antes, perguntas: [] };
}

/**
 * Vídeo da marca: cria o filme na Mesa Motion com as ações que já existem
 * (filme_criar e filme_salvar), com a entrevista, o BRAND.md e as cenas
 * tirados do projeto, e registra no projeto. O filme cinematográfico, quando
 * pedido, sai com os 3 storyboards (IA, custo antes).
 */
export async function criarVideosDaMarca(r: Rodada, pedido: { apresentacao: boolean; filme: boolean }): Promise<{ filmes: Array<{ id: string; tipo: string }>; custo: number }> {
  const d = r.dados;
  const nome = String((d.naming && d.naming.nome) || r.ctx.nomeDaMarca || "Marca");
  const cores = arr(r.sistema.cores);
  const insumos = insumosDaIdentidade(d, { projetoId: r.projeto.id, clientId: r.ctx.clientId });
  const brand = brandDaEstrategia(d.estrategia, String((d.naming && d.naming.slogan) || ""));
  const filmes: Array<{ id: string; tipo: string }> = [];
  let custo = 0;
  const criar = async (tipo: "apresentacao" | "filme_marca") => {
    const rotulo = tipo === "apresentacao" ? `Apresentação da marca ${nome}` : `Filme da marca ${nome}`;
    const c = await chamarFuncao<{ filme: { id: string } }>("mesa-motion", { acao: "filme_criar", client_id: r.ctx.clientId, marca_id: r.projeto.marca_id, nome: rotulo.slice(0, 120), tipo, formatos: tipo === "apresentacao" ? ["9:16", "16:9"] : ["16:9", "9:16"] });
    const cenas = tipo === "apresentacao" ? cenasDaApresentacao(d, { nome, clientId: r.ctx.clientId }) : [];
    await chamarFuncao("mesa-motion", {
      acao: "filme_salvar",
      filme_id: c.filme.id,
      entrevista: entrevistaDaEstrategia(d.estrategia, cores, cenas.length, tipo),
      brand,
      insumos: { identidade: insumos, notas: `Criado pela Mesa Identidade a partir do projeto ${r.projeto.titulo}.` },
      ...(cenas.length ? { cenas, etapa: "stills" } : { etapa: "brand" }),
      ...(r.ctx.modelos.motion ? { modelo: r.ctx.modelos.motion } : {}),
    });
    if (tipo === "filme_marca") {
      const sb = await chamarFuncao<{ custo_usd: number }>("mesa-motion", { acao: "storyboards_gerar", filme_id: c.filme.id, modelo_id: r.ctx.modelos.motion || undefined });
      custo += Number(sb.custo_usd) || 0;
    }
    const reg = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("video_registrar", { projeto_id: r.projeto.id, filme_id: c.filme.id });
    r.aceitar(reg.projeto);
    filmes.push({ id: c.filme.id, tipo });
  };
  if (pedido.apresentacao) await criar("apresentacao");
  if (pedido.filme) await criar("filme_marca");
  return { filmes, custo };
}

async function passoVideo(r: Rodada): Promise<ResultadoDoPasso> {
  const antes = comoAntes([inteira("videos", { lista: arr(r.dados.videos) })]);
  const pedido = r.ctx.opcoes.video || { apresentacao: true, filme: false };
  const ja = arr(r.dados.videos).map(obj);
  const falta = { apresentacao: pedido.apresentacao && !ja.some((v) => v.tipo === "apresentacao"), filme: pedido.filme && !ja.some((v) => v.tipo === "filme_marca") };
  if (!falta.apresentacao && !falta.filme) return { resumo: "Vídeo já criado", custo: 0, antes: null, perguntas: [], pulado: true };
  const v = await criarVideosDaMarca(r, falta);
  return { resumo: `${v.filmes.length} ${v.filmes.length === 1 ? "filme criado" : "filmes criados"} na Mesa Motion`, custo: v.custo, antes: { ...antes, filmes: v.filmes.map((f) => f.id) }, perguntas: [] };
}

const PASSOS: Record<PassoId, (r: Rodada) => Promise<ResultadoDoPasso>> = {
  leitura: passoLeitura,
  versoes: passoVersoes,
  briefing: passoBriefing,
  estrategia: passoEstrategia,
  paleta: passoPaleta,
  tipografia: passoTipografia,
  grafismos: passoGrafismos,
  textos: passoTextos,
  aplicacoes: passoAplicacoes,
  mockups: passoMockups,
  guideline: passoGuideline,
  apresentacao: passoApresentacao,
  video: passoVideo,
};

/**
 * Roda a execução passo a passo: grava o estado depois de cada um (a tela
 * mostra o andamento), guarda as perguntas e para quando `parar()` diz sim.
 * Erro num passo não derruba os outros: fica "falhou" com a frase.
 */
export async function rodarExecucao(r: Rodada, execucao: ExecucaoDoCompletar, e: { parar: () => boolean; aoMudar: (x: ExecucaoDoCompletar) => void; textoDoErro: (err: unknown) => string }): Promise<ExecucaoDoCompletar> {
  let atual: ExecucaoDoCompletar = { ...execucao, parada_em: null, passos: execucao.passos.map((p) => ({ ...p, estado: p.estado === "parado" ? "pendente" : p.estado })) };
  const gravar = async (x: ExecucaoDoCompletar, perguntas?: Array<{ texto: string; passo: PassoId }>) => {
    atual = x;
    e.aoMudar(x);
    const valor: Record<string, unknown> = { execucao: x };
    if (perguntas && perguntas.length) valor.perguntas = juntarPerguntas(obj(r.dados.completar).perguntas, perguntas);
    await r.salvar("completar", valor).catch(() => undefined);
  };
  for (let i = 0; i < atual.passos.length; i++) {
    const passo = atual.passos[i];
    if (passo.estado !== "pendente") continue;
    if (e.parar()) {
      await gravar({ ...atual, parada_em: new Date().toISOString(), passos: atual.passos.map((p) => (p.estado === "pendente" ? { ...p, estado: "parado" } : p)) });
      return atual;
    }
    const rodando = atual.passos.map((p, k) => (k === i ? { ...p, estado: "rodando" as const } : p));
    atual = { ...atual, passos: rodando };
    e.aoMudar(atual);
    try {
      const res = await PASSOS[passo.id](r);
      const feito = { ...passo, estado: res.pulado ? ("pulado" as const) : ("feito" as const), resumo: res.resumo.slice(0, 400), custo_usd: res.custo, em: new Date().toISOString(), antes: res.antes };
      const passos = atual.passos.map((p, k) => (k === i ? feito : p));
      await gravar({ ...atual, passos, custo_usd: Math.round((atual.custo_usd + res.custo) * 1e6) / 1e6 }, res.perguntas.map((t) => ({ texto: t, passo: passo.id })));
    } catch (err) {
      const passos = atual.passos.map((p, k) => (k === i ? { ...passo, estado: "falhou" as const, resumo: e.textoDoErro(err).slice(0, 400), em: new Date().toISOString() } : p));
      await gravar({ ...atual, passos });
    }
  }
  await gravar({ ...atual, terminada_em: new Date().toISOString() });
  await chamarIdentidade("completar_registrar", { projeto_id: r.projeto.id }).catch(() => undefined);
  return atual;
}

/**
 * Desfazer um passo feito: as partes do projeto voltam como estavam antes
 * (o arquivo gerado continua guardado, fora do manual). Vídeo: o filme é
 * arquivado na Mesa Motion (apagar = arquivar).
 */
export async function desfazerPasso(r: Rodada, passo: { id: PassoId; antes?: Record<string, unknown> | null }): Promise<void> {
  const antes = passo.antes || {};
  for (const a of arr(antes.partes) as ParteDeAntes[]) {
    if (!a || typeof a.parte !== "string") continue;
    await r.salvar(a.parte, obj(a.valor), a.inteira);
  }
  for (const id of arr(antes.filmes)) {
    await chamarFuncao("mesa-motion", { acao: "filme_arquivar", filme_id: id, arquivar: true }).catch(() => undefined);
  }
}
