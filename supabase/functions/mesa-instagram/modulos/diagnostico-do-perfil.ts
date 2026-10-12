/**
 * Diagnóstico do perfil em 9 partes (12/10/2026, a partir da skill ig-profile-optimizer).
 *
 * Cada parte sai com um estado (passa, melhorar, falha, não lido), o porquê e como corrigir, e diz de
 * onde veio a leitura:
 * - código: tamanho do nome e do @, link que abre ou não, formatos repetidos na grade;
 * - Jev: bio (as mesmas perguntas da análise da bio), nome com palavra de busca, @ fácil de lembrar e
 *   categoria da página que bate com o negócio (julgamento sobre texto, nunca prompt-e-parse);
 * - visão: foto do perfil e grade, olhadas por um modelo de imagem com resposta em esquema fechado;
 * - painel: destaques e fixados não existem na API do Instagram. O diagnóstico diz o que o painel
 *   sabe (capas prontas, os 3 posts que mais renderam para fixar) e marca "confira no app".
 * Puro: a função mesa-instagram faz as leituras e grava o resultado no plano da conta.
 */

import { caracteres, LIMITES_DO_PERFIL, perguntasDaBio, type PerguntaJev, type RespostaJev, type SinaisDaBio, type VereditoDaBio } from "./conhecimento-perfil-instagram.ts";

export type ParteDoPerfil = "foto" | "nome" | "usuario" | "bio" | "link" | "categoria" | "destaques" | "fixados" | "grade";
export type EstadoDaParte = "passa" | "melhorar" | "falha" | "nao_lido";
export type FonteDaParte = "codigo" | "jev" | "visao" | "painel";

export type LinhaDoDiagnostico = {
  parte: ParteDoPerfil;
  rotulo: string;
  estado: EstadoDaParte;
  detalhe: string;
  como_corrigir: string;
  fonte: FonteDaParte;
};

export type DiagnosticoDoPerfil = {
  versao: string;
  username: string;
  linhas: LinhaDoDiagnostico[];
  resumo: { passa: number; melhorar: number; falha: number; nao_lido: number; nota: number | null };
  /** Os posts que mais renderam (múltiplo do perfil), para fixar no topo. */
  para_fixar: Array<{ link: string | null; multiplo: string; legenda: string }>;
  gerado_em: string;
};

export const VERSAO_DO_DIAGNOSTICO = "2026-10-12.1";

export const ORDEM_DAS_PARTES: Array<{ parte: ParteDoPerfil; rotulo: string }> = [
  { parte: "foto", rotulo: "Foto do perfil" },
  { parte: "nome", rotulo: "Nome" },
  { parte: "usuario", rotulo: "@ do perfil" },
  { parte: "bio", rotulo: "Bio" },
  { parte: "link", rotulo: "Link" },
  { parte: "categoria", rotulo: "Categoria" },
  { parte: "destaques", rotulo: "Destaques" },
  { parte: "fixados", rotulo: "Posts fixados" },
  { parte: "grade", rotulo: "Grade" },
];
const rotulo = (p: ParteDoPerfil) => (ORDEM_DAS_PARTES.find((x) => x.parte === p) as { rotulo: string }).rotulo;
const linha = (parte: ParteDoPerfil, estado: EstadoDaParte, fonte: FonteDaParte, detalhe: string, como_corrigir = ""): LinhaDoDiagnostico => ({ parte, rotulo: rotulo(parte), estado, detalhe, como_corrigir, fonte });

// ------------------------------------------------------------------ Jev: as perguntas do texto

/** As perguntas da bio e mais as do @ e da categoria, numa chamada só. */
export function perguntasDoDiagnostico(temContexto: boolean, temCategoria: boolean): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {
    ...perguntasDaBio(temContexto),
    usuario_facil: {
      type: "noul",
      instructions:
        "Leia `perfil.username` (o @) e `perfil.nome`. Alguém que ouviu o nome do negócio uma vez consegue digitar este @ de cabeça, sem números soltos, pontos e sublinhados demais ou letras trocadas, e ele lembra a marca?",
    },
  };
  if (temCategoria) {
    q.categoria_certa = {
      type: "noul",
      instructions: "A `perfil.categoria` (a categoria da página ligada ao perfil) descreve o serviço ou produto principal do `negocio`, e não um ramo genérico ou errado?",
    };
  }
  return q;
}

const numero = (v: unknown): number | null => (typeof v === "number" && isFinite(v) ? v : null);

// ------------------------------------------------------------------ código: as partes de texto

export type LinkConferido = { estado: "abre" | "recusou" | "nao_abre" | "sem_link"; status: number | null };

