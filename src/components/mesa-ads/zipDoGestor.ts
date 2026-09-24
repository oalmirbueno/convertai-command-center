import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import {
  alertaDoJev,
  CAMPOS_DO_GESTOR,
  chavesAds,
  DESTINOS,
  ESTAGIOS,
  formatoDe,
  humanizar,
  lerBriefing,
  lerCriativos,
  lerOfertas,
  lerPlanos,
  lerTrabalhos,
  nomeDeArquivo,
  normalizarPacote,
  notasDe10,
  pontuacaoDe10,
  qualidadeDoPlano,
  rotuloDoCta,
  rotuloDoEstilo,
  rotuloDoObjetivo,
  TIPOS_DE_PROVA,
  type Angulo,
  type BriefingAds,
  type CriativoAds,
  type Oferta,
  type OrientacaoAoGestor,
  type PacoteDeCopy,
  type PlanoAds,
} from "./adsApi";

/**
 * Pacote completo do gestor de tráfego em .zip, montado no navegador (sem IA,
 * custo zero): LEIA-ME.md (subir no Gerenciador passo a passo),
 * estrategia.md (briefing, oferta, plano, porquês e notas do Jev),
 * copies.md e copies.csv (Excel: ponto e vírgula e BOM) e a pasta criativos/
 * com a arte final de cada criativo, com os nomes casados com o CSV.
 *
 * A arte vem da entrega em Arquivos quando já entregue (bucket files, já no
 * tamanho do formato); senão, da versão mais recente de cada lâmina no
 * Estúdio (bucket mesa). As imagens descem por URL assinada.
 *
 * Tudo que é texto passa por semTravessao: nada de travessão em arquivo que o
 * gestor ou o cliente lê.
 */

// ------------------------------------------------------------------ tipos

/** O que o Estúdio guarda de um trabalho e o zip precisa (inclui a entrega de anúncio). */
export type TrabalhoDoZip = Pick<Trabalho, "id" | "status" | "cards"> & {
  direcao?: (Trabalho["direcao"] & { entrega_ads?: { arquivos?: { ordem: number; versao?: number; storage_path: string | null; formato?: string }[] } | null }) | null;
};

export interface DadosDoZip {
  cliente: string;
  geradoEm: string;
  briefing: BriefingAds | null;
  ofertas: Oferta[];
  /** Todos os planos do cliente (para achar ângulo e plano de cada criativo). */
  planos: PlanoAds[];
  /** Os criativos do pacote (um só ou o plano inteiro). */
  criativos: CriativoAds[];
  trabalhos: TrabalhoDoZip[];
}

export interface ImagemDoZip {
  bucket: string;
  caminho: string;
  /** Caminho dentro do zip: criativos/<nome>.<ext>. */
  arquivo: string;
  ordem: number;
}

export interface ItemDoZip {
  numero: number;
  criativo: CriativoAds;
  /** Nome do anúncio no Gerenciador (e base dos arquivos). */
  nomeDoAnuncio: string;
  nome: string;
  formato: string;
  plano: PlanoAds | null;
  angulo: Angulo | null;
  pacote: PacoteDeCopy | null;
  fonteDaArte: "entregue" | "estudio" | "sem_arte";
  imagens: ImagemDoZip[];
  textoPrincipal: string;
  textoLongo: string;
  titulos: string[];
  descricoes: string[];
  ctas: string[];
  ganchos: string[];
  destino: string;
  utm: string;
}

export interface ProgressoDoZip {
  etapa: "lendo" | "imagens" | "compactando" | "pronto";
  feitas: number;
  total: number;
}

// ------------------------------------------------------------------ texto

// Montado por código de caractere: o arquivo não carrega o travessão nem para achá-lo.
const TRAVESSOES = "[" + String.fromCharCode(0x2013, 0x2014) + "]";
const TRAVESSAO_ENTRE_ESPACOS = new RegExp("\\s+" + TRAVESSOES + "\\s+", "g");
const TRAVESSAO_SOLTO = new RegExp(TRAVESSOES, "g");

/**
 * Tira o travessão longo e o meio travessão de qualquer texto: entre espaços
 * vira vírgula; colado (intervalo de números) vira hífen.
 */
export function semTravessao(t: string): string {
  return String(t || "")
    .replace(TRAVESSAO_ENTRE_ESPACOS, ", ")
    .replace(TRAVESSAO_SOLTO, "-");
}

const limpo = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && isFinite(v) ? String(v) : "");
const unicos = (lista: string[]): string[] => {
  const vistos: Record<string, true> = {};
  const saida: string[] = [];
  lista.forEach((x) => {
    const t = limpo(x);
    const chave = t.toLowerCase();
    if (t && !vistos[chave]) {
      vistos[chave] = true;
      saida.push(t);
    }
  });
  return saida;
};
const doisDigitos = (n: number) => (n < 10 ? `0${n}` : String(n));
const brl = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const numero = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/\s/g, "").replace(/\./g, "").replace(",", "."));
  return isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const rotuloDe = (lista: { valor: string; rotulo: string }[], v: string) => {
  const achado = lista.filter((x) => x.valor === v)[0];
  return achado ? achado.rotulo : humanizar(v);
};

function extensaoDe(caminho: string): string {
  const m = /\.([a-z0-9]{2,5})$/i.exec(caminho.split("?")[0]);
  const e = m ? m[1].toLowerCase() : "png";
  return e === "jpeg" ? "jpg" : ["png", "jpg", "webp", "gif"].indexOf(e) >= 0 ? e : "png";
}

// ------------------------------------------------------------------ montagem

