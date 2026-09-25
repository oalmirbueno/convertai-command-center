import type { QueryClient } from "@tanstack/react-query";
import { chamarAds, chavesAds, formatoDe, lerCriativos, lerPlanos, lerTrabalhos, nomeDeArquivo, type CriativoAds, type PlanoAds } from "./adsApi";
import { criativosAgrupados, type ContaComResultados, lerContaComResultados, chaveDosResultados, grupoDe } from "./resultadosApi";
import { agoraLocal, baixarImagemAssinada, imagensDoTrabalho, semTravessao, type BaixarImagem, type TrabalhoDoZip } from "./zipDoGestor";

/**
 * Pacote de otimização para o agente externo (pedido do dono em 26/09/2026):
 * "baixar o prompt completo e jogar no agente externo, com o material 100%
 * atualizado num zip; o agente analisa tudo e volta com os criativos".
 *
 * Montado no navegador com jszip (sem IA, custo zero), reaproveitando o
 * zipDoGestor (arte do Estúdio, download assinado, sem travessão):
 * - LEIA-ME.md: o que tem, como usar e o CONTRATO do retorno;
 * - PROMPT-COMPLETO.md: pronto para colar (papel, contexto, diagnóstico,
 *   dados, criativos, plano recomendado, regras da Meta e o formato da resposta);
 * - estrategia.md: a última estratégia do agente sênior;
 * - dados/*.csv (Excel: ponto e vírgula, BOM) e dados/contexto.json;
 * - miniaturas/ (anúncios com mais investimento) e criativos-mesa/ (artes do Estúdio);
 * - MODELO-DE-RETORNO.json: o exemplo do que o agente externo devolve.
 *
 * O retorno volta pelo "Importar pacote no Estúdio Ads" (pacote_importar),
 * que valida no servidor e recusa o que não entende.
 */

export const FORMATO_DO_RETORNO = "mesa-ads-retorno";
export const MAX_MINIATURAS = 40;
export const MAX_ARTES_DA_MESA = 20;

export interface DadosDoServidor {
  cliente: string;
  contexto: Record<string, any>;
  estrategia: Record<string, any> | null;
  estrategia_markdown: string | null;
  estrategia_em: string | null;
  regras: Record<string, any>;
}

export interface DadosDoPacoteOtimizacao {
  cliente: string;
  geradoEm: string;
  dias: number;
  conta: ContaComResultados;
  servidor: DadosDoServidor;
  criativos: CriativoAds[];
  planos: PlanoAds[];
  trabalhos: TrabalhoDoZip[];
}

export interface ImagemDoPacote {
  arquivo: string;
  /** Endereço público (miniatura da Meta ou link assinado). */
  url?: string | null;
  bucket?: string;
  caminho?: string;
}

// ------------------------------------------------------------------ texto

const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && isFinite(v) ? String(v) : "");
const reais = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(Number(v)) ? "" : Number(v).toFixed(2).replace(".", ","));
const decimal = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(Number(v)) ? "" : String(Math.round(Number(v) * 100) / 100).replace(".", ","));

function campoCsv(v: string): string {
  return `"${semTravessao(v).replace(/\r?\n/g, " ").replace(/"/g, '""')}"`;
}

export function csv(colunas: string[], linhas: (string | number | null | undefined)[][]): string {
  const saida = [colunas.map(campoCsv).join(";")];
  linhas.forEach((l) => saida.push(l.map((v) => campoCsv(v === null || v === undefined ? "" : String(v))).join(";")));
  return "\uFEFF" + saida.join("\r\n") + "\r\n";
}

function extensaoDaUrl(u: string): string {
  const m = /\.(png|jpe?g|webp|gif)(\?|$)/i.exec(u || "");
  const e = m ? m[1].toLowerCase() : "jpg";
  return e === "jpeg" ? "jpg" : e;
}

// ------------------------------------------------------------------ contrato do retorno

