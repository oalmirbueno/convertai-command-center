/**
 * Catálogo de Configurações › Chaves e custos (frente CHV, 01/10/2026).
 *
 * Uma linha por provedor. `id` é o mesmo `provedor` gravado em ia_usos (é por
 * ele que o "Este mês" soma). `campos` são os segredos (o nome é o mesmo do
 * ambiente das funções). Módulo puro: a tela importa daqui também.
 */

import { NOMES_DAS_CHAVES, type NomeDaChave } from "../../_shared/chaves.ts";

export type IdDoProvedor =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "gemini"
  | "elevenlabs"
  | "fal"
  | "typesafe"
  | "resend"
  | "vercel"
  | "runway"
  | "heygen"
  | "higgsfield"
  | "github"
  | "openart"
  | "aws";

export interface CampoDaChave {
  nome: NomeDaChave;
  rotulo: string;
  /** Começo típico da chave (só dica no campo). */
  exemplo?: string;
}

export interface ProvedorDoPainel {
  id: IdDoProvedor;
  nome: string;
  /** Para que serve, em poucas palavras. */
  serve: string;
  campos: CampoDaChave[];
  /** Onde o admin pega a chave. */
  onde: string;
  /** O provedor informa saldo pela API com uma chave comum. */
  saldoPelaApi: boolean;
  /**
   * Página de cobrança ou recarga (abre em nova aba). Nenhum provedor vende
   * crédito por API com chave comum (o do OpenRouter por Coinbase foi
   * desligado: 410), então o painel só leva até a página; nunca guarda cartão.
   */
  recarga: string | null;
  /** Entrada pronta para um provedor que ainda não entrou (aparece como "em breve"). */
  emBreve?: boolean;
  /** Grupo da tela. */
  grupo: "ia" | "midia" | "servicos";
}

export const PROVEDORES: ProvedorDoPainel[] = [
  { id: "openrouter", nome: "OpenRouter", serve: "Texto e imagem da maioria dos modelos", campos: [{ nome: "OPENROUTER_API_KEY", rotulo: "Chave", exemplo: "sk-or-v1-…" }], onde: "openrouter.ai/settings/keys", saldoPelaApi: true, recarga: "https://openrouter.ai/settings/credits", grupo: "ia" },
  { id: "openai", nome: "OpenAI", serve: "GPT direto, imagem e transcrição", campos: [{ nome: "OPENAI_API_KEY", rotulo: "Chave", exemplo: "sk-…" }], onde: "platform.openai.com/api-keys", saldoPelaApi: false, recarga: "https://platform.openai.com/settings/organization/billing/overview", grupo: "ia" },
  { id: "anthropic", nome: "Anthropic", serve: "Claude direto", campos: [{ nome: "ANTHROPIC_API_KEY", rotulo: "Chave", exemplo: "sk-ant-…" }], onde: "console.anthropic.com/settings/keys", saldoPelaApi: false, recarga: "https://platform.claude.com/settings/billing", grupo: "ia" },
  { id: "gemini", nome: "Google Gemini", serve: "Gemini direto (reserva)", campos: [{ nome: "GEMINI_API_KEY", rotulo: "Chave", exemplo: "AIza…" }], onde: "aistudio.google.com/apikey", saldoPelaApi: false, recarga: "https://aistudio.google.com/usage", grupo: "ia" },
  { id: "typesafe", nome: "TypeSafe (Jev)", serve: "Julgar, ranquear e conferir", campos: [{ nome: "TYPESAFE_API_KEY", rotulo: "Chave" }], onde: "typesafe.ai", saldoPelaApi: false, recarga: "https://typesafe.ai/", grupo: "ia" },
  { id: "fal", nome: "fal.ai", serve: "Vídeo, upscale e recorte", campos: [{ nome: "FAL_KEY", rotulo: "Chave" }], onde: "fal.ai/dashboard/keys", saldoPelaApi: false, recarga: "https://fal.ai/dashboard/usage-billing/billing", grupo: "midia" },
  { id: "elevenlabs", nome: "ElevenLabs", serve: "Narração, música e efeitos", campos: [{ nome: "ELEVENLABS_API_KEY", rotulo: "Chave", exemplo: "sk_…" }], onde: "elevenlabs.io/app/settings/api-keys", saldoPelaApi: false, recarga: "https://elevenlabs.io/app/subscription", grupo: "midia" },
  { id: "runway", nome: "Runway", serve: "Vídeo Runway", campos: [{ nome: "RUNWAYML_API_SECRET", rotulo: "Chave", exemplo: "key_…" }], onde: "dev.runwayml.com", saldoPelaApi: true, recarga: "https://dev.runwayml.com/", grupo: "midia" },
  { id: "heygen", nome: "HeyGen", serve: "Avatares falando", campos: [{ nome: "HEYGEN_API_KEY", rotulo: "Chave" }], onde: "app.heygen.com/settings (API)", saldoPelaApi: true, recarga: "https://app.heygen.com/settings?nav=API", grupo: "midia" },
  {
    id: "higgsfield",
    nome: "Higgsfield",
    serve: "Vídeo Higgsfield",
    campos: [
      { nome: "HIGGSFIELD_API_KEY", rotulo: "Id da chave" },
      { nome: "HIGGSFIELD_API_SECRET", rotulo: "Segredo" },
    ],
    onde: "cloud.higgsfield.ai",
    saldoPelaApi: false,
    recarga: "https://open.higgsfield.ai/",
    grupo: "midia",
  },
  { id: "resend", nome: "Resend", serve: "E-mails do painel", campos: [{ nome: "RESEND_API_KEY", rotulo: "Chave", exemplo: "re_…" }], onde: "resend.com/api-keys", saldoPelaApi: false, recarga: "https://resend.com/settings/billing", grupo: "servicos" },
  { id: "vercel", nome: "Vercel", serve: "Publicar os sites", campos: [{ nome: "VERCEL_TOKEN", rotulo: "Token" }], onde: "vercel.com/account/tokens", saldoPelaApi: false, recarga: "https://vercel.com/~/settings/billing", grupo: "servicos" },
  {
    id: "openart",
    nome: "OpenArt",
    serve: "Imagem e vídeo (em breve)",
    campos: [{ nome: "OPENART_API_KEY", rotulo: "Chave" }],
    onde: "openart.ai",
    saldoPelaApi: false,
    recarga: "https://openart.ai/pricing",
    emBreve: true,
    grupo: "midia",
  },
  {
    id: "aws",
    nome: "AWS (render na nuvem)",
    serve: "Renderizar vídeos no Remotion Lambda",
    campos: [
      { nome: "REMOTION_AWS_ACCESS_KEY_ID", rotulo: "Id da chave de acesso", exemplo: "AKIA…" },
      { nome: "REMOTION_AWS_SECRET_ACCESS_KEY", rotulo: "Chave secreta" },
    ],
    onde: "IAM › Usuários › remotion-user › Credenciais de segurança",
    saldoPelaApi: false,
    recarga: "https://us-east-1.console.aws.amazon.com/billing/home",
    grupo: "servicos",
  },
  { id: "github", nome: "GitHub", serve: "Segundo cérebro (repositório)", campos: [{ nome: "SECOND_BRAIN_GITHUB_TOKEN", rotulo: "Token", exemplo: "github_pat_…" }], onde: "github.com/settings/tokens", saldoPelaApi: false, recarga: null, grupo: "servicos" },
];

