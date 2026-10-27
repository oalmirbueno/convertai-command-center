import { DEMOS } from "./demos.ts";
import { FORMATOS, modeloPermitido, openaiPronta, pedidoDeImagem, pedidoDeTexto, textoSimulado, validarConteudo, type Briefing, type ConteudoDaCampanha, type Formato, type Marca } from "./regras.ts";

/**
 * Fornecedores do estúdio. O simulado é determinístico e marcado DEMONSTRAÇÃO; a OpenAI só responde com
 * BOLSO_OPENAI_HABILITADO=sim, chave no servidor e modelos da lista (regras.ts). Nenhum dos dois decide
 * crédito: isso é do banco.
 */

export interface Contexto {
  marca: Marca;
  briefing: Briefing;
  versao: Partial<ConteudoDaCampanha> | null;
  formato: Formato | null;
}

/** Estimativa pelo uso retornado e tabela pública, não conciliação da fatura do fornecedor. */
export type CustoEstimado = { modelo: string; custo_usd: number };
export type ResultadoTexto = { ok: true; conteudo: ConteudoDaCampanha; custo?: CustoEstimado } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };
export type ResultadoImagem = { ok: true; bytes: Uint8Array; custo?: CustoEstimado } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };

export interface Provedor {
  texto(ctx: Contexto): Promise<ResultadoTexto>;
  imagem(ctx: Contexto): Promise<ResultadoImagem>;
}

const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const simulado: Provedor = {
  texto(ctx) {
    return Promise.resolve({ ok: true, conteudo: textoSimulado(ctx.marca, ctx.briefing) });
  },
  imagem(ctx) {
    if (!ctx.formato || !DEMOS[ctx.formato]) return Promise.resolve({ ok: false, motivo: "Formato sem arte de demonstração.", definitiva: true });
    return Promise.resolve({ ok: true, bytes: deBase64(DEMOS[ctx.formato]) });
  },
};

type Busca = typeof fetch;

export type ConfiguracaoOpenai = { habilitado?: string; chave?: string; modeloTexto?: string; modeloImagem?: string };

/** Exclusivo do servidor. A chave compartilhada não ativa o Bolso nem escolhe seu modelo. */
export function configuracaoOpenaiDoServidor(ambiente: (nome: string) => string | undefined): ConfiguracaoOpenai {
  const habilitado = ambiente("BOLSO_OPENAI_HABILITADO");
  return {
    habilitado,
    modeloTexto: ambiente("BOLSO_OPENAI_MODELO_TEXTO"),
    modeloImagem: ambiente("BOLSO_OPENAI_MODELO_IMAGEM"),
    // Não lê nenhuma credencial enquanto o gate dedicado estiver desligado.
    chave: habilitado === "sim"
      ? ambiente("BOLSO_OPENAI_API_KEY")?.trim() || ambiente("OPENAI_API_KEY")?.trim()
      : undefined,
  };
}

const registro = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const tokens = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

// Códigos documentados em https://developers.openai.com/api/docs/guides/error-codes.
// Só estes valores exatos podem sair no diagnóstico. Nunca repassar message, corpo ou headers.
const CODIGOS_DE_COTA = [
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
] as const;

async function erroDeLimite(res: Response): Promise<Extract<ResultadoTexto, { ok: false }>> {
  let erro: Record<string, unknown> | null = null;
  try {
    erro = registro(registro(await res.json())?.error);
  } catch {
    // Resposta desconhecida continua transitória, sem inventar uma causa de cobrança.
  }
  const codigo = CODIGOS_DE_COTA.find((c) => erro?.code === c)
    || CODIGOS_DE_COTA.find((c) => erro?.type === c);
  if (codigo) return {
    ok: false,
    motivo: `A geração está sem saldo ou cota no fornecedor (${codigo}). A administração precisa revisar os créditos e limites da API.`,
    definitiva: true,
  };
  const limiteDeRitmo = erro?.type === "rate_limit_error"
    || erro?.code === "rate_limit_exceeded" || erro?.code === "slow_down";
  return {
    ok: false,
    motivo: limiteDeRitmo
      ? "Limite temporário de requisições do fornecedor (429). Aguarde antes de tentar novamente."
      : "Fornecedor temporariamente indisponível (429). Aguarde antes de tentar novamente.",
    definitiva: false,
  };
}

/**
 * Preços Standard em USD por milhão de tokens, conferidos em 27/10/2026:
 * https://developers.openai.com/api/docs/models/gpt-4.1-mini
 * https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
 * Images API direta não recebe desconto de cache. Usage ausente/inconsistente não vira custo zero.
 * Só conclusões bem-sucedidas persistem esta estimativa na tabela existente; falhas podem gerar custo
 * no fornecedor e exigem conciliação externa. Crédito comercial continua independente desta conta.
 */