/** Confere se o link abre (GET com redirecionamento, 8 s). 401/403/429 é site que recusa robô: não é falha. */
export async function conferirLink(url: string, buscar: typeof fetch = fetch): Promise<LinkConferido> {
  const u = String(url || "").trim();
  if (!u) return { estado: "sem_link", status: null };
  const alvo = /^https?:\/\//i.test(u) ? u : `https://${u}`;
  try {
    const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(8000) : undefined;
    const r = await buscar(alvo, { redirect: "follow", signal, headers: { "user-agent": "Mozilla/5.0 (Aceleriq conferencia de link)" } });
    await r.body?.cancel().catch(() => {});
    if (r.status < 400) return { estado: "abre", status: r.status };
    if (r.status === 401 || r.status === 403 || r.status === 429) return { estado: "recusou", status: r.status };
    return { estado: "nao_abre", status: r.status };
  } catch {
    return { estado: "nao_abre", status: null };
  }
}

/** @ com cara de difícil: número solto de 3 ou mais dígitos, ou mais de 2 pontos e sublinhados. */
export function usuarioDificil(username: string): string | null {
  const u = String(username || "");
  if (/\d{3,}/.test(u)) return "tem uma sequência de números";
  if ((u.match(/[._]/g) || []).length > 2) return "tem pontos e sublinhados demais";
  return null;
}

export type EntradaDoTexto = {
  perfil: { nome: string; username: string; bio: string; site: string };
  sinais: SinaisDaBio;
  veredito: VereditoDaBio;
  respostas: Record<string, RespostaJev> | null;
  link: LinkConferido;
  /** Categoria da página do Facebook ligada (a API do Instagram não devolve a do perfil). */
  categoria: string | null;
};

export function linhasDoTexto(e: EntradaDoTexto): LinhaDoDiagnostico[] {
  const r = e.respostas || {};
  const l: LinhaDoDiagnostico[] = [];

  const nome = e.perfil.nome.trim();
  const nNome = caracteres(nome);
  if (!nome) l.push(linha("nome", "falha", "codigo", "O campo Nome está vazio.", "Use a marca e o serviço, até 30 caracteres. Ex.: \"Clínica Sorriso | Dentista\"."));
  else if (nNome > LIMITES_DO_PERFIL.nome) l.push(linha("nome", "melhorar", "codigo", `${nNome} caracteres: corta em algumas telas (o seguro é ${LIMITES_DO_PERFIL.nome}).`, "Encurte para caber em 30 caracteres, mantendo a palavra de busca."));
  else if (e.veredito.nome_pode_melhorar) l.push(linha("nome", "melhorar", "jev", `"${nome}" não tem a palavra que o cliente digita na busca.`, "O Nome entra na busca do Instagram: junte à marca o serviço ou a cidade."));
  else if (e.veredito.sinais.nome_busca === null) l.push(linha("nome", "nao_lido", "codigo", `"${nome}" (${nNome} caracteres). O Jev não respondeu para julgar a busca.`));
  else l.push(linha("nome", "passa", "jev", `"${nome}" tem palavra de busca e cabe na tela.`));

  const user = e.perfil.username.trim();
  const dificil = usuarioDificil(user);
  const facil = numero(r.usuario_facil && r.usuario_facil.noul);
  if (!user) l.push(linha("usuario", "nao_lido", "codigo", "O @ não foi lido."));
  else if (dificil) l.push(linha("usuario", "melhorar", "codigo", `@${user} ${dificil}.`, "Um @ que se fala em voz alta: a marca, sem números soltos. Trocar o @ muda o link do perfil; avise o cliente antes."));
  else if (facil !== null && facil < 0.4) l.push(linha("usuario", "melhorar", "jev", `@${user} é difícil de digitar de cabeça ou não lembra a marca.`, "Aproxime o @ do nome da marca. Trocar o @ muda o link do perfil; avise o cliente antes."));
  else l.push(linha("usuario", facil === null ? "nao_lido" : "passa", facil === null ? "codigo" : "jev", facil === null ? `@${user}: o Jev não respondeu para julgar.` : `@${user} é fácil de lembrar.`));

  const v = e.veredito;
  const duro = e.sinais.vazia || e.sinais.passouDoLimite || (v.sinais.faz !== null && (v.sinais.faz as number) < 1.5);
  const motivos = v.motivos.map((m) => m.texto).join(" ");
  if (v.sem_jev && !duro) l.push(linha("bio", "nao_lido", "codigo", `${e.sinais.caracteres} de ${LIMITES_DO_PERFIL.bio} caracteres. ${motivos}`));
  else if (duro) l.push(linha("bio", "falha", "jev", motivos || "A bio não diz o que o negócio faz.", "Use \"Bio e nome\" para gerar 3 bios e escolher a melhor."));
  else if (v.boa) l.push(linha("bio", "passa", "jev", `Está boa${v.pontos_fortes.length ? `: ${v.pontos_fortes.join(", ")}` : ""}.`));
  else l.push(linha("bio", "melhorar", "jev", motivos, "Use \"Bio e nome\" para gerar 3 bios e escolher a melhor."));

  const site = e.perfil.site.trim();
  if (e.link.estado === "sem_link") l.push(linha("link", "falha", "codigo", "O perfil está sem link.", "Ponha o WhatsApp (wa.me), a agenda ou o site: é o único lugar clicável do perfil."));
  else if (e.link.estado === "nao_abre") l.push(linha("link", "falha", "codigo", `${site} não abriu${e.link.status ? ` (erro ${e.link.status})` : ""}.`, "Troque o link por um que funcione e teste no celular."));
  else if (e.link.estado === "recusou") l.push(linha("link", "melhorar", "codigo", `${site} recusou a conferência automática (${e.link.status}).`, "Abra no celular e confira se carrega rápido."));
  else l.push(linha("link", "passa", "codigo", `${site} abre.`));

  const cat = (e.categoria || "").trim();
  const certa = numero(r.categoria_certa && r.categoria_certa.noul);
  if (!cat) l.push(linha("categoria", "nao_lido", "painel", "A API do Instagram não mostra a categoria do perfil, e não há página do Facebook ligada.", "Confira no app (Editar perfil, Categoria): a mais específica do serviço principal."));
  else if (certa !== null && certa < 0.4) l.push(linha("categoria", "melhorar", "jev", `"${cat}" (da página ligada) não descreve o serviço principal.`, "Troque pela categoria mais específica do serviço, na página e no perfil."));
  else l.push(linha("categoria", certa === null ? "nao_lido" : "passa", certa === null ? "painel" : "jev", certa === null ? `"${cat}" (da página ligada); o Jev não respondeu.` : `"${cat}" (da página ligada) bate com o negócio.`));
  return l;
}