export const MODELO_DE_RETORNO = {
  formato: FORMATO_DO_RETORNO,
  versao: 1,
  plano: {
    nome: "Mensagens: novos criativos a partir dos vencedores",
    objetivo: "mensagens",
    resumo: "Por que estes criativos, em 2 ou 3 frases, com base nos números do pacote.",
  },
  criativos: [
    {
      titulo: "Nome curto do criativo",
      angulo: "A ideia do anúncio: situação do público e o mecanismo que convence.",
      hipotese: "Por que deve funcionar, ligado a um número real do pacote.",
      objetivo: "mensagens",
      formato: "feed_4x5",
      estilo_visual: null,
      gancho_visual: "O que a imagem mostra, para o diretor de arte (cena, objeto, pessoa, composição).",
      headline_arte: "Frase grande da arte (até 8 palavras)",
      apoio_arte: "Linha de apoio curta (opcional)",
      cta_arte: "Chama no WhatsApp",
      texto_principal: "Texto principal do anúncio, até cerca de 125 caracteres antes do ver mais.",
      texto_principal_longo: "Versão longa do texto (opcional).",
      titulo_anuncio: "Título até 40 caracteres",
      descricao: "Até 30 caracteres",
      cta_meta: "Enviar mensagem",
      carrossel: null,
      base_ad_id: null,
    },
  ],
};

export const CONTRATO_DO_RETORNO = `## Contrato do retorno (o que o agente externo devolve)

Um JSON (arquivo \`retorno.json\` dentro de um .zip, o próprio .json, ou um bloco \`\`\`json no texto) com:

- \`formato\`: "${FORMATO_DO_RETORNO}"; \`versao\`: 1.
- \`plano\` (opcional): \`nome\`, \`objetivo\` e \`resumo\`.
- \`criativos\`: lista de 1 a 12 criativos. Cada um PRECISA de:
  - \`titulo\`: nome curto do criativo;
  - \`angulo\`: a ideia (situação do público e mecanismo);
  - \`formato\`: \`feed_4x5\`, \`quadrado_1x1\`, \`stories_9x16\` ou \`carrossel\`;
  - \`gancho_visual\`: o que a imagem mostra (brief da arte);
  - \`headline_arte\`: a frase grande da arte;
  - \`texto_principal\`: o texto do anúncio (cerca de 125 caracteres aparecem antes do "ver mais");
  - \`titulo_anuncio\`: título do anúncio (até 40 caracteres).
- Opcionais: \`hipotese\`, \`objetivo\` (vendas, mensagens, leads, seguidores, agendamento, trafego, reconhecimento), \`estilo_visual\` (um dos ids da lista de estilos), \`apoio_arte\`, \`cta_arte\`, \`texto_principal_longo\`, \`descricao\` (até 30), \`cta_meta\` (um dos botões da Meta da lista), \`carrossel\` (3 a 5 cartões \`{ "texto", "ilustracao" }\`) e \`base_ad_id\` (o ad_id do anúncio que serviu de base).

O que a Mesa Ads faz com o retorno: mostra o que entendeu, recusa com o motivo o criativo que não tem os campos obrigatórios ou tem formato desconhecido, confere a política pelo Jev (aviso, sem reescrever) e cria um plano com os criativos prontos para o Estúdio Ads gerar a arte. Nada é publicado na Meta.`;

// ------------------------------------------------------------------ montagem

const ctr = (m: { ctr_saida: number | null; ctr: number | null }) => (m.ctr_saida !== null ? m.ctr_saida : m.ctr);