/** Arte final de um trabalho: entregue vale mais; senão a versão mais recente de cada lâmina. */
export function imagensDoTrabalho(t: TrabalhoDoZip | null | undefined): { fonte: ItemDoZip["fonteDaArte"]; refs: { bucket: string; caminho: string; ordem: number }[] } {
  if (!t) return { fonte: "sem_arte", refs: [] };
  const direcao = obj(t.direcao);
  const entregues = (Array.isArray(obj(direcao.entrega_ads).arquivos) ? obj(direcao.entrega_ads).arquivos : [])
    .filter((a: any) => a && typeof a.storage_path === "string" && a.storage_path)
    .map((a: any) => ({ bucket: "files", caminho: String(a.storage_path), ordem: Number(a.ordem) || 1 }))
    .sort((a: { ordem: number }, b: { ordem: number }) => a.ordem - b.ordem);
  if (entregues.length) return { fonte: "entregue", refs: entregues };

  const ultimas: Record<number, { versao: number; caminho: string }> = {};
  (Array.isArray(t.cards) ? t.cards : []).forEach((c) => {
    if (!c || typeof c.storage_path !== "string" || !c.storage_path) return;
    const atual = ultimas[c.ordem];
    if (!atual || Number(c.versao) > atual.versao) ultimas[c.ordem] = { versao: Number(c.versao) || 0, caminho: c.storage_path };
  });
  const daDirecao = (Array.isArray(direcao.cards) ? direcao.cards : []).map((c: any) => Number(c && c.ordem)).filter((n: number) => isFinite(n));
  const ordens = (daDirecao.length ? daDirecao : Object.keys(ultimas).map(Number))
    .filter((o: number, i: number, todas: number[]) => todas.indexOf(o) === i && !!ultimas[o])
    .sort((a: number, b: number) => a - b);
  const refs = ordens.map((o: number) => ({ bucket: "mesa", caminho: ultimas[o].caminho, ordem: o }));
  return { fonte: refs.length ? "estudio" : "sem_arte", refs };
}

/** Oferta do pacote: a do plano; sem ela, a escolhida; sem nenhuma, nada. */
export function ofertaDoPacote(dados: DadosDoZip, planos: PlanoAds[]): Oferta | null {
  for (const p of planos) {
    const id = qualidadeDoPlano(p).oferta_id;
    const achada = id ? dados.ofertas.filter((o) => o.id === id)[0] : null;
    if (achada) return achada;
  }
  return dados.ofertas.filter((o) => o.status === "escolhida")[0] || null;
}

/** Planos que aparecem no pacote, na ordem dos criativos. */
export function planosDoPacote(dados: DadosDoZip): PlanoAds[] {
  const ids: string[] = [];
  dados.criativos.forEach((c) => {
    if (c.plano_id && ids.indexOf(c.plano_id) < 0) ids.push(c.plano_id);
  });
  return ids.map((id) => dados.planos.filter((p) => p.id === id)[0]).filter((p): p is PlanoAds => !!p);
}

function destinoEmTexto(b: BriefingAds | null): string {
  if (!b) return "";
  const tipo = b.destino.tipo ? rotuloDe(DESTINOS, b.destino.tipo) : "";
  return [tipo, limpo(b.destino.url)].filter(Boolean).join(": ");
}

/** UTM padrão da casa (conhecimento de ads): utm_content é o nome do anúncio, casado com o arquivo. */
export function utmPadrao(nomeDoAnuncio: string): string {
  return `utm_source=meta&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content=${nomeDoAnuncio}`;
}

function utmDoItem(b: BriefingAds | null, gestor: OrientacaoAoGestor | null, nomeDoAnuncio: string): string {
  const tipo = b ? b.destino.tipo : "";
  if (tipo === "whatsapp" || tipo === "direct" || tipo === "ligacao") {
    return `Não se aplica ao destino ${rotuloDe(DESTINOS, tipo)}: acompanhe pelo nome do anúncio (${nomeDoAnuncio}).`;
  }
  const doPacote = gestor ? limpo(gestor.utm) : "";
  if (doPacote && /utm_/i.test(doPacote) && doPacote.indexOf("\n") < 0) return doPacote.replace(/\{\{\s*ad\.name\s*\}\}/g, nomeDoAnuncio);
  return utmPadrao(nomeDoAnuncio);
}

