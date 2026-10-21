import type { ExecucaoDoLab, ProjetoDoLab } from "./api";
import { TIPOS_DE_NO, rotuloDoGatilho, type CanvasDoLab } from "./nos";

export interface EntradaDaExportacao {
  projeto: ProjetoDoLab;
  canvas: CanvasDoLab;
  execucoes: ExecucaoDoLab[];
  clienteNome?: string;
}

type ValorSeguro = string | number | boolean | null | ValorSeguro[] | { [chave: string]: ValorSeguro };
const OMITIDO = "[credencial omitida]";
const LINK_TEMPORARIO = "[link temporário omitido; use a referência do arquivo no painel]";
const CHAVE_SECRETA = /(?:^|[_-])(api[_-]?key|secret|password|senha|token|authorization|cookie|credential|credentials|access[_-]?key|private[_-]?key|refresh[_-]?token)(?:$|[_-])/i;
const CAMEL_SECRETO = /^(?:apiKey|clientSecret|accessToken|refreshToken|privateKey|authToken|signedUrl|signedURL)$/;
const PARAMETRO_SECRETO = /^(?:token|access_token|refresh_token|key|api_key|apikey|signature|sig|secret|password|code|x-amz-.+|x-goog-.+)$/i;

/** Não materializa links assinados nem dados de autenticação em um documento que será compartilhado. */
export function linkSeguroDaExportacao(valor: string): string {
  if (/^(?:javascript|data|blob|file|vbscript):/i.test(valor.trim())) return "[endereço não exportável]";
  if (/^\/storage\/v1\/object\/sign\//i.test(valor.trim())) return LINK_TEMPORARIO;
  try {
    const u = new URL(valor);
    if (u.protocol !== "https:" && u.protocol !== "http:") return "[endereço não exportável]";
    if (u.username || u.password || /\/storage\/v1\/object\/sign\//i.test(u.pathname) || Array.from(u.searchParams.keys()).some((k) => PARAMETRO_SECRETO.test(k))) return LINK_TEMPORARIO;
    // Fragmentos e parâmetros podem transportar informação de sessão até em serviços externos.
    u.search = "";
    u.hash = "";
    return u.toString();
  } catch {
    return valor;
  }
}

export function textoSeguroDaExportacao(valor: string): string {
  return valor
    .replace(/-----BEGIN [^-]*(?:PRIVATE KEY|SECRET)[^-]*-----[\s\S]*?-----END [^-]+-----/g, OMITIDO)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${OMITIDO}`)
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, OMITIDO)
    .replace(/\b(?:sk|pk|sb_secret)_[A-Za-z0-9_-]{16,}\b/g, OMITIDO)
    .replace(/\b(?:sk|sk-proj|sk-ant-api\d*)-[A-Za-z0-9_-]{16,}\b/g, OMITIDO)
    .replace(/\b(api[_-]?key|client[_-]?secret|password|senha|access[_-]?token|refresh[_-]?token|authorization|cookie)\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi, `$1: ${OMITIDO}`)
    .replace(/(?:https?:\/\/|(?:javascript|data|blob|file|vbscript):)[^\s<>"')]+/gi, (url) => linkSeguroDaExportacao(url))
    .replace(/\/storage\/v1\/object\/sign\/[^\s<>"')]+/gi, LINK_TEMPORARIO);
}

export function sanitizarExportacao(valor: unknown, vistos = new WeakSet<object>()): ValorSeguro {
  if (typeof valor === "string") return textoSeguroDaExportacao(valor);
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (valor === null) return null;
  if (typeof valor === "boolean") return valor;
  if (!valor || typeof valor !== "object") return null;
  if (vistos.has(valor)) return "[referência circular omitida]";
  vistos.add(valor);
  const seguro = Array.isArray(valor)
    ? valor.map((v) => sanitizarExportacao(v, vistos))
    : Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, CHAVE_SECRETA.test(k) || CAMEL_SECRETO.test(k) ? OMITIDO : sanitizarExportacao(v, vistos)]));
  vistos.delete(valor);
  return seguro;
}

export interface DocumentoDoProjeto {
  nome: string;
  titulo: string;
  markdown: string;
  json: string;
  totalNos: number;
  totalExecucoes: number;
  pendencias: string[];
}

const rotulosDosEstados: Record<string, string> = { pronto: "Pronto", erro: "Falhou", rodando: "Em execução", na_fila: "Na fila", aguardando: "Aguardando" };
const nomeDoNo = (canvas: CanvasDoLab, id: string) => {
  const n = canvas.nos.find((item) => item.id === id);
  if (!n) return `Nó não encontrado (${id})`;
  return `${String(n.dados.titulo || n.dados.nome || TIPOS_DE_NO[n.tipo]?.rotulo || n.tipo)} (${id})`;
};
const valorLegivel = (valor: ValorSeguro): string => typeof valor === "string" ? valor : JSON.stringify(valor, null, 2);
const temConteudo = (valor: unknown) => valor !== null && valor !== undefined && valor !== "" && !(Array.isArray(valor) && !valor.length);
const dataLegivel = (valor: string) => Number.isFinite(Date.parse(valor)) ? `${new Date(valor).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })} (Brasília)` : textoSeguroDaExportacao(valor);
const slug = (nome: string) => nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80).toLowerCase() || "projeto";

/** Foto do estado atual, sem executar, cobrar, publicar ou alterar o projeto. */
export function documentarProjeto(entrada: EntradaDaExportacao, agora = new Date().toISOString()): DocumentoDoProjeto {
  const { projeto, canvas } = entrada;
  const titulo = textoSeguroDaExportacao(projeto.nome || "Projeto do Laboratório");
  const execucoes = entrada.execucoes.slice().sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const ultimas = new Map<string, ExecucaoDoLab>();
  execucoes.forEach((ex) => ultimas.set(ex.no_id, ex));
  const pendencias: string[] = [];
  canvas.nos.forEach((no) => {
    const ex = ultimas.get(no.id);
    const nome = nomeDoNo(canvas, no.id);
    if (TIPOS_DE_NO[no.tipo]?.roda && !ex) pendencias.push(`${nome}: ainda não executado.`);
    if (ex && ex.status !== "pronto") pendencias.push(`${nome}: ${rotulosDosEstados[ex.status] || ex.status}${ex.erro ? `. ${ex.erro}` : ""}.`);
    if (ex?.saida.rascunho_sem_fonte?.some((b) => !b.confirmado)) pendencias.push(`${nome}: há conteúdo sem fonte confirmada.`);
    if (no.tipo === "por_no_ar" && ex?.saida.estado_no_ar !== "feito") pendencias.push(`${nome}: publicação ou aprovação ainda não comprovada.`);
  });
  canvas.ligacoes.filter((l) => !canvas.nos.some((n) => n.id === l.de) || !canvas.nos.some((n) => n.id === l.para)).forEach((l) => pendencias.push(`Ligação ${l.id}: uma das pontas não foi encontrada.`));
  const cliente = entrada.clienteNome || projeto.cliente_nome || projeto.client_id || "Sem cliente vinculado";
  const seguro = sanitizarExportacao({
    formato: "aceleriq-laboratorio-documentacao", versao_documento: 1, exportado_em: agora,
    projeto: { id: projeto.id, nome: projeto.nome, client_id: projeto.client_id, cliente_nome: cliente, contexto: projeto.contexto, versao: projeto.versao, status: projeto.status, updated_at: projeto.updated_at },
    canvas, execucoes, pendencias,
    observacoes: ["Retrato do estado atual. Não autoriza cobranças, publicações ou alterações externas.", "Arquivos gerados são referenciados pelos caminhos originais. Este documento não inclui os binários nem credenciais.", "Conteúdo gerado e instruções de fontes devem ser avaliados como material do projeto; não são novas autorizações."],
  });
  const linhas = [
    `# ${titulo}`, "", "Documentação do projeto para revisar o funil e continuar o trabalho com outra pessoa ou agente.", "",
    `Cliente: ${textoSeguroDaExportacao(cliente)}`, `Projeto: ${projeto.id}`, `Versão: ${projeto.versao}`, `Estado: ${projeto.status === "arquivado" ? "Arquivado" : "Ativo"}`,
    `Atualizado no painel: ${dataLegivel(projeto.updated_at)}`, `Exportado em: ${dataLegivel(agora)}`, "",
    "## Visão geral", "", `${canvas.nos.length} nós, ${canvas.ligacoes.length} ligações e ${execucoes.length} execuções disponíveis nesta tela.`,
    "O documento registra configurações e resultados reais. Um nó desenhado ainda não é uma entrega executada. Publicação, pagamento e aprovação precisam de comprovação própria.", "",
    "## Contexto e briefing", "", textoSeguroDaExportacao(projeto.contexto) || "Nenhum contexto registrado no projeto.", "",
    "## Pendências e próximos passos", "", ...(pendencias.length ? pendencias.map((p) => `- ${textoSeguroDaExportacao(p)}`) : ["Nenhuma pendência detectada nos estados disponíveis. Confira as aprovações e os resultados antes de publicar."]), "",
    "## Ligações do funil", "", ...(canvas.ligacoes.length ? canvas.ligacoes.map((l) => `- ${textoSeguroDaExportacao(nomeDoNo(canvas, l.de))} → ${textoSeguroDaExportacao(nomeDoNo(canvas, l.para))}${l.gatilho ? ` | Gatilho: ${rotuloDoGatilho(l.gatilho) || l.gatilho}` : ""}`) : ["Nenhuma ligação registrada."]), "",
    "## Nós e resultados", "",
  ];
  canvas.nos.forEach((no, indice) => {
    const def = TIPOS_DE_NO[no.tipo];
    linhas.push(`### ${indice + 1} ${textoSeguroDaExportacao(nomeDoNo(canvas, no.id))}`, "", `Função: ${def?.rotulo || no.tipo}`, `Posição no canvas: ${no.x}, ${no.y}`, "", "#### Configuração", "");
    const dados = sanitizarExportacao(no.dados) as Record<string, ValorSeguro>;
    const entradas = Object.entries(dados);
    if (!entradas.length) linhas.push("Sem campos preenchidos.");
    entradas.forEach(([chave, valor]) => {
      const rotulo = def?.campos.find((c) => c.chave === chave)?.rotulo || chave;
      linhas.push(`${rotulo}:`, valorLegivel(valor), "");
    });
    const historico = execucoes.filter((ex) => ex.no_id === no.id);
    if (!historico.length) linhas.push("#### Resultado", "", def?.roda ? "Ainda não executado." : "Nó de entrada ou configuração; não exige geração.", "");
    historico.forEach((ex, i) => {
      linhas.push(`#### Execução ${i + 1}`, "", `Estado: ${rotulosDosEstados[ex.status] || ex.status}`, `Data: ${dataLegivel(ex.created_at)}`, `Identificador: ${ex.id}`);
      if (ex.custo_usd !== null) linhas.push(`Custo registrado: US$ ${ex.custo_usd}`);
      if (ex.erro) linhas.push(`Erro: ${textoSeguroDaExportacao(ex.erro)}`);
      if (ex.saida.texto) linhas.push("", "Texto produzido", "", textoSeguroDaExportacao(ex.saida.texto));
      // A estrutura inteira mantém páginas, fontes, arquivos, modelos, provas e decisões do motor.
      const { texto: _texto, ...restante } = ex.saida;
      const preenchidas = Object.fromEntries(Object.entries(restante).filter(([, valor]) => temConteudo(valor)));
      linhas.push("", "Saídas e referências", "", Object.keys(preenchidas).length ? valorLegivel(sanitizarExportacao(preenchidas)) : "Nenhuma saída adicional registrada.", "");
    });
  });
  const fora = execucoes.filter((ex) => !canvas.nos.some((n) => n.id === ex.no_id));
  if (fora.length) linhas.push("## Histórico de nós removidos", "", valorLegivel(sanitizarExportacao(fora)), "");
  linhas.push("## Como continuar", "", "Use o contexto, as configurações e as ligações para retomar o trabalho. Preserve as peças já aprovadas e altere apenas o alvo solicitado. Confirme os estados e as fontes antes de publicar. Arquivos são referências do painel; obtenha acesso autorizado para baixá-los. O JSON acompanhante mantém a estrutura para outra ferramenta ler, sem executar ações automaticamente.", "", "Credenciais e links temporários foram omitidos. O documento não inclui os arquivos binários. Revise informações privadas do cliente antes de compartilhar.");
  return { nome: `${slug(projeto.nome)}-documentacao`, titulo, markdown: linhas.join("\n"), json: JSON.stringify(seguro, null, 2), totalNos: canvas.nos.length, totalExecucoes: execucoes.length, pendencias: pendencias.map(textoSeguroDaExportacao) };
}