/** Arquivos de texto e a lista de imagens do pacote (puro: sem rede). */
export function montarPacote(d: DadosDoPacoteOtimizacao): { arquivos: { caminho: string; conteudo: string }[]; imagens: ImagemDoPacote[] } {
  const conta = d.conta;
  const anuncios = conta.anuncios.slice().sort((a, b) => (b.metricas.gasto || 0) - (a.metricas.gasto || 0));
  const imagens: ImagemDoPacote[] = [];
  const miniaturaDe: Record<string, string> = {};
  anuncios.filter((a) => !!a.imagem_url).slice(0, MAX_MINIATURAS).forEach((a) => {
    const arquivo = `miniaturas/${a.ad_id}.${extensaoDaUrl(a.imagem_url || "")}`;
    miniaturaDe[a.ad_id] = arquivo;
    imagens.push({ arquivo, url: a.imagem_url });
  });
  const trabalhos: Record<string, TrabalhoDoZip> = {};
  d.trabalhos.forEach((t) => {
    if (t && t.id) trabalhos[t.id] = t;
  });
  const arteDe: Record<string, string> = {};
  d.criativos.slice(0, MAX_ARTES_DA_MESA).forEach((c, i) => {
    const r = imagensDoTrabalho(c.trabalho_id ? trabalhos[c.trabalho_id] : null).refs[0];
    if (!r) return;
    const arquivo = `criativos-mesa/${String(i + 1).padStart(2, "0")}-${nomeDeArquivo(c.nome || "criativo")}.${extensaoDaUrl(r.caminho)}`;
    arteDe[c.id] = arquivo;
    imagens.push({ arquivo, bucket: r.bucket, caminho: r.caminho });
  });

  const campanhasCsv = csv(
    ["campaign_id", "campanha", "status", "objetivo_na_meta", "grupo", "resultado", "orcamento_diario", "investido", "resultados", "custo_por_resultado", "ctr_pct", "cpm", "frequencia"],
    conta.campanhas.map((c) => [c.campaign_id, c.nome, c.status, c.objetivo, c.grupo ? grupoDe(c.grupo)!.rotulo : "", c.resultado_rotulo, reais(c.orcamento_diario), reais(c.metricas.gasto), c.metricas.resultados, reais(c.metricas.custo_por_resultado), decimal(ctr(c.metricas)), reais(c.metricas.cpm), decimal(c.metricas.frequencia)]),
  );
  const anunciosCsv = csv(
    ["ad_id", "anuncio", "status", "campanha", "conjunto", "formato", "grupo", "resultado", "investido", "resultados", "custo_por_resultado", "ctr_pct", "cpm", "frequencia", "sinal_do_painel", "titulo", "texto", "cta", "destino", "miniatura", "criativo_da_mesa"],
    anuncios.map((a) => [
      a.ad_id, a.nome, a.status, a.campanha, a.conjunto, a.formato, a.grupo ? grupoDe(a.grupo)!.rotulo : "", a.resultado_rotulo, reais(a.metricas.gasto), a.metricas.resultados,
      reais(a.metricas.custo_por_resultado), decimal(ctr(a.metricas)), reais(a.metricas.cpm), decimal(a.metricas.frequencia), a.sinal, a.titulo, a.corpo, a.cta, a.destino,
      miniaturaDe[a.ad_id] || "", a.criativo ? a.criativo.nome : "",
    ]),
  );
  const pecas = criativosAgrupados(conta.anuncios);
  const pecasCsv = csv(
    ["peca", "nome", "anuncios", "ativos", "grupo", "resultado", "investido", "resultados", "custo_por_resultado", "indice_vs_mediana", "miniatura"],
    pecas.map((p) => [p.peca, p.nome, p.anuncios.length, p.ativos, p.grupo ? grupoDe(p.grupo)!.rotulo : "", p.resultado_rotulo, reais(p.metricas.gasto), p.metricas.resultados, reais(p.metricas.custo_por_resultado), decimal(p.indice), miniaturaDe[p.anuncios[0].ad_id] || ""]),
  );
  const planoDe: Record<string, PlanoAds> = {};
  d.planos.forEach((p) => (planoDe[p.id] = p));
  const criativosCsv = csv(
    ["criativo_id", "nome", "formato", "status", "plano", "ligado_ao_anuncio", "frase_da_arte", "texto_principal", "titulo", "descricao", "cta", "arte"],
    d.criativos.map((c) => {
      const cp = obj(c.copy);
      return [c.id, c.nome || "", formatoDe(c.formato).rotulo, c.status, c.plano_id && planoDe[c.plano_id] ? planoDe[c.plano_id].nome : "", c.ad_id || "", txt(cp.headline_arte), txt(cp.texto_principal), txt(cp.titulo), txt(cp.descricao), txt(cp.cta_meta), arteDe[c.id] || ""];
    }),
  );
  const serieCsv = csv(["dia", "investido", "resultados", "cliques_no_link", "custo_por_resultado"], conta.extras.serie.map((p) => [p.dia, reais(p.gasto), p.resultados, p.cliques_link, reais(p.custo_por_resultado)]));

  const s = d.servidor;
  const regras = obj(s.regras);
  const periodo = conta.conta.periodo;
  const mix = conta.mix;
  const estrategia = obj(s.estrategia);
  const re = obj(estrategia.reestruturacao);
  const L: string[] = [];
  L.push(`# Prompt completo: otimização de anúncios de ${d.cliente}`, "");
  L.push("Cole este texto no agente externo e anexe o .zip (ou os arquivos de `dados/`, `miniaturas/` e `criativos-mesa/`).", "");
  L.push("## Seu papel", "");
  L.push("Você é gestor de tráfego sênior e diretor criativo de anúncios da Meta no Brasil, especialista no nicho deste cliente. Analise a conta real abaixo e devolva os próximos criativos, focados em mensagem e em venda, prontos para produzir.", "");
  L.push("## Regras duras", "");
  L.push("- Use só os números do pacote. Nunca invente depoimento, número, preço, prazo, garantia, escassez ou resultado.");
  L.push("- Política de anúncios da Meta é regra dura (sem atributo pessoal, sem promessa de resultado, sem antes e depois, sem imitar interface, sem sensacionalismo).");
  L.push("- Nunca escureça a foto para dar destaque: o destaque vem de contraste, composição, tipografia, escala e cor.");
  L.push("- Português do Brasil, sem travessão.", "");
  L.push("## O cliente", "");
  L.push(`- Nome: ${d.cliente}`);
  if (periodo) L.push(`- Período dos dados: ${periodo.inicio} a ${periodo.fim} (${d.dias} dias)`);
  const briefing = obj(obj(s.contexto).briefing);
  const oferta = obj(briefing.oferta);
  if (txt(oferta.produto)) L.push(`- Produto ou serviço: ${txt(oferta.produto)}`);
  if (txt(oferta.promessa)) L.push(`- Promessa: ${txt(oferta.promessa)}`);
  if (txt(oferta.preco_confirmado)) L.push(`- Preço confirmado: ${txt(oferta.preco_confirmado)}`);
  const destino = obj(briefing.destino);
  if (txt(destino.tipo)) L.push(`- Onde a venda acontece: ${txt(destino.tipo)}${txt(destino.url) ? ` (${txt(destino.url)})` : ""}`);
  const escolhida = obj(obj(s.contexto).oferta_escolhida);
  if (txt(escolhida.nome)) L.push(`- Oferta escolhida: ${txt(escolhida.nome)}. ${txt(escolhida.promessa)}`);
  L.push("- O contexto completo (marca, dossiê, cérebro do cliente, brief, campanhas do mês) está em `dados/contexto.json`.", "");
  L.push("## Diagnóstico calculado pelo painel", "");
  const t = conta.conta.totais;
  L.push(`- Investimento no período: R$ ${reais(t.gasto)}; ${conta.resultado_rotulo.toLowerCase()}: ${t.resultados ?? 0}; custo por resultado: R$ ${reais(t.custo_por_resultado) || "sem resultado"}.`);
  if (conta.tendencia && conta.tendencia.gasto_pct !== null) L.push(`- Contra o período anterior: investimento ${conta.tendencia.gasto_pct}%, resultados ${conta.tendencia.resultados_pct ?? "sem base"}%, custo por resultado ${conta.tendencia.custo_por_resultado_pct ?? "sem base"}%.`);
  if (mix) {
    mix.por_grupo.forEach((g) => L.push(`- ${g.rotulo}: ${g.pct}% do investimento (R$ ${reais(g.gasto)}), ${g.resultados} ${g.resultado_rotulo.toLowerCase()}, custo R$ ${reais(g.custo_por_resultado) || "sem resultado"}.`));
    mix.alertas.forEach((a) => L.push(`- ATENÇÃO: ${a}`));
  }
  lista(estrategia.diagnostico).forEach((x) => L.push(`- ${txt(obj(x).titulo)}: ${txt(obj(x).detalhe)}`));
  L.push("");
  L.push("## Os anúncios que mais investiram (tabela completa em `dados/anuncios.csv`)", "");
  anuncios.slice(0, 15).forEach((a) => {
    L.push(`- ${a.nome} (ad_id ${a.ad_id}, ${a.grupo ? grupoDe(a.grupo)!.rotulo : "sem objetivo"}, ${a.status}): R$ ${reais(a.metricas.gasto)}, ${a.metricas.resultados ?? 0} ${a.resultado_rotulo.toLowerCase()}, R$ ${reais(a.metricas.custo_por_resultado) || "sem resultado"} cada, CTR ${decimal(ctr(a.metricas))}%, sinal ${a.sinal}.${miniaturaDe[a.ad_id] ? ` Miniatura: ${miniaturaDe[a.ad_id]}.` : ""}${a.corpo ? ` Texto: "${a.corpo.slice(0, 160)}"` : ""}`);
  });
  L.push("");
  L.push("## Melhores criativos (a mesma arte somada; `dados/pecas.csv`)", "");
  pecas.slice(0, 8).forEach((p) => L.push(`- ${p.nome}: ${p.anuncios.length} anúncio(s), R$ ${reais(p.metricas.gasto)}, ${p.metricas.resultados} ${p.resultado_rotulo.toLowerCase()}, índice ${decimal(p.indice) || "sem volume"} (1 = mediana; menor é melhor).`));
  L.push("");
  L.push("## Plano recomendado pelo agente sênior da agência", "");
  if (!s.estrategia) L.push("Ainda não há estratégia do agente sênior. Monte a sua a partir do diagnóstico e dos números.");
  else {
    if (txt(re.objetivo)) L.push(`- Objetivo principal: ${txt(re.objetivo)}${txt(re.evento_otimizacao) ? `, otimizando para ${txt(re.evento_otimizacao)}` : ""}.`);
    if (txt(re.porque)) L.push(`- Por quê: ${txt(re.porque)}`);
    lista(re.campanhas).forEach((c) => L.push(`- Campanha ${txt(obj(c).nome)}: ${lista(obj(c).conjuntos).map((j) => `${txt(obj(j).nome)} (${txt(obj(j).publico)})`).join("; ")}`));
    lista(estrategia.proximos_criativos).forEach((c) => L.push(`- Próximo criativo sugerido: ${txt(obj(c).titulo)}. ${txt(obj(c).angulo)}`));
    L.push("- A estratégia completa está em `estrategia.md`.");
  }
  L.push("");
  L.push("## Regras da Meta e da agência", "");
  if (txt(regras.politicas_meta)) L.push(txt(regras.politicas_meta), "");
  if (txt(regras.honestidade)) L.push(txt(regras.honestidade), "");
  L.push("- Texto principal: cerca de 125 caracteres aparecem antes do \"ver mais\". Título: até 40 caracteres. Descrição: até 30.");
  if (lista(regras.ctas_meta).length) L.push(`- Botões da Meta aceitos em cta_meta: ${lista(regras.ctas_meta).map(txt).join(", ")}.`);
  if (lista(regras.estilos_visuais).length) L.push(`- Estilos visuais (ids para estilo_visual): ${lista(regras.estilos_visuais).map((e) => `${txt(obj(e).id)} (${txt(obj(e).nome)})`).join("; ")}.`);
  if (lista(regras.objetivos).length) L.push(`- Objetivos: ${lista(regras.objetivos).map((o) => `${txt(obj(o).id)} = ${txt(obj(o).objetivo_meta)}, decide por ${txt(obj(o).metrica_que_decide)}`).join("; ")}.`);
  if (txt(regras.estrategia_de_conta)) L.push("", txt(regras.estrategia_de_conta));
  L.push("");
  L.push("## O que eu quero de volta", "");
  L.push("1. Uma análise curta (o que fazer com a conta: objetivo, estrutura, o que cortar e escalar, com os números).");
  L.push("2. De 4 a 8 criativos novos, a partir do que já performou e do que funciona no Brasil neste nicho, com ângulos realmente diferentes entre si.");
  L.push("3. Os criativos no JSON do contrato abaixo, num bloco ```json (ou num arquivo retorno.json). É esse JSON que a Mesa Ads importa.", "");
  L.push(CONTRATO_DO_RETORNO, "");
  L.push("Exemplo (um criativo):", "", "```json", JSON.stringify(MODELO_DE_RETORNO, null, 2), "```");
  const prompt = semTravessao(L.join("\n").trim() + "\n");

  const leia: string[] = [];
  leia.push(`# LEIA-ME: pacote de otimização de ${d.cliente}`, "");
  leia.push(`Gerado em ${d.geradoEm.replace("T", " ")} pela Mesa Ads, com os dados da conta de ${periodo ? `${periodo.inicio} a ${periodo.fim}` : `${d.dias} dias`}.`, "");
  leia.push("## Como usar", "");
  leia.push("1. Abra `PROMPT-COMPLETO.md`, copie tudo e cole no agente externo (ChatGPT, Claude, Gemini ou outro).");
  leia.push("2. Anexe este .zip (ou os arquivos das pastas `dados/`, `miniaturas/` e `criativos-mesa/`).");
  leia.push("3. Peça a resposta no formato do contrato abaixo (o prompt já pede).");
  leia.push("4. Na Mesa Ads, em Conta ou no Estúdio Ads, clique em \"Importar pacote no Estúdio Ads\" e suba o .zip ou o .json que o agente devolveu, ou cole o texto da resposta.");
  leia.push("5. Confira o que a Mesa Ads entendeu e confirme: ela cria um plano com os criativos prontos para o Estúdio Ads gerar a arte.", "");
  leia.push("## O que tem aqui", "");
  leia.push("- `PROMPT-COMPLETO.md`: o prompt pronto para colar.");
  leia.push("- `estrategia.md`: a última estratégia do agente sênior da agência (se houver).");
  leia.push("- `dados/anuncios.csv`, `dados/campanhas.csv`, `dados/pecas.csv`, `dados/criativos-mesa.csv`, `dados/serie-diaria.csv`: os números (abrem no Excel).");
  leia.push("- `dados/contexto.json`: o contexto completo do cliente (marca, dossiê, briefing, oferta, evolução).");
  leia.push("- `miniaturas/`: imagens dos anúncios com mais investimento, com o ad_id no nome.");
  leia.push("- `criativos-mesa/`: as artes dos criativos da Mesa Ads.");
  leia.push("- `MODELO-DE-RETORNO.json`: o exemplo do retorno.", "");
  leia.push(CONTRATO_DO_RETORNO, "");
  const estrategiaMd = semTravessao((s.estrategia_markdown ? `# Estratégia do agente sênior${s.estrategia_em ? ` (${s.estrategia_em.slice(0, 16).replace("T", " ")})` : ""}\n\n${s.estrategia_markdown}` : "# Estratégia do agente sênior\n\nAinda não há estratégia. Converse com o agente sênior na aba Conta para gerar uma.") + "\n");

  return {
    arquivos: [
      { caminho: "LEIA-ME.md", conteudo: semTravessao(leia.join("\n").trim() + "\n") },
      { caminho: "PROMPT-COMPLETO.md", conteudo: prompt },
      { caminho: "estrategia.md", conteudo: estrategiaMd },
      { caminho: "dados/campanhas.csv", conteudo: campanhasCsv },
      { caminho: "dados/anuncios.csv", conteudo: anunciosCsv },
      { caminho: "dados/pecas.csv", conteudo: pecasCsv },
      { caminho: "dados/criativos-mesa.csv", conteudo: criativosCsv },
      { caminho: "dados/serie-diaria.csv", conteudo: serieCsv },
      { caminho: "dados/contexto.json", conteudo: semTravessao(JSON.stringify(s.contexto, null, 2)) },
      { caminho: "MODELO-DE-RETORNO.json", conteudo: JSON.stringify(MODELO_DE_RETORNO, null, 2) },
    ],
    imagens,
  };
}