/** Um item por criativo, com os nomes de arquivo que o CSV e a pasta criativos/ usam. */
export function montarItens(dados: DadosDoZip): ItemDoZip[] {
  const trabalhos: Record<string, TrabalhoDoZip> = {};
  dados.trabalhos.forEach((t) => {
    if (t && t.id) trabalhos[t.id] = t;
  });
  const usados: Record<string, true> = {};
  return dados.criativos.map((c, i) => {
    const plano = c.plano_id ? dados.planos.filter((p) => p.id === c.plano_id)[0] || null : null;
    const angulo = plano && c.angulo_id ? plano.angulos.filter((a) => a.id === c.angulo_id)[0] || null : null;
    const f = formatoDe(c.formato);
    const nome = limpo(c.nome) || (angulo ? limpo(angulo.nome) : "") || `Criativo ${i + 1}`;
    const curto = c.formato === "carrossel" ? "carrossel" : f.curto.replace(":", "x");
    let base = `${doisDigitos(i + 1)}-${nomeDeArquivo(nome)}-${curto}`;
    while (usados[base]) base += "-b";
    usados[base] = true;

    const { fonte, refs } = imagensDoTrabalho(c.trabalho_id ? trabalhos[c.trabalho_id] : null);
    const imagens: ImagemDoZip[] = refs.map((r, j) => ({
      bucket: r.bucket,
      caminho: r.caminho,
      ordem: r.ordem,
      arquivo: `criativos/${base}${refs.length > 1 ? `-${j + 1}de${refs.length}` : ""}.${extensaoDe(r.caminho)}`,
    }));

    const pacote = normalizarPacote(c.copy && c.copy.pacote);
    const textos = pacote ? pacote.textos_principais : [];
    const doEstilo = (e: string) => textos.filter((t) => t.estilo === e).map((t) => t.texto)[0] || "";
    const maisLongo = textos.slice().sort((a, b) => b.texto.length - a.texto.length).map((t) => t.texto)[0] || "";
    const textoPrincipal = limpo(c.copy && c.copy.texto_principal) || doEstilo("curto") || doEstilo("medio") || (textos[0] ? textos[0].texto : "");
    const textoLongo = limpo(c.copy && c.copy.texto_principal_longo) || doEstilo("longo") || (maisLongo !== textoPrincipal ? maisLongo : "");
    const ctas = unicos(
      [c.copy && c.copy.cta_meta ? c.copy.cta_meta : ""].concat(pacote ? pacote.ctas.map((x) => x.cta) : []),
    ).map((v) => (rotuloDoCta(v) !== v ? `${rotuloDoCta(v)} (${v})` : v));
    const gestor = pacote ? pacote.gestor : null;

    return {
      numero: i + 1,
      criativo: c,
      nomeDoAnuncio: base,
      nome,
      formato: f.rotulo,
      plano,
      angulo,
      pacote,
      fonteDaArte: fonte,
      imagens,
      textoPrincipal,
      textoLongo,
      titulos: unicos([limpo(c.copy && c.copy.titulo)].concat(pacote ? pacote.titulos : [])),
      descricoes: unicos([limpo(c.copy && c.copy.descricao)].concat(pacote ? pacote.descricoes : [])),
      ctas,
      ganchos: pacote ? pacote.ganchos : [],
      destino: destinoEmTexto(dados.briefing),
      utm: utmDoItem(dados.briefing, gestor, base),
    };
  });
}

/** Orientação ao gestor que vale para a campanha: a primeira que existir no pacote. */
function gestorDaCampanha(itens: ItemDoZip[]): OrientacaoAoGestor | null {
  for (const it of itens) if (it.pacote && it.pacote.gestor) return it.pacote.gestor;
  return null;
}

function verbaDoPacote(dados: DadosDoZip, planos: PlanoAds[], gestor: OrientacaoAoGestor | null): string {
  for (const p of planos) {
    const total = numero(obj(p.estrutura).verba_diaria_total_brl);
    if (total !== null && total > 0) return `${brl(total)} por dia no total (do plano "${p.nome}").`;
  }
  const doBriefing = dados.briefing ? numero(dados.briefing.objetivo.verba_diaria_brl) : null;
  if (doBriefing !== null && doBriefing > 0) return `${brl(doBriefing)} por dia (do briefing).`;
  if (gestor && limpo(gestor.verba)) return limpo(gestor.verba);
  return "";
}

// ------------------------------------------------------------------ arquivos de texto

const REGRA_PADRAO_CORTE =
  "Não julgue antes de cerca de 1.000 impressões por anúncio e de 3 a 4 dias de entrega. Pause o anúncio que gastou de 2 a 3 vezes o custo tolerável por resultado sem nenhum resultado, ou com contatos ruins confirmados pelo atendimento. Registre o aprendizado antes de pausar.";
const REGRA_PADRAO_ESCALA =
  "Escale o que ficou abaixo do custo tolerável por vários dias, com volume estável e frequência controlada: suba a verba aos poucos (cerca de 20% a cada 2 ou 3 dias) ou duplique o vencedor. Renove quando a frequência passar de 2,5 a 3,5 em público frio ou o CTR cair 15% a 20% do pico.";

