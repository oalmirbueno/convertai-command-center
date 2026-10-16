import { destinoDaEvidencia } from "./execucaoApresentacao";

const UUID = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
export type AnexoDoCaderno = { name?: string; url?: string };

/** Projeção legível do histórico; o registro original permanece intacto. */
export function prepararEntrada(body: string, attachments: AnexoDoCaderno[] = []) {
  const anexos = new Map<string, AnexoDoCaderno>();
  for (const a of attachments) if (a.url && destinoDaEvidencia(a.url)) anexos.set(a.url, a);
  let texto = body.replace(new RegExp(`(?:aceleriq-file:\\/\\/|\\bfile_id\\s*[:=]\\s*[\x60"']?)(${UUID})`, "gi"), (_match, id: string) => {
    const url = `aceleriq-file://${id}`;
    if (!anexos.has(url)) anexos.set(url, { name: "Arquivo da execução", url });
    return "arquivo anexado";
  });
  texto = texto.replace(/\b(?:sha256|hash)\s*[:=]\s*[a-f0-9]{32,64}\b/gi, "integridade registrada");
  texto = texto.replace(new RegExp(UUID, "gi"), "registro vinculado");
  // Caminhos do servidor não são links públicos. O original continua disponível.
  texto = texto.replace(/\/root\/[^\s;,]+/g, "arquivo técnico no servidor");
  texto = texto.replace(/\bsnapshot\d{8}T\d+\b/gi, "coleta identificada");
  // Corrige palavras coladas a quantidades, sem alterar URLs, datas ou códigos.
  texto = texto.replace(/(^|[\s,:;])(de|com|e|carteira)(\d+)/gi, "$1$2 $3");
  if (!/[\n]|^\s*[#>*-]/m.test(texto)) {
    texto = texto.replace(/([.!?])\s+(?=[A-ZÀ-Ú])/g, "$1\n\n");
  }
  return { texto, anexos: [...anexos.values()], temDetalhes: texto !== body };
}

export function tituloDoCaderno(title?: string | null) {
  return (title || "Atualização do trabalho").replace(new RegExp(UUID, "gi"), "registro vinculado");
}

export function incluirConcluidas(visao: string, mostrarEncerradas: boolean) {
  return mostrarEncerradas || visao === "done";
}

/**
 * 16/10/2026 (dono: "ter tudo formatado, claro e simples, e não montar questão com códigos"):
 * leitura para gente. Tira ids, chave=valor, versões e caminhos (antes viravam "registro vinculado"
 * colado na palavra), separa os blocos que os agentes escrevem em maiúsculas ("CONCLUÍDAS:",
 * "AVANÇOS:", "PRÓXIMO PASSO:") e devolve um resumo curto. O registro original fica guardado.
 */
export type TomDaSecao = "feito" | "andamento" | "proximo" | "travado" | "nota";
export type SecaoDaLeitura = { rotulo: string; texto: string; tom: TomDaSecao };
export type LeituraSimples = { resumo: string; secoes: SecaoDaLeitura[]; temMais: boolean };

export function limparTecnico(texto: string): string {
  let t = texto;
  t = t.replace(new RegExp(`(?:aceleriq-file:\\/\\/|\\bfile_id\\s*[:=]\\s*[\x60"']?)${UUID}`, "gi"), "");
  t = t.replace(new RegExp(`[A-Za-zÀ-ú_]{0,24}\\s*[:=]?\\s*${UUID}(?:\\s*v\\d+)?`, "gi"), (m) => {
    // "Cliente4dd6..." ou "projeto=4dd6..." somem inteiros; "do 4dd6..." perde só o id.
    const palavra = m.match(/^[\wÀ-ú]+/)?.[0] || "";
    return /^(do|da|de|no|na|o|a|em|e)$/i.test(palavra) ? `${palavra} ` : "";
  });
  t = t.replace(new RegExp(UUID, "gi"), "");
  t = t.replace(/\b(?:sha256|hash)\s*[:=]\s*[a-f0-9]{32,64}\b/gi, "");
  t = t.replace(/\b[a-z][a-z0-9]*_[a-z0-9_]+\s*=\s*[^\s;,)]+/gi, "");
  t = t.replace(/\b[a-z]+=(?:true|false|null|\d+)\b/gi, "");
  t = t.replace(/\/root\/[^\s;,]+/g, "");
  // Resto de endereço interno sem o id ("aceleriq-file://", "internal/ready/v1") não diz nada a quem lê.
  t = t.replace(/(?:aceleriq-file|mcp-files|files):\/\/\S*/gi, "arquivo anexado").replace(/[a-z_]+\/[a-z_]+\/v\d+/g, "");
  t = t.replace(/\bsnapshot\d{8}T\d+\b/gi, "");
  t = t.replace(/\b\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z?\b/g, "$1");
  t = t.replace(/\b(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z\b/g, "$1");
  t = t.replace(/(^|[\s,:;])(de|com|e|carteira|total|retornou)(\d+)/gi, "$1$2 $3");
  // Palavras de status em inglês e palavras coladas em número ("published12:33Z", "projeto09-15/10"),
  // sem mexer dentro de links.
  t = t.replace(/([a-zà-ú])(https?:\/\/)/gi, "$1 $2");
  t = t.split(/(https?:\/\/\S+)/).map((parte, i) => i % 2 ? parte : parte
    .replace(/([a-zà-ú]{3,})(\d)/g, "$1 $2")
    .replace(/\b(\d{1,2}(?::\d{2})?)Z\b/g, "$1")
    .replace(/\b[a-z]+_[a-z_]+\b/g, "")
    .replace(/\bagency approved\b/gi, "aprovado pela agência")
    .replace(/\bapproved\b/gi, "aprovado").replace(/\bscheduled\b/gi, "agendado").replace(/\bpublished\b/gi, "publicado")
    .replace(/\bdone\b/gi, "feito").replace(/\bpending\b/gi, "pendente").replace(/\bfailed\b/gi, "falhou"),
  ).join("");
  t = t.replace(/(^|[^.])\.\.(?!\.)/g, "$1.");
  t = t.replace(/\(\s*\)/g, "").replace(/\s+([;,.:])/g, "$1").replace(/([;,])\s*(?=[;,.])/g, "").replace(/[ \t]{2,}/g, " ");
  return t.replace(/(^|\n)\s*[;,]\s*/g, "$1").trim();
}

const TOM_DO_ROTULO: Array<[RegExp, TomDaSecao]> = [
  [/CONCLU|FEIT|ENTREG|PRONT/, "feito"],
  [/AVAN|ANDAMENTO|FAZENDO|EM CURSO|PROGRESS/, "andamento"],
  [/PR[OÓ]XIM|SEGUINTE|A FAZER|PLANO/, "proximo"],
  [/BLOQ|PEND[EÊ]N|RISCO|TRAV|IMPED|FALTA|AGUARD/, "travado"],
];

export function leituraSimples(body: string): LeituraSimples {
  const limpo = limparTecnico(body || "");
  const rotulo = /(?:^|[\s.;])([A-ZÁÉÍÓÚÂÊÔÃÕÇ]{4,}(?:\s[A-ZÁÉÍÓÚÂÊÔÃÕÇ]{2,}){0,3})\s*:\s*/g;
  const marcas: Array<{ rotulo: string; inicio: number; fim: number }> = [];
  for (const m of limpo.matchAll(rotulo)) marcas.push({ rotulo: m[1], inicio: m.index! + m[0].indexOf(m[1]), fim: m.index! + m[0].length });
  const antes = (marcas[0] ? limpo.slice(0, marcas[0].inicio) : limpo).trim();
  const secoes: SecaoDaLeitura[] = marcas.map((m, i) => {
    const texto = limpo.slice(m.fim, marcas[i + 1]?.inicio ?? limpo.length).trim().replace(/^[;,.]\s*/, "");
    const tom = TOM_DO_ROTULO.find(([re]) => re.test(m.rotulo))?.[1] || "nota";
    const nome = m.rotulo.charAt(0) + m.rotulo.slice(1).toLowerCase();
    return { rotulo: nome, texto, tom };
  }).filter((s) => s.texto);
  const base = antes || secoes[0]?.texto || "";
  // Sem lookbehind: o painel ainda roda em Safari 11 (ver aceleriq-compat-iphone-antigo).
  const frases = base.replace(/([.!?])\s+/g, "$1\u0001").split("\u0001").filter(Boolean);
  let resumo = "";
  for (const f of frases) { if ((resumo + " " + f).length > 240 && resumo) break; resumo = `${resumo} ${f}`.trim(); }
  if (!resumo) resumo = base.slice(0, 240);
  const temMais = secoes.length > 0 || base.length > resumo.length + 2;
  return { resumo, secoes, temMais };
}
