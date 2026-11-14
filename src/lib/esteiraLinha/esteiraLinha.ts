/**
 * Esteira em linha do tempo (fase 1, 14/11/2026): regras puras.
 *
 * Não confundir com a Esteira do Ciclo (src/lib/esteira/, rota /ciclo), que é
 * a lista da semana de cada cliente. Aqui a tela é uma grade só de leitura:
 * os dias em cima, uma faixa por cliente e um cartão por peça, com a etapa em
 * que ela está. Nada neste arquivo toca o banco; a leitura mora em
 * esteiraLinhaFatos.ts e a tela usa as mesmas contas dos testes.
 */

import { dataEmSP, diaDaSemanaDaData, ehDiaUtil, nomeDoDia } from "@/lib/diaPrioritario";

export type EtapaDaPeca = "pauta" | "arte" | "revisao" | "aprovacao" | "agendado" | "no_ar";

/** Ordem do caminho da peça, do começo ao fim (a legenda segue esta ordem). */
export const ETAPAS_DA_ESTEIRA: Array<{ etapa: EtapaDaPeca; rotulo: string; descricao: string }> = [
  { etapa: "pauta", rotulo: "Pauta", descricao: "tem tarefa ou rascunho, ainda sem arte" },
  { etapa: "arte", rotulo: "Arte", descricao: "em produção no Estúdio ou com arquivo" },
  { etapa: "revisao", rotulo: "Revisão", descricao: "aguardando a agência" },
  { etapa: "aprovacao", rotulo: "Aprovação", descricao: "com o cliente ou já aprovado" },
  { etapa: "agendado", rotulo: "Agendado", descricao: "com data e hora para sair" },
  { etapa: "no_ar", rotulo: "No ar", descricao: "publicado" },
];

export interface PublicacaoDaPeca {
  status: string | null;
  scheduled_at: string | null;
  published_at: string | null;
  permalink?: string | null;
}

/** Aprovação de um arquivo ligado à peça (files.approval_status e files.agency_approval_status). */
export interface ArquivoDaPeca {
  approval_status: string | null;
  agency_approval_status: string | null;
}

export interface PecaFato {
  /** Estável por peça: `post:<id>` quando há post, senão `task:<id>`. */
  chave: string;
  clientId: string;
  titulo: string;
  /** editorial_posts.content_type (ou o equivalente do tipo de entrega da tarefa). */
  contentType: string | null;
  post: {
    id: string;
    production_status: string | null;
    archived_at: string | null;
    temArquivo: boolean;
  } | null;
  /** Só as publicações do post; as canceladas são ignoradas pelas regras. */
  publicacoes: PublicacaoDaPeca[];
  tarefa: { id: string; status: string | null; due_date: string | null } | null;
  trabalho: { status: string | null; entrega_status: string | null; temArquivo: boolean } | null;
  arquivos: ArquivoDaPeca[];
}

export interface EtapaDecidida {
  etapa: EtapaDaPeca;
  /** Texto do cartão: distingue, por exemplo, "Aguardando o cliente" de "Aprovado". */
  rotulo: string;
}

const publicacoesVivas = (peca: PecaFato) => peca.publicacoes.filter((p) => p.status !== "cancelled");

/** Peça arquivada ou cancelada não aparece na Esteira. */
export function pecaEstaForaDaEsteira(peca: PecaFato): boolean {
  if (peca.post) {
    if (peca.post.archived_at) return true;
    return peca.post.production_status === "cancelled" || peca.post.production_status === "archived";
  }
  if (peca.tarefa) return peca.tarefa.status === "cancelled" || peca.tarefa.status === "archived";
  return true;
}

/**
 * A etapa atual: a mais avançada que os fatos sustentam, avaliada do fim para
 * o começo. Devolve null para peça arquivada ou cancelada.
 *
 * Revisão só aparece com sinal real (agência com a aprovação pendente); a
 * fase 1 não tem carimbo de quem revisou e não inventa "revisão interna".
 * No mesmo arquivo a agência vem antes do cliente (Double-Gate): com a
 * agência ainda pendente, a peça fica em Revisão mesmo que o pedido ao
 * cliente já esteja aberto.
 */