export function leiaMe(dados: DadosDoZip, itens: ItemDoZip[]): string {
  const planos = planosDoPacote(dados);
  const gestor = gestorDaCampanha(itens);
  const b = dados.briefing;
  const objetivoId = (planos[0] && qualidadeDoPlano(planos[0]).objetivo) || (b ? b.objetivo.acao : "");
  const objetivo = objetivoId ? rotuloDoObjetivo(objetivoId) : "";
  const verba = verbaDoPacote(dados, planos, gestor);
  const custo = b ? numero(b.objetivo.custo_toleravel_brl) : null;
  const nomeDaCampanha = `${dados.cliente} | ${planos[0] ? planos[0].nome : "Mesa Ads"} | ${dados.geradoEm.slice(0, 10)}`;
  const L: string[] = [];

  L.push(`# LEIA-ME: como subir este pacote no Gerenciador de Anúncios`, "");
  L.push(`Cliente: ${dados.cliente}`);
  if (planos.length) L.push(`Plano de teste: ${planos.map((p) => p.nome).join("; ")}`);
  L.push(`Criativos: ${itens.length}`);
  L.push(`Gerado em: ${dados.geradoEm.slice(0, 16).replace("T", " ")}`, "");
  L.push("## O que tem aqui", "");
  L.push("- `LEIA-ME.md`: este passo a passo.");
  L.push("- `estrategia.md`: briefing, oferta, plano com ângulos e o porquê de cada um, notas do Jev, estrutura e lacunas. Leia antes de subir.");
  L.push("- `copies.md`: a copy de cada criativo, com todas as variações.");
  L.push("- `copies.csv`: a mesma copy em planilha (abre no Excel), uma linha por criativo, com o nome do arquivo de cada arte.");
  L.push("- `criativos/`: as artes finais, com o mesmo nome da coluna arquivos do CSV.", "");

  L.push("## Passo 1. Antes de começar", "");
  L.push("1. Leia `estrategia.md`, principalmente as lacunas: o que está lá não pode virar promessa no anúncio.");
  L.push("2. Confira cada arte da pasta `criativos/` com a copy do mesmo número no `copies.csv`.");
  L.push("3. Confira o destino e a UTM antes de publicar.", "");

  L.push("## Passo 2. Campanha", "");
  L.push("1. No Gerenciador de Anúncios, clique em Criar.");
  if (gestor && gestor.objetivo_meta) L.push(`2. Objetivo da campanha: ${gestor.objetivo_meta}.`);
  else if (objetivo) L.push(`2. Objetivo da campanha: o que corresponde a ${objetivo} no Gerenciador.`);
  else L.push("2. Objetivo da campanha: não está definido no plano nem no briefing. Combine com o responsável antes de criar.");
  if (gestor && gestor.evento_otimizacao) L.push(`3. Evento de otimização: ${gestor.evento_otimizacao}.`);
  else L.push("3. Evento de otimização: o evento do objetivo (a métrica que decide está em `estrategia.md`).");
  L.push(`4. Nome sugerido da campanha: ${nomeDaCampanha}.`);
  if (verba) L.push(`5. Orçamento: ${verba}`);
  else L.push("5. Orçamento: o briefing não tem verba definida. Não invente um valor: combine com o responsável antes de publicar.");
  L.push("");

  L.push("## Passo 3. Conjuntos de anúncios", "");
  let conjuntosEscritos = 0;
  planos.forEach((p) => {
    const conjuntos = Array.isArray(obj(p.estrutura).conjuntos) ? (obj(p.estrutura).conjuntos as any[]) : [];
    conjuntos.forEach((cj) => {
      conjuntosEscritos++;
      const ids: string[] = Array.isArray(cj && cj.angulo_ids) ? cj.angulo_ids.map(String) : [];
      const anuncios = itens.filter((it) => it.plano && it.plano.id === p.id && it.criativo.angulo_id && ids.indexOf(it.criativo.angulo_id) >= 0);
      const v = numero(cj && cj.verba_diaria_brl);
      L.push(`### Conjunto ${conjuntosEscritos}: ${limpo(cj && cj.nome) || "sem nome"}`);
      L.push("");
      const angulos = p.angulos.filter((a) => ids.indexOf(a.id) >= 0).map((a) => a.nome);
      if (angulos.length) L.push(`- Ângulos: ${angulos.join("; ")}`);
      if (v !== null && v > 0) L.push(`- Verba diária sugerida: ${brl(v)}`);
      if (limpo(cj && cj.observacao)) L.push(`- Observação: ${limpo(cj.observacao)}`);
      L.push(`- Anúncios: ${anuncios.length ? anuncios.map((a) => a.nomeDoAnuncio).join(", ") : "nenhum criativo deste pacote é deste conjunto"}`);
      L.push("");
    });
  });
  if (!conjuntosEscritos) {
    L.push("O plano não tem estrutura de conjuntos. Sugestão: um conjunto com todos os anúncios deste pacote, para o Gerenciador distribuir a verba entre criativos diferentes.", "");
  }
  L.push("Público sugerido:", "");
  if (gestor && gestor.publico_sugerido) L.push(gestor.publico_sugerido);
  else if (b && b.publico.quem) L.push(`${b.publico.quem}. Público aberto, com o criativo filtrando quem é o público; exclua quem já é cliente quando fizer sentido.`);
  else L.push("Não definido no pacote. Use público aberto e deixe o criativo filtrar.");
  if (gestor && gestor.conjuntos) L.push("", `Orientação do pacote sobre conjuntos: ${gestor.conjuntos}`);
  L.push("");

  L.push("## Passo 4. Anúncios", "");
  L.push("Para cada criativo, crie um anúncio com o nome indicado, suba a arte e cole a copy. Tudo está também no `copies.csv`.", "");
  itens.forEach((it) => {
    L.push(`### ${doisDigitos(it.numero)}. ${it.nomeDoAnuncio}`);
    L.push("");
    L.push(`- Formato: ${it.formato}`);
    if (it.imagens.length) L.push(`- Arte: ${it.imagens.map((i) => "`" + i.arquivo + "`").join(", ")}${it.imagens.length > 1 ? " (carrossel: suba na ordem)" : ""}`);
    else L.push("- Arte: ainda sem arte no Estúdio. Gere e confira a arte antes de subir este anúncio.");
    if (it.textoPrincipal) L.push(`- Texto principal: ${it.textoPrincipal.replace(/\n+/g, " ")}`);
    if (it.titulos.length) L.push(`- Título: ${it.titulos[0]}`);
    if (it.descricoes.length) L.push(`- Descrição: ${it.descricoes[0]}`);
    if (it.ctas.length) L.push(`- Botão (CTA): ${it.ctas[0]}`);
    if (it.destino) L.push(`- Destino: ${it.destino}`);
    L.push(`- UTM: ${it.utm}`);
    L.push("");
  });
  if (b && b.destino.primeira_mensagem) L.push(`Primeira mensagem pronta (WhatsApp ou Direct): ${b.destino.primeira_mensagem}`, "");

  L.push("## Passo 5. UTM", "");
  L.push("Nos anúncios com destino em página ou formulário, cole a UTM em Parâmetros de URL. O `utm_content` é o nome do anúncio, que é o mesmo nome do arquivo: assim cada resultado volta para a arte certa.");
  if (gestor && gestor.utm) L.push("", `Orientação do pacote: ${gestor.utm}`);
  L.push("");

  L.push("## Passo 6. Rotina de teste: quando cortar e quando escalar", "");
  const janelas = planos.map((p) => numero(obj(p.estrutura).janela_dias)).filter((n): n is number => n !== null);
  if (janelas.length) L.push(`Janela do teste: ${janelas[0]} dias.`);
  if (custo !== null && custo > 0) L.push(`Custo tolerável por resultado (briefing): ${brl(custo)}.`);
  const metricas = unicos(itens.map((it) => (it.angulo && it.angulo.metrica) || ""));
  if (metricas.length) L.push(`Métrica que decide: ${metricas.join("; ")}.`);
  L.push("");
  L.push(`Quando cortar: ${gestor && gestor.regras_de_corte ? gestor.regras_de_corte : REGRA_PADRAO_CORTE}`, "");
  L.push(`Quando escalar: ${gestor && gestor.regras_de_escala ? gestor.regras_de_escala : REGRA_PADRAO_ESCALA}`, "");

  L.push("## Passo 7. Depois de publicar", "");
  L.push("1. Na Mesa Ads, marque cada criativo como No ar e ligue ao anúncio da Meta, para os resultados voltarem ao painel.");
  L.push("2. Nos 3 primeiros dias, acompanhe entrega, CPM, CTR e custo por resultado; não mexa em tudo de uma vez.");
  L.push("3. Registre o que aprendeu na aba Resultados.", "");

  const semArte = itens.filter((it) => !it.imagens.length).length;
  if (semArte) L.push("## Atenção", "", `${semArte} criativo(s) deste pacote ainda estão sem arte.`, "");
  return semTravessao(L.join("\n").trim() + "\n");
}