// ------------------------------------------------------------------ visão: foto e grade

export const SISTEMA_DA_VISAO = `Você confere o perfil do Instagram de um negócio brasileiro para a agência Aceleriq. Recebe a foto do perfil (a primeira imagem) e as capas dos últimos posts na ordem da grade (as seguintes). Julgue só o que está nas imagens; nada de elogio genérico.
FOTO: aparece num círculo pequeno. Passa quando a logo ou o rosto está centralizado, legível nesse tamanho, com contraste com o fundo e sem texto miúdo. Falha quando está cortada, ilegível, em branco ou é uma imagem genérica.
GRADE: quem chega olha os 9 primeiros como um conjunto. Passa quando há coerência de cor e de tratamento, variedade de tipo (prova, bastidor, oferta, educativo), sem a mesma arte lado a lado, com texto e rosto no centro (a grade corta as beiradas em 3:4). Falha quando parece de marcas diferentes, repete a mesma arte ou não diz para quem é.
estado: passa, melhorar ou falha. detalhe: o que você viu, específico (cores, posição, o que se repete), até 2 frases. como_corrigir: uma ação concreta, até 2 frases. Sem travessão.`;

const PARTE_DA_VISAO = {
  type: "object",
  additionalProperties: false,
  required: ["estado", "detalhe", "como_corrigir"],
  properties: { estado: { type: "string", enum: ["passa", "melhorar", "falha"] }, detalhe: { type: "string" }, como_corrigir: { type: "string" } },
} as const;

export const ESQUEMA_DA_VISAO = {
  nome: "diagnostico_visual_do_perfil",
  schema: { type: "object", additionalProperties: false, required: ["foto", "grade"], properties: { foto: PARTE_DA_VISAO, grade: PARTE_DA_VISAO } },
} as const;

const limpo = (v: unknown, max: number) => String(v ?? "").replace(/[–—]/g, ",").replace(/\s+/g, " ").trim().slice(0, max);