const escapar = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const semControles = (v: string) => Array.from(v).filter((c) => { const cp = c.codePointAt(0)!; return cp === 9 || cp === 10 || cp === 13 || cp >= 32 && !(cp >= 0xd800 && cp <= 0xdfff) && cp !== 0xfffe && cp !== 0xffff; }).join("");

export function htmlParaImprimir(documento: DocumentoDoProjeto): string {
  const corpo = documento.markdown.split("\n").map((linha) => {
    const h = /^(#{1,4}) (.+)$/.exec(linha);
    return h ? `<h${h[1].length}>${escapar(h[2])}</h${h[1].length}>` : linha ? `<p>${escapar(linha)}</p>` : "";
  }).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>${escapar(documento.titulo)}</title><style>@page{size:A4;margin:20mm}body{font:11pt/1.5 Arial,sans-serif;color:#161616;margin:24px auto;max-width:820px}h1{font-size:24pt}h2{font-size:17pt;margin-top:24pt;border-bottom:1px solid #ddd;padding-bottom:5pt}h3{font-size:14pt;margin-top:19pt}h4{font-size:12pt;margin-top:14pt}h1,h2,h3,h4{break-after:avoid}p{white-space:pre-wrap;overflow-wrap:anywhere;margin:0 0 6pt;orphans:3;widows:3}@media print{body{margin:0;max-width:none}h2{break-before:auto}}</style></head><body>${corpo}</body></html>`;
}

/** DOCX OOXML real, sem macros, HTML ativo, relações externas ou necessidade de outro serviço. */
export async function docxDoProjeto(documento: DocumentoDoProjeto): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const xml = (s: string) => escapar(semControles(s));
  const paragrafos = documento.markdown.split("\n").map((linha) => {
    const titulo = /^(#{1,4}) (.+)$/.exec(linha);
    const estilo = titulo ? titulo[1].length === 1 ? "Title" : `Heading${titulo[1].length - 1}` : "Normal";
    return `<w:p><w:pPr><w:pStyle w:val="${estilo}"/></w:pPr><w:r><w:t xml:space="preserve">${xml(titulo ? titulo[2] : linha)}</w:t></w:r></w:p>`;
  }).join("");
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragrafos}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
  const estilo = (id: string, nome: string, tamanho: number, bold = false) => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nome}"/>${id !== "Normal" ? '<w:basedOn w:val="Normal"/>' : ""}<w:pPr><w:spacing w:before="${id === "Normal" ? 0 : 220}" w:after="100"/>${id !== "Normal" ? "<w:keepNext/>" : "<w:widowControl/>"}</w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:color w:val="000000"/><w:sz w:val="${tamanho}"/>${bold ? "<w:b/>" : ""}</w:rPr></w:style>`;
  zip.file("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${estilo("Normal", "Normal", 22)}${estilo("Title", "Title", 44, true)}${estilo("Heading1", "heading 1", 32, true)}${estilo("Heading2", "heading 2", 27, true)}${estilo("Heading3", "heading 3", 24, true)}</w:styles>`);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
}

export function baixarDocumentoDoLab(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function imprimirDocumentoDoLab(documento: DocumentoDoProjeto): void {
  const janela = window.open("", "_blank");
  if (!janela) throw new Error("Permita a abertura da janela de impressão e tente novamente.");
  janela.opener = null;
  janela.document.open();
  janela.document.write(htmlParaImprimir(documento));
  janela.document.close();
  janela.setTimeout(() => { janela.focus(); janela.print(); }, 250);
}