export function custoEstimadoPeloUso(tipo: "texto" | "imagem", modelo: string, uso: unknown): CustoEstimado | undefined {
  const u = registro(uso);
  if (!u || !modeloPermitido(tipo, modelo)) return undefined;
  let usd: number;
  if (tipo === "texto") {
    if (!tokens(u.prompt_tokens) || !tokens(u.completion_tokens)) return undefined;
    const detalhe = u.prompt_tokens_details == null ? null : registro(u.prompt_tokens_details);
    if (u.prompt_tokens_details != null && !detalhe) return undefined;
    const cache = detalhe?.cached_tokens ?? 0;
    if (!tokens(cache) || cache > u.prompt_tokens) return undefined;
    usd = ((u.prompt_tokens - cache) * 0.40 + cache * 0.10 + u.completion_tokens * 1.60) / 1_000_000;
  } else {
    const entrada = registro(u.input_tokens_details);
    if (!entrada || !tokens(entrada.text_tokens) || !tokens(entrada.image_tokens)
      || !tokens(u.input_tokens) || u.input_tokens !== entrada.text_tokens + entrada.image_tokens
      || !tokens(u.output_tokens)) return undefined;
    let imagensDeSaida = u.output_tokens;
    if (u.output_tokens_details != null) {
      const saida = registro(u.output_tokens_details);
      if (!saida || !tokens(saida.image_tokens) || !tokens(saida.text_tokens)
        || u.output_tokens !== saida.image_tokens + saida.text_tokens) return undefined;
      imagensDeSaida = saida.image_tokens;
    }
    usd = (entrada.text_tokens * 5 + entrada.image_tokens * 8 + imagensDeSaida * 30) / 1_000_000;
  }
  // Mesma precisão e intervalo de numeric(12,6), sem deixar metadados inválidos perderem a entrega.
  const custo_usd = Number(usd.toFixed(6));
  return Number.isFinite(custo_usd) && custo_usd < 1_000_000 ? { modelo, custo_usd } : undefined;
}

/** Adaptador OpenAI. NÃO VALIDADO em chamada real: nenhum gasto foi feito para testar. */
export function openai(env: ConfiguracaoOpenai, buscar: Busca = fetch): Provedor {
  const pronta = openaiPronta(env);
  const recusa = (motivo: string) => ({ ok: false as const, motivo, definitiva: true });
  // Falha de rede ou tempo esgotado: o fornecedor pode ter processado. O job não é tocado: o lease vence e o
  // banco o marca "incerto" para a administração conferir (nunca repete sozinho nem devolve às cegas).
  const incerto = (motivo: string) => ({ ok: false as const, motivo, definitiva: false, incerto: true });
  return {
    async texto(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      const modelo = modeloPermitido("texto", env.modeloTexto)!;
      const { sistema, usuario } = pedidoDeTexto(ctx.marca, ctx.briefing);
      let res: Response;
      try {
        res = await buscar("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.chave}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, response_format: { type: "json_object" }, messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }], max_tokens: 1200 }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        return incerto("Sem resposta do fornecedor de texto.");
      }
      if (res.status === 429) return erroDeLimite(res);
      if (res.status >= 500) return { ok: false, motivo: `Fornecedor indisponível (${res.status}).`, definitiva: false };
      if (!res.ok) return recusa(`Fornecedor recusou o pedido (${res.status}).`);
      try {
        const corpo = await res.json();
        const bruto = JSON.parse(corpo.choices[0].message.content);
        const v = validarConteudo(bruto, ctx.briefing);
        if (v.ok === false) return recusa(v.motivo);
        return { ok: true, conteudo: v.conteudo, custo: custoEstimadoPeloUso("texto", modelo, corpo.usage) };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
    async imagem(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      if (!ctx.formato) return recusa("Formato ausente.");
      const modelo = modeloPermitido("imagem", env.modeloImagem)!;
      const f = FORMATOS[ctx.formato];
      // O download preserva estes pixels. Homologação inicial: apenas feed_1x1; os formatos verticais
      // ainda precisam de exportação nas proporções finais antes de serem liberados comercialmente.
      const tamanho = f.altura > f.largura ? "1024x1536" : "1024x1024";
      let res: Response;
      try {
        res = await buscar("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.chave}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, prompt: pedidoDeImagem(ctx.marca, ctx.briefing, ctx.versao, ctx.formato), size: tamanho, quality: "medium", output_format: "png", background: "opaque", n: 1 }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        return incerto("Sem resposta do fornecedor de imagem.");
      }
      if (res.status === 429) return erroDeLimite(res);
      if (res.status >= 500) return { ok: false, motivo: `Fornecedor indisponível (${res.status}).`, definitiva: false };
      if (!res.ok) return recusa(`Fornecedor recusou o pedido (${res.status}).`);
      try {
        const corpo = await res.json();
        const b64 = corpo && corpo.data && corpo.data[0] && corpo.data[0].b64_json;
        if (typeof b64 !== "string") return recusa("Fornecedor não devolveu a imagem.");
        return { ok: true, bytes: deBase64(b64), custo: custoEstimadoPeloUso("imagem", modelo, corpo.usage) };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
  };
}
