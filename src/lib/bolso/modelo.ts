/**
 * Aceleriq de Bolso (26/10/2026): tipos e regras puras da tela. Quem decide acesso, saldo e custo é o banco
 * (funções bolso_*); aqui só se explica o estado ao membro e se confere o formulário antes de mandar.
 * Puro (Safari 11: sem lookbehind, sem grupo nomeado).
 */

export type ModoDoEstudio = "real" | "simulado" | "pausado" | "fechado" | "sem_acesso" | "indisponivel";
export type Formato = "feed_1x1" | "feed_4x5" | "stories_9x16";
export type TipoDaCampanha = "venda" | "agendamento" | "orcamento";

export interface EstadoDoEstudio {
  exposto: boolean;
  admin?: boolean;
  modo?: ModoDoEstudio;
  motivo?: string | null;
  carteira?: "real" | "teste";
  direito?: { tipo: string; origem: string; inicio: string; fim: string } | null;
  saldo?: { disponivel: number; reservado: number };
  politica?: { versao: number; teste: boolean; tarifa_texto: number; tarifa_imagem: number; formatos: Formato[] } | null;
  limites_configurados?: boolean;
  destino_agencia?: string | null;
}

export interface Marca {
  id?: string;
  nome: string;
  descricao: string;
  publico: string;
  regiao: string;
  tom: string;
  cores: string[];
  direitos_confirmados: boolean;
  versao?: number;
}

export interface Briefing {
  tipo: TipoDaCampanha;
  produto: string;
  objetivo: string;
  canal: string;
  condicoes: string;
  cta: string;
  publico: string;
  diferencial: string;
}

export interface ConteudoDaCampanha {
  mensagem: string;
  texto: string;
  cta: string;
  aplicacao: string;
  direcao_visual: string;
}

export interface VersaoDaCampanha {
  numero: number;
  origem: "manual" | "gerada" | "simulada";
  conteudo: ConteudoDaCampanha;
  criado_em: string;
}

export type EstadoDoJob = "na_fila" | "processando" | "concluido" | "falhou" | "cancelado" | "incerto";

export interface Job {
  id: string;
  tipo: "texto" | "imagem";
  formato: Formato | null;
  estado: EstadoDoJob;
  provedor: "simulado" | "openai";
  tarifa: number;
  carteira: "real" | "teste";
  versao_campanha: number | null;
  erro: string | null;
  criado_em: string;
}

export interface Arte {
  id: string;
  caminho: string;
  formato: Formato;
  mime: string;
  bytes: number;
  versao_campanha: number;
  simulado: boolean;
  escolhido: boolean;
  criado_em: string;
}

export interface Campanha {
  id: string;
  titulo: string;
  briefing: Briefing;
  versao: number;
  versao_escolhida: number | null;
  atualizado_em: string;
  versoes: VersaoDaCampanha[];
  jobs: Job[];
  artes: Arte[];
}

export interface ResumoDaCampanha {
  id: string;
  titulo: string;
  tipo: TipoDaCampanha;
  versao_escolhida: number | null;
  atualizado_em: string;
  versoes: number;
  artes: number;
  em_andamento: number;
}

export interface LancamentoDoExtrato {
  id: number;
  carteira: "real" | "teste";
  tipo: "concessao" | "reserva" | "captura" | "liberacao" | "estorno" | "expiracao";
  quantidade: number;
  delta_disponivel: number;
  delta_reservado: number;
  descricao: string;
  criado_em: string;
  job_id: string | null;
}

export const FORMATOS: Record<Formato, { nome: string; proporcao: string }> = {
  feed_1x1: { nome: "Feed quadrado", proporcao: "1:1" },
  feed_4x5: { nome: "Feed retrato", proporcao: "4:5" },
  stories_9x16: { nome: "Stories", proporcao: "9:16" },
};

export const TIPOS: Record<TipoDaCampanha, { nome: string; dica: string; cta: string }> = {
  venda: { nome: "Vender", dica: "Um produto ou serviço para comprar agora.", cta: "Ex.: Peça pelo direct" },
  agendamento: { nome: "Agendar", dica: "Horário, consulta, visita ou aula.", cta: "Ex.: Agende pelo WhatsApp" },
  orcamento: { nome: "Pedir orçamento", dica: "Serviço que depende de avaliação.", cta: "Ex.: Peça seu orçamento" },
};

export const BRIEFING_VAZIO: Briefing = { tipo: "venda", produto: "", objetivo: "", canal: "", condicoes: "", cta: "", publico: "", diferencial: "" };
export const MARCA_VAZIA: Marca = { nome: "", descricao: "", publico: "", regiao: "", tom: "", cores: [], direitos_confirmados: false };