export function decidirEtapa(peca: PecaFato): EtapaDecidida | null {
  if (pecaEstaForaDaEsteira(peca)) return null;
  const publicacoes = publicacoesVivas(peca);
  if (publicacoes.some((p) => p.status === "published")) return { etapa: "no_ar", rotulo: "No ar" };
  if (publicacoes.some((p) => p.status === "scheduled")) return { etapa: "agendado", rotulo: "Agendado" };

  const entrega = peca.trabalho?.entrega_status ?? null;
  const agenciaPendente = (a: ArquivoDaPeca) => a.agency_approval_status === "pending";
  const reprovado =
    entrega === "reprovado" ||
    peca.arquivos.some((a) => a.approval_status === "rejected" || a.agency_approval_status === "rejected");

  if (!reprovado) {
    if (entrega === "aguardando_cliente" || peca.arquivos.some((a) => a.approval_status === "pending" && !agenciaPendente(a))) {
      return { etapa: "aprovacao", rotulo: "Aguardando o cliente" };
    }
    if (entrega === "aguardando_agencia" || peca.arquivos.some(agenciaPendente)) {
      return { etapa: "revisao", rotulo: "Revisão da agência" };
    }
    if (entrega === "aprovado" || peca.arquivos.some((a) => a.approval_status === "approved")) {
      return { etapa: "aprovacao", rotulo: "Aprovado" };
    }
  }

  const temArte =
    Boolean(peca.trabalho) || Boolean(peca.post?.temArquivo) || peca.post?.production_status === "production";
  if (temArte) return { etapa: "arte", rotulo: reprovado ? "Ajustes na arte" : "Arte" };
  // Tarefa de conteúdo já concluída (sem post, trabalho ou arquivo): a pauta
  // foi feita, então não volta para "Pauta". Fica em arte, como "Concluída".
  if (tarefaConcluida(peca)) return { etapa: "arte", rotulo: "Concluída" };
  return { etapa: "pauta", rotulo: "Pauta" };
}

/** `done` é o status de tarefa concluída neste painel; `completed` entra por defesa. */
export const tarefaConcluida = (peca: Pick<PecaFato, "tarefa">): boolean =>
  peca.tarefa?.status === "done" || peca.tarefa?.status === "completed";

// ------------------------------------------------------------------ datas (America/Sao_Paulo)

const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Dia civil em São Paulo. Data pura (YYYY-MM-DD, como tasks.due_date) já é o
 * dia do Brasil e não passa por fuso; instante (timestamptz) é convertido.
 */
export function diaCivilEmSP(valor: string | null | undefined): string | null {
  if (!valor) return null;
  if (SO_DATA.test(valor)) return valor;
  const instante = new Date(valor);
  return Number.isNaN(instante.getTime()) ? null : dataEmSP(instante);
}

const menor = (valores: Array<string | null>): string | null => {
  const validos = valores.filter((v): v is string => Boolean(v)).sort();
  return validos[0] ?? null;
};

/**
 * O dia da peça na grade, nesta ordem: publicado em; agendado para; data
 * planejada da publicação; prazo da tarefa. Sem nenhuma delas a peça não
 * entra na grade (a Esteira é por dia e não inventa data).
 */
export function dataDaPeca(peca: PecaFato): string | null {
  const publicacoes = publicacoesVivas(peca);
  const publicadas = publicacoes.filter((p) => p.status === "published");
  if (publicadas.length) {
    const dia = menor(publicadas.map((p) => diaCivilEmSP(p.published_at) ?? diaCivilEmSP(p.scheduled_at)));
    if (dia) return dia;
  }
  const agendadas = menor(publicacoes.filter((p) => p.status === "scheduled").map((p) => diaCivilEmSP(p.scheduled_at)));
  if (agendadas) return agendadas;
  const planejadas = menor(publicacoes.filter((p) => p.status !== "published" && p.status !== "scheduled").map((p) => diaCivilEmSP(p.scheduled_at)));
  if (planejadas) return planejadas;
  return diaCivilEmSP(peca.tarefa?.due_date);
}