// ------------------------------------------------------------------ zip

export type BaixarUrl = (url: string) => Promise<ArrayBuffer>;

const baixarUrlPadrao: BaixarUrl = async (url) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return await r.arrayBuffer();
};

export const nomeDoPacote = (d: DadosDoPacoteOtimizacao) => `pacote-otimizacao-${nomeDeArquivo(d.cliente)}-${d.geradoEm.slice(0, 10)}.zip`;

/** Gera o .zip no navegador. Imagem que não desce vira aviso no LEIA-ME, não erro. */
export async function gerarPacoteDeOtimizacao(
  d: DadosDoPacoteOtimizacao,
  opcoes: { baixarUrl?: BaixarUrl; baixarStorage?: BaixarImagem; aoProgredir?: (feitas: number, total: number) => void } = {},
): Promise<{ blob: Blob; nome: string; imagens: number; faltando: string[] }> {
  const { arquivos, imagens } = montarPacote(d);
  const baixarUrl = opcoes.baixarUrl || baixarUrlPadrao;
  const baixarStorage = opcoes.baixarStorage || baixarImagemAssinada;
  const mod: any = await import("jszip");
  const JSZip = mod.default || mod;
  const zip = new JSZip();
  const faltando: string[] = [];
  let feitas = 0;
  const fila = imagens.slice();
  const trabalhar = async () => {
    for (;;) {
      const img = fila.shift();
      if (!img) return;
      try {
        const bytes = img.bucket && img.caminho ? await baixarStorage(img.bucket, img.caminho) : img.url ? await baixarUrl(img.url) : null;
        if (!bytes) throw new Error("sem origem");
        zip.file(img.arquivo, new Uint8Array(bytes), { binary: true });
      } catch {
        faltando.push(img.arquivo);
      }
      feitas++;
      if (opcoes.aoProgredir) opcoes.aoProgredir(feitas, imagens.length);
    }
  };
  const trabalhadores: Promise<void>[] = [];
  for (let i = 0; i < Math.max(1, Math.min(4, imagens.length)); i++) trabalhadores.push(trabalhar());
  await Promise.all(trabalhadores);
  arquivos.forEach((a) => {
    let conteudo = a.conteudo;
    if (a.caminho === "LEIA-ME.md" && faltando.length) {
      conteudo += `\n## Imagens que não baixaram\n\nO navegador não conseguiu baixar estas imagens (link vencido ou bloqueado pela Meta). O endereço de cada anúncio continua em \`dados/anuncios.csv\`.\n\n${faltando.map((f) => `- ${f}`).join("\n")}\n`;
    }
    zip.file(a.caminho, conteudo);
  });
  const blob: Blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return { blob, nome: nomeDoPacote(d), imagens: imagens.length - faltando.length, faltando };
}