/** Lê a resposta da visão; parte faltando ou fora do esquema vira "não lido". */
export function linhasDaVisao(bruto: unknown, temFoto: boolean, temGrade: boolean): LinhaDoDiagnostico[] {
  const j = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, { estado?: unknown; detalhe?: unknown; como_corrigir?: unknown } | undefined>;
  const ler = (parte: "foto" | "grade", tem: boolean, semImagem: string): LinhaDoDiagnostico => {
    const x = j[parte];
    if (!tem) return linha(parte, "nao_lido", "visao", semImagem);
    if (!x || (x.estado !== "passa" && x.estado !== "melhorar" && x.estado !== "falha")) return linha(parte, "nao_lido", "visao", "A leitura da imagem não voltou agora. Peça o diagnóstico de novo.");
    return linha(parte, x.estado, "visao", limpo(x.detalhe, 300), x.estado === "passa" ? "" : limpo(x.como_corrigir, 300));
  };
  return [ler("foto", temFoto, "A foto do perfil não abriu."), ler("grade", temGrade, "Menos de 3 posts com imagem para olhar a grade.")];
}

/** O código também olha a grade: o mesmo formato 3 vezes seguidas nos 9 primeiros. */
export function formatoRepetido(formatos: string[]): string | null {
  const nove = formatos.slice(0, 9);
  for (let i = 2; i < nove.length; i++) if (nove[i] && nove[i] === nove[i - 1] && nove[i] === nove[i - 2]) return nove[i];
  return null;
}

// ------------------------------------------------------------------ painel: destaques e fixados

export function linhasDoPainel(capasProntas: number, paraFixar: DiagnosticoDoPerfil["para_fixar"]): LinhaDoDiagnostico[] {
  const destaques = capasProntas >= 4
    ? linha("destaques", "nao_lido", "painel", `A API do Instagram não mostra os destaques. No painel há ${capasProntas} capas prontas.`, "Confira no app se as capas estão publicadas, de 4 a 6, na ordem de quem chega.")
    : linha("destaques", "nao_lido", "painel", `A API do Instagram não mostra os destaques. No painel há ${capasProntas} ${capasProntas === 1 ? "capa pronta" : "capas prontas"}.`, "Monte de 4 a 6 destaques na aba Destaques (quem somos, serviços, prova, como comprar).");
  const fixados = paraFixar.length
    ? linha("fixados", "nao_lido", "painel", `A API não diz o que está fixado. Os que mais renderam: ${paraFixar.map((p) => p.multiplo).join("; ")}.`, "Fixe até 3 no topo: os que mais renderam, a prova e a oferta principal.")
    : linha("fixados", "nao_lido", "painel", "A API não diz o que está fixado, e ainda não há posts medidos para sugerir.", "Fixe até 3 no topo: a prova mais forte, a oferta principal e um depoimento.");
  return [destaques, fixados];
}

// ------------------------------------------------------------------ juntar

/** Junta as partes na ordem das 9 e calcula o resumo. Nota: passa 1, melhorar 0,5, falha 0 (sem contar o não lido). */
export function montarDiagnostico(username: string, partes: LinhaDoDiagnostico[], paraFixar: DiagnosticoDoPerfil["para_fixar"], agora: Date = new Date()): DiagnosticoDoPerfil {
  const linhas = ORDEM_DAS_PARTES.map(({ parte }) => partes.find((p) => p.parte === parte) || linha(parte, "nao_lido", "codigo", "Não lido."));
  const conta = (e: EstadoDaParte) => linhas.filter((x) => x.estado === e).length;
  const lidas = linhas.filter((x) => x.estado !== "nao_lido");
  const nota = lidas.length ? Math.round((lidas.reduce((s, x) => s + (x.estado === "passa" ? 1 : x.estado === "melhorar" ? 0.5 : 0), 0) / lidas.length) * 100) : null;
  return { versao: VERSAO_DO_DIAGNOSTICO, username, linhas, resumo: { passa: conta("passa"), melhorar: conta("melhorar"), falha: conta("falha"), nao_lido: conta("nao_lido"), nota }, para_fixar: paraFixar, gerado_em: agora.toISOString() };
}

/** O diagnóstico em texto curto para os agentes (conversa das redes e Hermes). */
export function blocoDoDiagnostico(d: DiagnosticoDoPerfil | null): string {
  if (!d || !Array.isArray(d.linhas)) return "";
  const pend = d.linhas.filter((x) => x.estado === "falha" || x.estado === "melhorar");
  if (!pend.length) return `DIAGNÓSTICO DO PERFIL (${d.gerado_em.slice(0, 10)}): as partes lidas passaram.`;
  return [`DIAGNÓSTICO DO PERFIL (${d.gerado_em.slice(0, 10)}, nota ${d.resumo.nota ?? "-"}):`, ...pend.map((x) => `- ${x.rotulo}: ${x.estado === "falha" ? "falha" : "melhorar"}. ${x.detalhe}${x.como_corrigir ? ` Corrigir: ${x.como_corrigir}` : ""}`)].join("\n");
}