function notasEmTexto(a: Angulo): string {
  const n = notasDe10(a.jev);
  const partes: string[] = [];
  const rot: Record<string, string> = { clareza: "clareza", relevancia: "relevância", prova: "prova", risco_politica: "segurança de política", parada: "parada", diferenciacao: "diferenciação" };
  Object.keys(rot).forEach((k) => {
    const v = (n as Record<string, number | null>)[k];
    if (v !== null && v !== undefined) partes.push(`${rot[k]} ${v}`);
  });
  return partes.join(", ");
}

function anguloEmMd(a: Angulo, L: string[], nivel: string) {
  L.push(`${nivel} ${a.nome}`, "");
  const pontos = pontuacaoDe10(a.pontuacao);
  const linha = (rotulo: string, v: unknown) => {
    const t = limpo(v);
    if (t) L.push(`- ${rotulo}: ${t}`);
  };
  linha("Por que este ângulo (hipótese)", a.hipotese);
  linha("Situação", a.situacao);
  linha("Mecanismo", a.mecanismo);
  linha("Prova", a.prova);
  linha("Gancho visual", a.gancho_visual);
  linha("Gancho verbal", a.gancho_verbal);
  linha("Estilo visual", a.estilo_visual ? humanizar(a.estilo_visual) : "");
  linha("Métrica que decide", a.metrica);
  if (a.janela_dias) L.push(`- Janela: ${a.janela_dias} dias`);
  if (a.formatos && a.formatos.length) L.push(`- Formatos: ${a.formatos.map((f) => formatoDe(f).rotulo).join(", ")}`);
  if (pontos !== null) L.push(`- Pontuação: ${pontos} de 10`);
  const notas = notasEmTexto(a);
  if (notas) L.push(`- Notas do Jev (0 a 10): ${notas}`);
  const alerta = alertaDoJev(a.jev);
  if (alerta) L.push(`- Alerta do Jev: ${alerta}`);
  if (a.motivos && a.motivos.length) L.push(`- Motivos do Jev: ${a.motivos.join("; ")}`);
  L.push("");
}