/** Lê tudo o que o pacote precisa (reaproveita o cache da tela). */
export async function carregarDadosDoPacote(queryClient: QueryClient, clientId: string, cliente: string, dias: number): Promise<DadosDoPacoteOtimizacao> {
  const [conta, servidor, criativos, planos] = await Promise.all([
    queryClient.fetchQuery({ queryKey: chaveDosResultados(clientId, dias), queryFn: () => lerContaComResultados(clientId, dias), staleTime: 60_000 }),
    chamarAds<any>("pacote_otimizacao_dados", { client_id: clientId, dias }),
    queryClient.fetchQuery({ queryKey: chavesAds.criativos(clientId), queryFn: () => lerCriativos(clientId), staleTime: 30_000 }),
    queryClient.fetchQuery({ queryKey: chavesAds.planos(clientId), queryFn: () => lerPlanos(clientId), staleTime: 30_000 }),
  ]);
  const escolhidos = (criativos || []).slice(0, 60);
  const ids = escolhidos.slice(0, MAX_ARTES_DA_MESA).map((c) => c.trabalho_id).filter((x): x is string => !!x);
  const trabalhos = ids.length ? ((await lerTrabalhos(ids)) as TrabalhoDoZip[]) : [];
  const s = obj(servidor);
  return {
    cliente: txt(s.cliente) || cliente || "Cliente",
    geradoEm: agoraLocal(),
    dias,
    conta,
    servidor: {
      cliente: txt(s.cliente) || cliente,
      contexto: obj(s.contexto),
      estrategia: Object.keys(obj(s.estrategia)).length ? obj(s.estrategia) : null,
      estrategia_markdown: txt(s.estrategia_markdown) || null,
      estrategia_em: txt(s.estrategia_em) || null,
      regras: obj(s.regras),
    },
    criativos: escolhidos,
    planos: planos || [],
    trabalhos,
  };
}