/** Soma dias a uma data YYYY-MM-DD (calendário, sem fuso). */
export function somarDias(data: string, dias: number): string {
  const [a, m, d] = data.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Instante (UTC) da meia-noite de São Paulo que abre o dia civil `data`
 * (YYYY-MM-DD). Calcula o deslocamento do fuso pelo próprio Intl, sem
 * hardcode de -03:00: a parede de SP é lida no candidato e a diferença corrige
 * o chute. Duas passagens cobrem uma eventual troca de deslocamento no meio.
 */
export function meiaNoiteEmSP(data: string): Date {
  const [a, m, d] = data.split("-").map(Number);
  const paredeAlvo = Date.UTC(a, m - 1, d);
  let candidato = paredeAlvo;
  for (let passo = 0; passo < 2; passo += 1) {
    candidato = paredeAlvo - deslocamentoDeSPEmMs(new Date(candidato));
  }
  return new Date(candidato);
}

/** Quanto a parede de São Paulo está à frente do UTC naquele instante (negativo no Brasil). */
function deslocamentoDeSPEmMs(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(instante);
  const n = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? 0);
  const parede = Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second"));
  const semMs = Math.floor(instante.getTime() / 1000) * 1000;
  return parede - semMs;
}

/**
 * Milissegundos de `agora` até a próxima meia-noite de São Paulo (quando o
 * "Hoje" e a semana atual mudam). Sempre maior que zero.
 */
export function msAteProximaMeiaNoiteSP(agora: Date = new Date()): number {
  const amanha = somarDias(dataEmSP(agora), 1);
  return Math.max(1, meiaNoiteEmSP(amanha).getTime() - agora.getTime());
}

/** A segunda-feira (YYYY-MM-DD) da semana em que `agora` cai, em São Paulo. */
export function segundaDaSemana(agora: Date = new Date()): string {
  const hoje = dataEmSP(agora);
  return somarDias(hoje, 1 - diaDaSemanaDaData(hoje));
}

const CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const NOMES = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];

export interface DiaDaGrade {
  /** YYYY-MM-DD */
  data: string;
  /** 1 segunda ... 7 domingo */
  diaDaSemana: number;
  /** "Seg 16" */
  rotulo: string;
  /** "segunda-feira, 16/11" (para leitor de tela) */
  rotuloLongo: string;
}

/** Os sete dias (segunda a domingo) da semana que começa em `segunda`. */
export function diasDaSemana(segunda: string): DiaDaGrade[] {
  return CURTOS.map((curto, i) => {
    const data = somarDias(segunda, i);
    const [, mes, dia] = data.split("-");
    return {
      data,
      diaDaSemana: i + 1,
      rotulo: `${curto} ${Number(dia)}`,
      rotuloLongo: `${NOMES[i]}, ${dia}/${mes}`,
    };
  });
}