export function estrategiaEmMd(dados: DadosDoZip, itens: ItemDoZip[]): string {
  const planos = planosDoPacote(dados);
  const oferta = ofertaDoPacote(dados, planos);
  const b = dados.briefing;
  const L: string[] = [`# Estratégia: ${dados.cliente}`, ""];

  L.push("## Briefing", "");
  if (!b) {
    L.push("Este cliente não tem briefing salvo na Mesa Ads. Sem briefing, não há base confirmada para promessa, prova ou preço.", "");
  } else {
    const o = b.oferta;
    L.push("### Oferta do briefing", "");
    if (o.produto) L.push(`- Produto ou serviço: ${o.produto}`);
    if (o.promessa) L.push(`- Promessa: ${o.promessa}`);
    if (o.condicao) L.push(`- Condição: ${o.condicao}`);
    if (o.preco_confirmado) L.push(`- Preço confirmado: ${o.preco_confirmado}`);
    if (o.garantia) L.push(`- Garantia: ${o.garantia}`);
    L.push("", "### Público", "");
    if (b.publico.quem) L.push(`- Quem: ${b.publico.quem}`);
    if (b.publico.estagio_consciencia) L.push(`- Estágio de consciência: ${rotuloDe(ESTAGIOS, b.publico.estagio_consciencia)}`);
    b.publico.situacoes.forEach((s) => L.push(`- Situação: ${s.texto}${s.fonte ? ` (fonte: ${s.fonte})` : ""}`));
    if (b.publico.motivacoes.length) L.push(`- Motivações: ${b.publico.motivacoes.join("; ")}`);
    if (b.objecoes.length) {
      L.push("", "### Objeções e respostas", "");
      b.objecoes.forEach((x) => L.push(`- ${x.texto}${x.resposta ? `. Resposta: ${x.resposta}` : ""}`));
    }
    if (b.provas.length) {
      L.push("", "### Provas", "");
      b.provas.forEach((p) => L.push(`- ${rotuloDe(TIPOS_DE_PROVA, p.tipo)}: ${p.texto}${p.fonte ? ` (fonte: ${p.fonte})` : ""}${p.autorizado ? "" : " (uso NÃO autorizado: não usar em anúncio)"}`));
    }
    L.push("", "### Destino e objetivo", "");
    const destino = destinoEmTexto(b);
    if (destino) L.push(`- Destino: ${destino}`);
    if (b.destino.primeira_mensagem) L.push(`- Primeira mensagem: ${b.destino.primeira_mensagem}`);
    if (b.objetivo.acao) L.push(`- Objetivo: ${rotuloDoObjetivo(b.objetivo.acao)}`);
    if (b.objetivo.metrica_principal) L.push(`- Métrica principal: ${b.objetivo.metrica_principal}`);
    const custo = numero(b.objetivo.custo_toleravel_brl);
    if (custo !== null && custo > 0) L.push(`- Custo tolerável por resultado: ${brl(custo)}`);
    const verba = numero(b.objetivo.verba_diaria_brl);
    if (verba !== null && verba > 0) L.push(`- Verba diária: ${brl(verba)}`);
    if (b.restricoes) L.push("", "### Restrições", "", b.restricoes);
    L.push("");
  }

  L.push("## Oferta", "");
  if (!oferta) L.push("Nenhuma oferta escolhida na Mesa Ads. O plano usa a oferta do briefing.", "");
  else {
    L.push(`### ${oferta.nome}`, "");
    const linha = (rotulo: string, v: string | null) => {
      if (v) L.push(`- ${rotulo}: ${v}`);
    };
    linha("Para quem", oferta.para_quem);
    linha("Promessa", oferta.promessa);
    linha("Mecanismo", oferta.mecanismo);
    if (oferta.entregaveis.length) linha("Entregáveis", oferta.entregaveis.join("; "));
    if (oferta.bonus.length) linha("Bônus", oferta.bonus.join("; "));
    linha("Garantia", oferta.garantia);
    linha("Urgência real", oferta.urgencia_real);
    linha("Ancoragem", oferta.ancoragem);
    linha("Chamada", oferta.cta);
    if (oferta.provas_necessarias.length) linha("Provas necessárias", oferta.provas_necessarias.join("; "));
    if (oferta.riscos.length) linha("Riscos", oferta.riscos.join("; "));
    if (oferta.jev) {
      const n = oferta.jev;
      const partes = [n.clareza !== null ? `clareza ${n.clareza}` : "", n.forca !== null ? `força ${n.forca}` : "", n.risco_politica !== null ? `segurança de política ${n.risco_politica}` : ""].filter(Boolean);
      if (partes.length) linha("Notas do Jev (0 a 10)", partes.join(", "));
      linha("Alerta do Jev", n.alerta_politica);
    }
    L.push("");
  }

  if (!planos.length) {
    L.push("## Plano de teste", "", "Os criativos deste pacote não estão ligados a um plano de teste.", "");
  }
  planos.forEach((p) => {
    const e = obj(p.estrutura);
    const q = qualidadeDoPlano(p);
    L.push(`## Plano de teste: ${p.nome}`, "");
    if (limpo(e.resumo)) L.push(limpo(e.resumo), "");
    if (q.objetivo) L.push(`- Objetivo: ${rotuloDoObjetivo(q.objetivo)}`);
    if (limpo(e.nicho)) L.push(`- Nicho: ${humanizar(limpo(e.nicho))}`);
    if (limpo(e.modo) === "variar_vencedor") L.push("- Modo: variar o vencedor (uma variável por ângulo contra a base vencedora)");
    if (p.pedido) L.push(`- Pedido da equipe: ${p.pedido}`);
    if (q.rodadas !== null || q.aprovados !== null) L.push(`- Conferência do Jev: ${q.aprovados ?? 0} aprovado(s), ${q.reprovados ?? 0} reprovado(s)${q.rodadas !== null ? ` em ${q.rodadas} rodada(s)` : ""}`);
    L.push("", "### Ângulos", "");
    p.angulos.forEach((a) => anguloEmMd(a, L, "####"));
    const conjuntos = Array.isArray(e.conjuntos) ? (e.conjuntos as any[]) : [];
    L.push("### Estrutura", "");
    if (conjuntos.length) {
      conjuntos.forEach((cj, i) => {
        const ids: string[] = Array.isArray(cj && cj.angulo_ids) ? cj.angulo_ids.map(String) : [];
        const nomes = p.angulos.filter((a) => ids.indexOf(a.id) >= 0).map((a) => a.nome);
        const v = numero(cj && cj.verba_diaria_brl);
        L.push(`- Conjunto ${i + 1}: ${limpo(cj && cj.nome) || "sem nome"}${nomes.length ? `. Ângulos: ${nomes.join("; ")}` : ""}${v !== null && v > 0 ? `. Verba diária: ${brl(v)}` : ""}${limpo(cj && cj.observacao) ? `. ${limpo(cj.observacao)}` : ""}`);
      });
    } else L.push("- Sem conjuntos definidos no plano.");
    const total = numero(e.verba_diaria_total_brl);
    if (total !== null && total > 0) L.push(`- Verba diária total: ${brl(total)}`);
    if (numero(e.janela_dias)) L.push(`- Janela do teste: ${numero(e.janela_dias)} dias`);
    if (limpo(e.observacoes)) L.push(`- Observações: ${limpo(e.observacoes)}`);
    L.push("");
    if (q.descartados.length) {
      L.push("### Ângulos descartados pelo Jev (não usar)", "");
      q.descartados.forEach((a) => {
        L.push(`- ${a.nome}: ${a.motivos && a.motivos.length ? a.motivos.join("; ") : "reprovado na conferência"}`);
      });
      L.push("");
    }
    const lacunas = Array.isArray(e.lacunas) ? (e.lacunas as unknown[]).map(limpo).filter(Boolean) : [];
    L.push("### Lacunas (o que falta confirmar)", "");
    if (lacunas.length) lacunas.forEach((l) => L.push(`- ${l}`));
    else L.push("- Nenhuma lacuna registrada.");
    L.push("");
  });

  L.push("## Criativos deste pacote", "");
  itens.forEach((it) => {
    L.push(`- ${doisDigitos(it.numero)}. ${it.nome} (${it.formato})${it.angulo ? `, ângulo ${it.angulo.nome}` : ""}${it.angulo && it.angulo.hipotese ? `. Por quê: ${it.angulo.hipotese}` : ""}`);
  });
  L.push("");
  return semTravessao(L.join("\n").trim() + "\n");
}