// ------------------------------------------------------------------ retorno do agente externo

/**
 * Acha o JSON do retorno num texto: o texto inteiro, um bloco ```json, ou do
 * primeiro "{" ao último "}". Sem JSON válido, diz o porquê (nada inventado).
 */
export function extrairRetorno(texto: string): { ok: true; valor: unknown } | { ok: false; erro: string } {
  const t = String(texto || "").replace(/^\uFEFF/, "").trim();
  if (!t) return { ok: false, erro: "O texto está vazio." };
  const tentar = (s: string): unknown => {
    try {
      return JSON.parse(s);
    } catch {
      return undefined;
    }
  };
  const inteiro = tentar(t);
  if (inteiro !== undefined && typeof inteiro === "object" && inteiro !== null) return { ok: true, valor: inteiro };
  const blocos = t.split("```");
  for (let i = 1; i < blocos.length; i += 2) {
    const corpo = blocos[i].replace(/^json\s*/i, "").trim();
    const v = tentar(corpo);
    if (v !== undefined && typeof v === "object" && v !== null) return { ok: true, valor: v };
  }
  const ini = t.indexOf("{");
  const fim = t.lastIndexOf("}");
  if (ini >= 0 && fim > ini) {
    const v = tentar(t.slice(ini, fim + 1));
    if (v !== undefined) return { ok: true, valor: v };
  }
  return { ok: false, erro: "Não achei o JSON do retorno. Peça ao agente externo a resposta no formato do contrato (bloco ```json ou arquivo retorno.json)." };
}