/** O que falta para o estúdio montar bem (nunca preenchemos por conta própria). */
export function faltasDoBriefing(b: Briefing): string[] {
  const faltas: string[] = [];
  if (!b.produto.trim()) faltas.push("Qual produto ou serviço a campanha divulga");
  if (!b.cta.trim()) faltas.push("O que a pessoa deve fazer (chamada para ação)");
  if (!b.canal.trim()) faltas.push("Onde vai publicar (Instagram, WhatsApp...)");
  return faltas;
}

/** Condição comercial só aparece se o membro escreveu: lembrete na tela, não preenchimento. */
export function avisoDeCondicoes(b: Briefing): string | null {
  return b.condicoes.trim() ? null : "Sem preço, prazo ou desconto informado, o texto sai sem eles. Nada é inventado.";
}

export function marcaValida(m: Marca): string | null {
  if (!m.nome.trim()) return "Diga o nome da marca.";
  if (!m.direitos_confirmados) return "Confirme que você pode usar o nome, a logo e as imagens da marca.";
  return null;
}

export const ROTULO_DO_JOB: Record<EstadoDoJob, string> = {
  na_fila: "Na fila",
  processando: "Criando",
  concluido: "Pronto",
  falhou: "Não deu certo",
  cancelado: "Cancelado",
  incerto: "Em conferência",
};

export const EXPLICA_JOB: Record<EstadoDoJob, string> = {
  na_fila: "Os créditos ficam reservados até terminar.",
  processando: "Pode sair desta tela; o resultado fica guardado aqui.",
  concluido: "Os créditos reservados foram usados.",
  falhou: "Os créditos reservados voltaram para o seu saldo.",
  cancelado: "Os créditos reservados voltaram para o seu saldo.",
  incerto: "O fornecedor não respondeu a tempo. A equipe confere antes de cobrar ou devolver.",
};

export const ROTULO_DO_LANCAMENTO: Record<LancamentoDoExtrato["tipo"], string> = {
  concessao: "Créditos recebidos",
  reserva: "Reservado",
  captura: "Usado",
  liberacao: "Devolvido",
  estorno: "Estornado",
  expiracao: "Vencido",
};

/** Explicação do modo, sem jargão, e se dá para pedir à IA agora. */
export function situacaoDoEstudio(e: EstadoDoEstudio | null | undefined): { podeGerar: boolean; titulo: string; texto: string; demonstracao: boolean } {
  if (!e || !e.exposto) return { podeGerar: false, titulo: "Estúdio indisponível", texto: "O estúdio ainda não está disponível na sua conta.", demonstracao: false };
  switch (e.modo) {
    case "real":
      return { podeGerar: true, titulo: "Estúdio ativo", texto: "Cada pedido mostra quantos créditos usa antes de você confirmar.", demonstracao: false };
    case "simulado":
      return { podeGerar: true, titulo: "Modo demonstração", texto: "Provedor simulado: textos montados só com o que você escreveu e arte de teste. Nada é gerado por IA e os créditos são de teste.", demonstracao: true };
    case "pausado":
      return { podeGerar: false, titulo: "Estúdio pausado", texto: e.motivo || "Pausado pela administração. Suas campanhas e arquivos continuam aqui.", demonstracao: false };
    case "sem_acesso":
      return { podeGerar: false, titulo: "Acesso não ativo", texto: e.motivo || "Seu acesso ao estúdio não está ativo.", demonstracao: false };
    default:
      return { podeGerar: false, titulo: "Criação com IA indisponível", texto: e.motivo || "Você pode montar e editar a campanha à mão.", demonstracao: false };
  }
}

/** Por que o botão de pedir está desligado (sempre com o próximo passo). */
export function motivoParaNaoPedir(e: EstadoDoEstudio | null | undefined, tarifa: number | null, temVersao: boolean, tipo: "texto" | "imagem"): string | null {
  const s = situacaoDoEstudio(e);
  if (!s.podeGerar) return s.texto;
  if (!e || !e.limites_configurados) return "A administração ainda não configurou os limites do estúdio.";
  if (tarifa === null) return "O custo deste pedido ainda não está definido no seu acesso.";
  if (tipo === "imagem" && !temVersao) return "Escolha ou escreva o texto da campanha antes de pedir a arte.";
  const disponivel = e.saldo ? e.saldo.disponivel : 0;
  if (disponivel < tarifa) return `Este pedido usa ${tarifa} crédito${tarifa === 1 ? "" : "s"} e você tem ${disponivel}. Consultar e baixar o que já fez continua livre.`;
  return null;
}

export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** Chave de idempotência do pedido: a mesma enquanto a tela não confirmar outro pedido. */
export function novaChave(): string {
  const c = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `bolso-${c}`;
}

export function nomeDoArquivo(titulo: string, formato: Formato, versao: number, mime: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "campanha";
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  return `${base}-${formato}-v${versao}.${ext}`;
}