export function copiesEmMd(dados: DadosDoZip, itens: ItemDoZip[]): string {
  const L: string[] = [`# Copies: ${dados.cliente}`, ""];
  itens.forEach((it) => {
    L.push(`## ${doisDigitos(it.numero)}. ${it.nome}`, "");
    L.push(`- Nome do anúncio: ${it.nomeDoAnuncio}`);
    L.push(`- Formato: ${it.formato}`);
    L.push(`- Arquivo(s): ${it.imagens.length ? it.imagens.map((i) => i.arquivo).join(", ") : "sem arte ainda"}`);
    if (it.angulo) L.push(`- Ângulo: ${it.angulo.nome}`);
    if (it.destino) L.push(`- Destino: ${it.destino}`);
    L.push(`- UTM: ${it.utm}`, "");
    if (it.textoPrincipal) L.push("### Texto principal", "", it.textoPrincipal, "");
    if (it.textoLongo) L.push("### Texto longo", "", it.textoLongo, "");
    const p = it.pacote;
    if (p && p.textos_principais.length) {
      L.push("### Outros textos principais", "");
      p.textos_principais.forEach((t, i) => L.push(`#### ${i + 1}. ${rotuloDoEstilo(t.estilo) || "Texto"}`, "", t.texto, ""));
    }
    if (it.titulos.length) {
      L.push("### Títulos (até 40 caracteres)", "");
      it.titulos.forEach((t) => L.push(`- ${t} (${t.length})`));
      L.push("");
    }
    if (it.descricoes.length) {
      L.push("### Descrições (até 30 caracteres)", "");
      it.descricoes.forEach((t) => L.push(`- ${t} (${t.length})`));
      L.push("");
    }
    if (it.ctas.length) {
      L.push("### Botões (CTA)", "");
      it.ctas.forEach((c) => L.push(`- ${c}`));
      if (p) p.ctas.filter((c) => c.porque).forEach((c) => L.push(`  - ${rotuloDoCta(c.cta)}: ${c.porque}`));
      L.push("");
    }
    if (it.ganchos.length) {
      L.push("### Ganchos (primeira linha)", "");
      it.ganchos.forEach((g) => L.push(`- ${g}`));
      L.push("");
    }
    if (p && p.gestor) {
      const g = p.gestor;
      const campos = CAMPOS_DO_GESTOR.filter((c) => g[c.chave]);
      if (campos.length) {
        L.push("### Orientação ao gestor", "");
        campos.forEach((c) => L.push(`**${c.rotulo}:** ${g[c.chave]}`, ""));
      }
    }
  });
  return semTravessao(L.join("\n").trim() + "\n");
}

const COLUNAS_DO_CSV = [
  "numero",
  "nome_do_anuncio",
  "criativo",
  "formato",
  "arquivos",
  "texto_principal",
  "texto_longo",
  "titulos",
  "descricoes",
  "cta",
  "ganchos",
  "destino",
  "utm",
  "angulo",
  "plano",
];

/** Campo de CSV: sempre entre aspas, aspas dobradas, quebra de linha Windows. */
function campoCsv(v: string): string {
  return `"${semTravessao(v).replace(/\r?\n/g, "\r\n").replace(/"/g, '""')}"`;
}