/** Texto do retorno a partir do arquivo: .zip (retorno.json, outro .json, .md ou .txt) ou o próprio arquivo de texto. */
export async function textoDoArquivoDeRetorno(arquivo: File | Blob & { name?: string }): Promise<string> {
  const nome = String((arquivo as { name?: string }).name || "").toLowerCase();
  const buf = await arquivo.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const ehZip = nome.slice(-4) === ".zip" || (bytes[0] === 0x50 && bytes[1] === 0x4b);
  if (!ehZip) return new TextDecoder().decode(bytes);
  const mod: any = await import("jszip");
  const JSZip = mod.default || mod;
  const zip = await JSZip.loadAsync(buf);
  const nomes: string[] = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const ordem = [
    nomes.filter((n) => /(^|\/)retorno\.json$/i.test(n)),
    nomes.filter((n) => /\.json$/i.test(n) && !/modelo-de-retorno\.json$/i.test(n) && !/contexto\.json$/i.test(n)),
    nomes.filter((n) => /\.(md|txt)$/i.test(n) && !/leia-me\.md$/i.test(n) && !/prompt-completo\.md$/i.test(n)),
  ];
  for (const grupo of ordem) {
    for (const n of grupo) {
      const conteudo: string = await zip.files[n].async("string");
      if (extrairRetorno(conteudo).ok) return conteudo;
    }
  }
  throw new Error("O .zip não tem um retorno.json (nem outro arquivo com o JSON do contrato).");
}