export const ROTULO_DO_GRUPO: Record<ProvedorDoPainel["grupo"], string> = {
  ia: "Modelos de IA",
  midia: "Vídeo, voz e imagem",
  servicos: "Serviços",
};

export function provedorPorId(id: string): ProvedorDoPainel | null {
  return PROVEDORES.find((p) => p.id === id) || null;
}

/** Provedor dono de um segredo (ex.: FAL_KEY -> fal). */
export function provedorDoSegredo(nome: string): ProvedorDoPainel | null {
  return PROVEDORES.find((p) => p.campos.some((c) => c.nome === nome)) || null;
}

/** Todos os segredos do catálogo (tem de bater com NOMES_DAS_CHAVES e o CHECK do banco). */
export const SEGREDOS_DO_CATALOGO: string[] = PROVEDORES.reduce<string[]>((a, p) => a.concat(p.campos.map((c) => c.nome)), []);

export { NOMES_DAS_CHAVES };

// ------------------------------------------------------------------ o que a tela recebe

export type EstadoDaChave = "valida" | "invalida" | "sem_chave" | "nao_testada";

export interface NumerosDoProvedor {
  /** Saldo em dólar, quando o provedor informa pela API. */
  saldo_usd?: number | null;
  /** Saldo em outra unidade (créditos da HeyGen), já escrito. */
  saldo_texto?: string | null;
  /** O provedor não informa saldo pela API (ou só com chave de administrador). */
  sem_saldo_pela_api?: boolean;
  /** Uso relevante: caracteres da ElevenLabs, limite da chave do OpenRouter, domínios da Resend. */
  uso?: { rotulo: string; usado: number; limite?: number | null; unidade?: "usd" | "caracteres" | "creditos" | "itens" } | null;
  /** Plano ou conta (ex.: "creator", "@usuario"). */
  conta?: string | null;
}

export interface LinhaDaChave {
  id: IdDoProvedor;
  estado: EstadoDaChave;
  /** De onde vem a chave em uso. */
  origem: "servidor" | "painel" | null;
  /** O cofre do painel tem chave (mesmo quando a do servidor manda). */
  no_painel: boolean;
  /** Segredos do provedor que existem no servidor (Deno.env). */
  no_servidor: boolean;
  /** Últimos 4 da chave em uso (ou da primeira, quando há duas). */
  final: string | null;
  testada_em: string | null;
  mensagem: string | null;
  numeros: NumerosDoProvedor;
  /** Gasto da agência no mês (ia_usos, mês de São Paulo), em US$. */
  mes_usd: number;
  /** Aviso de saldo baixo (US$; começa em 10, o admin ajusta). */
  saldo_minimo_usd: number;
  /** O saldo informado pelo provedor está abaixo do aviso. */
  saldo_baixo: boolean;
}

export interface GastoDoCliente {
  client_id: string;
  nome: string;
  mes_usd: number;
  /** Saldo da carteira de IA do cliente (null quando não tem carteira). */
  carteira_usd: number | null;
}

export interface EventoDaChave {
  provedor: string;
  acao: "cadastrada" | "trocada" | "removida";
  estado: string | null;
  ator_nome: string | null;
  criado_em: string;
}

export interface QuadroDasChaves {
  linhas: LinhaDaChave[];
  eventos: EventoDaChave[];
  /** Gasto do mês somando todos os provedores do ia_usos (chave da agência). */
  mes_total_usd: number;
  /** Gasto do mês por cliente (todas as chaves), do maior para o menor. */
  por_cliente: GastoDoCliente[];
  /** Provedores com saldo abaixo do aviso. */
  saldo_baixo: IdDoProvedor[];
  conferido_em: string;
}

/** Aviso de saldo baixo quando o admin ainda não ajustou. */
export const SALDO_MINIMO_PADRAO_USD = 10;