/** CSV para o Excel em português: BOM, ponto e vírgula e CRLF. Uma linha por criativo. */
export function copiesEmCsv(itens: ItemDoZip[]): string {
  const linhas = [COLUNAS_DO_CSV.map(campoCsv).join(";")];
  itens.forEach((it) => {
    const valores = [
      String(it.numero),
      it.nomeDoAnuncio,
      it.nome,
      it.formato,
      it.imagens.map((i) => i.arquivo).join(" | "),
      it.textoPrincipal,
      it.textoLongo,
      it.titulos.join(" | "),
      it.descricoes.join(" | "),
      it.ctas.join(" | "),
      it.ganchos.join(" | "),
      it.destino,
      it.utm,
      it.angulo ? it.angulo.nome : "",
      it.plano ? it.plano.nome : "",
    ];
    linhas.push(valores.map(campoCsv).join(";"));
  });
  return "﻿" + linhas.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ imagens e zip

export type BaixarImagem = (bucket: string, caminho: string) => Promise<ArrayBuffer>;

/** Baixa uma imagem do storage por URL assinada (10 minutos). */
export const baixarImagemAssinada: BaixarImagem = async (bucket, caminho) => {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(caminho, 600);
  if (error || !data || !data.signedUrl) throw error || new Error("URL indisponível");
  const r = await fetch(data.signedUrl);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.arrayBuffer();
};

export const nomeDoZip = (dados: DadosDoZip) => {
  const planos = planosDoPacote(dados);
  const parte = dados.criativos.length === 1 ? dados.criativos[0].nome || "criativo" : planos.length === 1 ? planos[0].nome : "criativos";
  return `pacote-gestor-${nomeDeArquivo(dados.cliente)}-${nomeDeArquivo(parte || "criativos")}-${dados.geradoEm.slice(0, 10)}.zip`;
};

export interface ResultadoDoZip {
  blob: Blob;
  nome: string;
  imagens: number;
  faltando: string[];
}

/** Gera o .zip inteiro no navegador. Imagem que não desce vira aviso no LEIA-ME, não erro. */
export async function gerarZipDoGestor(
  dados: DadosDoZip,
  opcoes: { baixar?: BaixarImagem; aoProgredir?: (p: ProgressoDoZip) => void; simultaneas?: number } = {},
): Promise<ResultadoDoZip> {
  const baixar = opcoes.baixar || baixarImagemAssinada;
  const avisar = opcoes.aoProgredir || (() => undefined);
  const itens = montarItens(dados);
  const todas: ImagemDoZip[] = [];
  itens.forEach((it) => it.imagens.forEach((i) => todas.push(i)));

  const mod: any = await import("jszip");
  const JSZip = mod.default || mod;
  const zip = new JSZip();

  let feitas = 0;
  const faltando: string[] = [];
  avisar({ etapa: "imagens", feitas, total: todas.length });
  const fila = todas.slice();
  const trabalhar = async () => {
    for (;;) {
      const img = fila.shift();
      if (!img) return;
      try {
        const bytes = await baixar(img.bucket, img.caminho);
        zip.file(img.arquivo, new Uint8Array(bytes), { binary: true });
      } catch {
        faltando.push(img.arquivo);
      }
      feitas++;
      avisar({ etapa: "imagens", feitas, total: todas.length });
    }
  };
  const n = Math.max(1, Math.min(opcoes.simultaneas || 3, todas.length || 1));
  const trabalhadores: Promise<void>[] = [];
  for (let i = 0; i < n; i++) trabalhadores.push(trabalhar());
  await Promise.all(trabalhadores);

  let leia = leiaMe(dados, itens);
  if (faltando.length) {
    leia += `\n## Imagens que não baixaram\n\nEstas artes não vieram no zip (baixe de novo ou pegue em Arquivos):\n\n${faltando.map((f) => `- ${f}`).join("\n")}\n`;
  }
  zip.file("LEIA-ME.md", leia);
  zip.file("estrategia.md", estrategiaEmMd(dados, itens));
  zip.file("copies.md", copiesEmMd(dados, itens));
  zip.file("copies.csv", copiesEmCsv(itens));

  avisar({ etapa: "compactando", feitas, total: todas.length });
  const blob: Blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  avisar({ etapa: "pronto", feitas, total: todas.length });
  return { blob, nome: nomeDoZip(dados), imagens: todas.length - faltando.length, faltando };
}

/** Entrega o blob ao navegador como download. */
export function salvarBlob(nome: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ------------------------------------------------------------------ dados da tela

/** Data e hora locais no formato AAAA-MM-DDTHH:MM (nome do arquivo e LEIA-ME). */
export function agoraLocal(d = new Date()): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Lê o que o zip precisa pelas mesmas chaves da Mesa Ads (reaproveita o que
 * a tela já tem em cache). `corpo` é o mesmo do envio ao gestor:
 * { criativo_ids } para um criativo ou { plano_id } para o plano inteiro.
 */
export async function carregarDadosDoZip(
  queryClient: QueryClient,
  clientId: string,
  cliente: string,
  corpo: Record<string, unknown>,
): Promise<DadosDoZip> {
  const [criativos, planos, briefing, ofertas] = await Promise.all([
    queryClient.fetchQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId), staleTime: 30_000 }),
    queryClient.fetchQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId), staleTime: 30_000 }),
    queryClient.fetchQuery({ queryKey: chavesAds.briefing(clientId), queryFn: () => lerBriefing(clientId), staleTime: 30_000 }),
    queryClient.fetchQuery({ queryKey: chavesAds.ofertas(clientId), queryFn: () => lerOfertas(clientId), staleTime: 30_000 }).catch(() => [] as Oferta[]),
  ]);
  const ids = Array.isArray(corpo.criativo_ids) ? (corpo.criativo_ids as unknown[]).map(String) : [];
  const planoId = typeof corpo.plano_id === "string" ? corpo.plano_id : "";
  const escolhidos = (criativos || [])
    .filter((c) => (ids.length ? ids.indexOf(c.id) >= 0 : planoId ? c.plano_id === planoId : false))
    .slice()
    .sort((a, b) => (a.criado_em || "").localeCompare(b.criado_em || ""));
  const trabalhoIds = escolhidos.map((c) => c.trabalho_id).filter((x): x is string => !!x);
  const trabalhos = trabalhoIds.length ? ((await lerTrabalhos(trabalhoIds)) as TrabalhoDoZip[]) : [];
  return {
    cliente: cliente || "Cliente",
    geradoEm: agoraLocal(),
    briefing: briefing || null,
    ofertas: ofertas || [],
    planos: planos || [],
    criativos: escolhidos,
    trabalhos,
  };
}