/** "16 a 22 de novembro de 2026" (ou "30 de novembro a 6 de dezembro de 2026"). */
export function rotuloDaSemana(segunda: string): string {
  const domingo = somarDias(segunda, 6);
  const parte = (data: string, opcoes: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", ...opcoes }).format(new Date(`${data}T12:00:00Z`));
  const mesmoMes = segunda.slice(0, 7) === domingo.slice(0, 7);
  const inicio = mesmoMes ? String(Number(segunda.slice(8, 10))) : parte(segunda, { day: "numeric", month: "long" });
  return `${inicio} a ${parte(domingo, { day: "numeric", month: "long", year: "numeric" })}`;
}

// ------------------------------------------------------------------ dia prioritário

export interface RegistroDoDiaPrioritario {
  client_id: string;
  dia: number | null;
  situacao: string;
}

/**
 * O dia da semana (1 a 5) quando o cliente tem dia definido; null quando não
 * há registro, o dia está vazio ou a situação é "não se aplica".
 */
export function diaPrioritarioDefinido(registro: RegistroDoDiaPrioritario | null | undefined): number | null {
  if (!registro || registro.situacao === "nao_aplicavel") return null;
  return ehDiaUtil(registro.dia) ? registro.dia : null;
}

// ------------------------------------------------------------------ cartão e grade

const ROTULO_DO_FORMATO: Record<string, string> = {
  static: "Post",
  carousel: "Carrossel",
  reel: "Reel",
  story: "Story",
  video: "Vídeo",
  short: "Short",
  article: "Artigo",
  google_post: "Google",
  other: "Outro",
};

export const rotuloDoFormato = (contentType: string | null | undefined): string =>
  contentType ? ROTULO_DO_FORMATO[contentType] || contentType : "Conteúdo";

/**
 * Para onde o cartão leva. Com post, a Agenda já aberta nele; sem post e com
 * trabalho do Estúdio, o Estúdio na tarefa; só tarefa, a Agenda do cliente
 * (onde o prazo dela aparece).
 */
export function linkDoCartao(peca: Pick<PecaFato, "clientId" | "post" | "tarefa" | "trabalho">): string {
  const cliente = encodeURIComponent(peca.clientId);
  if (peca.post) return `/calendario?client=${cliente}&content=${encodeURIComponent(peca.post.id)}`;
  if (peca.trabalho && peca.tarefa) return `/mesa?client=${cliente}&aba=estudio&task=${encodeURIComponent(peca.tarefa.id)}`;
  return `/calendario?client=${cliente}`;
}

export interface CartaoDaEsteira {
  chave: string;
  titulo: string;
  formato: string;
  etapa: EtapaDaPeca;
  rotuloDaEtapa: string;
  link: string;
  destino: "agenda" | "estudio";
}

export interface CelulaDaEsteira {
  data: string;
  /** É o dia prioritário deste cliente. */
  prioritario: boolean;
  /** Dia prioritário da semana visível sem nenhuma peça. */
  alerta: boolean;
  cartoes: CartaoDaEsteira[];
}

export interface FaixaDaEsteira {
  clientId: string;
  nome: string;
  /** 1 a 5 quando definido. */
  diaPrioritario: number | null;
  /** "segunda-feira" */
  nomeDoDiaPrioritario: string;
  celulas: CelulaDaEsteira[];
}

export interface ClienteDaFaixa {
  id: string;
  nome: string;
  /** profiles.plan_status; quando vem, um status de pausa tira o dia prioritário. */
  planStatus?: string | null;
}

/** Status de plano que, por defesa, não contam como dia prioritário (o hook já filtra só `active`). */
const PLANOS_SEM_DIA_PRIORITARIO = new Set(["standby", "paused", "pausado", "inactive"]);

/**
 * LISTA TEMPORÁRIA de clientes cuja pausa operacional não está no cadastro.
 *
 * Rd Ar Climatização (52f2efb6-...): o Almir decidiu em 13/11/2026
 * (America/Sao_Paulo) pausar conteúdo e tráfego, e desde então o cliente NÃO
 * deve contar como dia prioritário na Esteira. Essa pausa não foi gravada no
 * cadastro: `plan_status` continua `active`, `cobranca_pausada` é false (e é
 * pausa de cobrança, não de conteúdo), `services_config.social`/`trafego`
 * continuam true e `ads_rotina` continua ligada (`pausada_em` nulo). Não
 * existe coluna de pausa de conteúdo em `profiles`; as únicas pausas no banco
 * (cobranca_pausada, ads_rotina.pausada_em, contracts.congelado_em,
 * membros_licencas.suspenso_em) não registram esta decisão.
 *
 * A lista cobre esse buraco até o cadastro ter um sinal real de pausa. NÃO é
 * o padrão para pausar cliente novo: o caminho certo é gravar a pausa no
 * cadastro (e aí este Set some). A faixa do cliente continua na grade porque
 * o plano dele ainda é `active`; só o dia prioritário e o alerta saem.
 */
export const CLIENTES_COM_DIA_PRIORITARIO_SUSPENSO_TEMPORARIAMENTE: ReadonlySet<string> = new Set([
  "52f2efb6-9928-4074-b8e2-bc972baf1f6a", // Rd Ar Climatização, pausa de 13/11/2026
]);

/**
 * Este cliente conta como dia prioritário na Esteira? Não conta quando o
 * plano está em pausa (ramo defensivo) ou quando está na lista temporária
 * acima. Quem não conta não recebe destaque nem alerta; a faixa pode seguir.
 */
export function clienteContaComoDiaPrioritario(cliente: Pick<ClienteDaFaixa, "id" | "planStatus">): boolean {
  const status = (cliente.planStatus ?? "").trim().toLowerCase();
  if (PLANOS_SEM_DIA_PRIORITARIO.has(status)) return false;
  return !CLIENTES_COM_DIA_PRIORITARIO_SUSPENSO_TEMPORARIAMENTE.has(cliente.id);
}

const ORDEM_DA_ETAPA: Record<EtapaDaPeca, number> = { pauta: 0, arte: 1, revisao: 2, aprovacao: 3, agendado: 4, no_ar: 5 };

/**
 * Monta a grade da semana: uma faixa por cliente (mesmo sem peça, para o
 * alerta do dia prioritário aparecer) e, em cada dia, os cartões das peças
 * com data naquele dia.
 */
export function montarGrade(entrada: {
  clientes: ClienteDaFaixa[];
  pecas: PecaFato[];
  diasPrioritarios: RegistroDoDiaPrioritario[];
  segunda: string;
}): FaixaDaEsteira[] {
  const dias = diasDaSemana(entrada.segunda);
  const datas = new Set(dias.map((d) => d.data));
  const porCelula = new Map<string, CartaoDaEsteira[]>();
  for (const peca of entrada.pecas) {
    const decidida = decidirEtapa(peca);
    if (!decidida) continue;
    const data = dataDaPeca(peca);
    if (!data || !datas.has(data)) continue;
    const link = linkDoCartao(peca);
    const chave = `${peca.clientId}|${data}`;
    const lista = porCelula.get(chave) ?? [];
    lista.push({
      chave: peca.chave,
      titulo: peca.titulo,
      formato: rotuloDoFormato(peca.contentType),
      etapa: decidida.etapa,
      rotuloDaEtapa: decidida.rotulo,
      link,
      destino: link.startsWith("/mesa") ? "estudio" : "agenda",
    });
    porCelula.set(chave, lista);
  }
  const registroPorCliente = new Map(entrada.diasPrioritarios.map((r) => [r.client_id, r]));
  return [...entrada.clientes]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((cliente) => {
      const diaPrioritario = clienteContaComoDiaPrioritario(cliente)
        ? diaPrioritarioDefinido(registroPorCliente.get(cliente.id))
        : null;
      return {
        clientId: cliente.id,
        nome: cliente.nome,
        diaPrioritario,
        nomeDoDiaPrioritario: nomeDoDia(diaPrioritario),
        celulas: dias.map((dia) => {
          const cartoes = (porCelula.get(`${cliente.id}|${dia.data}`) ?? []).sort(
            (a, b) => ORDEM_DA_ETAPA[a.etapa] - ORDEM_DA_ETAPA[b.etapa] || a.titulo.localeCompare(b.titulo, "pt-BR"),
          );
          const prioritario = diaPrioritario === dia.diaDaSemana;
          return { data: dia.data, prioritario, alerta: prioritario && cartoes.length === 0, cartoes };
        }),
      };
    });
}
