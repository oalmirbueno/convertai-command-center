import { DEMOS } from "./demos.ts";
import { LIMITE_CONTEXTO_CRIATIVO, LIMITE_SAIDA_CRIATIVA, MODELO_COPY, MODELO_ESTRUTURA, pedidoDeBriefing, pedidoDeLegenda, validarBriefingGerado, type EntradaCriativa, type NaturezaCriativa } from "./criativo.ts";
import { FORMATOS, mimeReal, modeloPermitido, modeloOpenrouterPermitido, openaiPronta, openrouterPronto, pedidoDeAjuste, pedidoDeImagem, pedidoDeTexto, textoSimulado, validarConteudo, type Briefing, type ConteudoDaCampanha, type Formato, type Marca } from "./regras.ts";

/**
 * Fornecedores do estúdio. O simulado é determinístico e marcado DEMONSTRAÇÃO. Os reais exigem gate
 * dedicado, credencial no servidor e modelos da lista (regras.ts). Nenhum fornecedor decide crédito:
 * reserva, débito e estorno pertencem exclusivamente às RPCs e carteiras do Bolso.
 */

export interface Contexto {
  marca: Marca;
  briefing: Briefing;
  versao: Partial<ConteudoDaCampanha> | null;
  formato: Formato | null;
  natureza?: NaturezaCriativa;
  entrada?: EntradaCriativa;
  /** URLs privadas de curta duração, resolvidas e validadas pelo worker, nunca aceitas do navegador. */
  referencias?: string[];
}

/** OpenAI: estimativa por tokens. OpenRouter: custo retornado pelo fornecedor em usage.cost. */
export type CustoEstimado = { modelo: string; custo_usd: number };
export type ResultadoTexto = { ok: true; conteudo: ConteudoDaCampanha; custo?: CustoEstimado } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };
export type ResultadoImagem = { ok: true; bytes: Uint8Array; custo?: CustoEstimado } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };
export type ResultadoBriefing = { ok: true; briefing: Briefing; custo?: CustoEstimado } | Extract<ResultadoTexto, { ok: false }>;

export interface Provedor {
  texto(ctx: Contexto): Promise<ResultadoTexto>;
  imagem(ctx: Contexto): Promise<ResultadoImagem>;
  briefing?(ctx: Contexto): Promise<ResultadoBriefing>;
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
export type ConfiguracaoOpenrouter = ConfiguracaoOpenai;

/** Credencial dedicada primeiro. Chave empresarial só com opção explícita, nunca por ausência da dedicada. */
export async function configuracaoOpenrouterDoServidor(
  ambiente: (nome: string) => string | undefined,
  lerChaveEmpresarial?: () => Promise<string>,
): Promise<ConfiguracaoOpenrouter> {
  const config: ConfiguracaoOpenrouter = {
    habilitado: ambiente("BOLSO_OPENROUTER_HABILITADO"),
    modeloTexto: ambiente("BOLSO_OPENROUTER_MODELO_TEXTO"),
    modeloImagem: ambiente("BOLSO_OPENROUTER_MODELO_IMAGEM"),
  };
  if (config.habilitado !== "sim") return config;
  config.chave = ambiente("BOLSO_OPENROUTER_API_KEY")?.trim();
  if (!config.chave && ambiente("BOLSO_OPENROUTER_USAR_CHAVE_EMPRESA") === "sim") {
    config.chave = ambiente("OPENROUTER_API_KEY")?.trim() || (await lerChaveEmpresarial?.())?.trim();
  }
  return config;
}

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

/** Custo comunicado pelo OpenRouter. Ausência ou metadado inválido não significa custo zero. */
export function custoInformadoOpenrouter(modelo: string, uso: unknown): CustoEstimado | undefined {
  if (![MODELO_ESTRUTURA, MODELO_COPY].includes(modelo) && !modeloOpenrouterPermitido("texto", modelo) && !modeloOpenrouterPermitido("imagem", modelo)) return undefined;
  const custo = registro(uso)?.cost;
  if (typeof custo !== "number" || !Number.isFinite(custo) || custo < 0 || custo >= 1_000_000) return undefined;
  const custo_usd = Number(custo.toFixed(6));
  return custo_usd < 1_000_000 ? { modelo, custo_usd } : undefined;
}

const LIMITE_IMAGEM_BYTES = 10 * 1024 * 1024;
const LIMITE_IMAGEM_BASE64 = Math.ceil(LIMITE_IMAGEM_BYTES / 3) * 4;
const PROPORCOES_OPENROUTER: Record<Formato, string> = { feed_1x1: "1:1", feed_4x5: "4:5", stories_9x16: "9:16" };

/**
 * Transporte exclusivo do Bolso. Sem clientId, BYOK Mesa, carteira em USD ou fallback de fornecedor.
 * Texto: Chat Completions JSON. Imagem: Images API, Gemini Flash Image em 1K, uma arte por pedido.
 * Contrato e capacidades conferidos no catálogo público OpenRouter em 27/10/2026.
 */
export function openrouter(env: ConfiguracaoOpenrouter, buscar: Busca = fetch): Provedor {
  const pronta = openrouterPronto(env);
  const recusa = (motivo: string) => ({ ok: false as const, motivo, definitiva: true });
  const incerto = (motivo: string) => ({ ok: false as const, motivo, definitiva: false, incerto: true });
  const headers = {
    Authorization: `Bearer ${env.chave}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://aceleriq.online",
    "X-Title": "Aceleriq de Bolso",
  };
  const erroHttp = async (res: Response): Promise<Extract<ResultadoTexto, { ok: false }>> => {
    // O corpo pode conter dados da campanha ou de autenticação. Nunca o expor nem usá-lo como instrução.
    await res.body?.cancel().catch(() => {});
    if (res.status === 402) return recusa("A geração está temporariamente sem saldo no fornecedor. Seus créditos serão devolvidos.");
    if (res.status === 429) return { ok: false, motivo: "Limite temporário de requisições do fornecedor (429). Aguarde antes de tentar novamente.", definitiva: false };
    if (res.status >= 500) return { ok: false, motivo: `Fornecedor indisponível (${res.status}).`, definitiva: false };
    return recusa(`Fornecedor recusou o pedido (${res.status}).`);
  };
  return {
    async briefing(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      const ideia = ctx.entrada?.ideia?.trim() || "";
      if (!ideia || ideia.length > 1500) return recusa("Escreva uma ideia de até 1500 caracteres.");
      const pedido = pedidoDeBriefing(ctx.marca, ctx.briefing, ideia);
      if (pedido.usuario.length > LIMITE_CONTEXTO_CRIATIVO) return recusa("Resuma os dados da campanha antes de continuar.");
      let res: Response;
      try {
        res = await buscar("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers,
          body: JSON.stringify({ model: MODELO_ESTRUTURA, stream: false, max_tokens: LIMITE_SAIDA_CRIATIVA,
            reasoning: { effort: "low" }, response_format: { type: "json_object" }, provider: { allow_fallbacks: false },
            messages: [{ role: "system", content: pedido.sistema }, { role: "user", content: pedido.usuario }],
          }), signal: AbortSignal.timeout(60_000),
        });
      } catch { return incerto("Sem resposta do fornecedor de briefing."); }
      if (!res.ok) return erroHttp(res);
      let corpo;
      try { corpo = await res.json(); }
      catch (erro) { return erro instanceof SyntaxError ? recusa("Resposta do fornecedor ilegível.") : incerto("Sem resposta completa do fornecedor de briefing."); }
      try {
        const validado = validarBriefingGerado(JSON.parse(corpo.choices[0].message.content), ctx.briefing, ideia);
        if (validado.ok === false) return recusa(validado.motivo);
        return { ok: true, briefing: validado.briefing, custo: custoInformadoOpenrouter(MODELO_ESTRUTURA, corpo.usage) };
      } catch { return recusa("Resposta do fornecedor ilegível."); }
    },
    async texto(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      const modelo = ctx.natureza === "legenda" ? MODELO_COPY : modeloOpenrouterPermitido("texto", env.modeloTexto)!;
      const redacaoTerra = modelo === MODELO_COPY;
      const { sistema, usuario } = redacaoTerra ? pedidoDeLegenda(ctx.marca, ctx.briefing) : pedidoDeTexto(ctx.marca, ctx.briefing);
      if (usuario.length > LIMITE_CONTEXTO_CRIATIVO) return recusa("Resuma os dados da campanha antes de continuar.");
      let res: Response;
      try {
        res = await buscar("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST", headers,
          body: JSON.stringify({
            model: modelo, stream: false, max_tokens: 1200, response_format: { type: "json_object" },
            ...(redacaoTerra ? { reasoning: { effort: "none" }, provider: { allow_fallbacks: false } } : {}),
            messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch {
        return incerto("Sem resposta do fornecedor de texto.");
      }
      if (!res.ok) return erroHttp(res);
      let corpo;
      try {
        corpo = await res.json();
      } catch (erro) {
        return erro instanceof SyntaxError ? recusa("Resposta do fornecedor ilegível.") : incerto("Sem resposta completa do fornecedor de texto.");
      }
      try {
        const bruto = JSON.parse(corpo.choices[0].message.content);
        const v = validarConteudo(bruto, ctx.briefing);
        if (v.ok === false) return recusa(v.motivo);
        return { ok: true, conteudo: v.conteudo, custo: custoInformadoOpenrouter(modelo, corpo.usage) };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
    async imagem(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      if (!ctx.formato || !PROPORCOES_OPENROUTER[ctx.formato]) return recusa("Formato ausente ou inválido.");
      const modelo = modeloOpenrouterPermitido("imagem", env.modeloImagem)!;
      if (ctx.natureza === "ajuste" && (!ctx.referencias?.length || !ctx.entrada?.ajuste?.trim())) return recusa("Escolha a arte e descreva o ajuste visual.");
      if ((ctx.referencias?.length || 0) > 4) return recusa("Use até três referências e uma arte original.");
      const prompt = ctx.natureza === "ajuste"
        ? pedidoDeAjuste(ctx.versao, ctx.formato, ctx.entrada!.ajuste!)
        : pedidoDeImagem(ctx.marca, ctx.briefing, ctx.versao, ctx.formato)
          + (ctx.referencias?.length ? "\nUse as imagens anexadas como referência real do produto e da identidade. Preserve suas características; não substitua o produto por outro." : "");
      if (prompt.length > 24_000) return recusa("Resuma a direção visual e o ajuste antes de continuar.");
      let res: Response;
      try {
        res = await buscar("https://openrouter.ai/api/v1/images", {
          method: "POST", headers,
          body: JSON.stringify({
            model: modelo, prompt,
            resolution: "1K", aspect_ratio: PROPORCOES_OPENROUTER[ctx.formato], n: 1,
            ...(ctx.referencias?.length ? { input_references: ctx.referencias.map((url) => ({ type: "image_url", image_url: { url } })), provider: { allow_fallbacks: false } } : {}),
          }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        return incerto("Sem resposta do fornecedor de imagem.");
      }
      if (!res.ok) return erroHttp(res);
      let corpo;
      try {
        corpo = await res.json();
      } catch (erro) {
        return erro instanceof SyntaxError ? recusa("Resposta do fornecedor ilegível.") : incerto("Sem resposta completa do fornecedor de imagem.");
      }
      try {
        const b64 = corpo?.data?.[0]?.b64_json;
        // Só base64 da resposta. Nunca busca URLs remotas devolvidas pelo modelo ou pelo fornecedor.
        if (typeof b64 !== "string" || !b64.length || b64.length > LIMITE_IMAGEM_BASE64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) {
          return recusa("O fornecedor não devolveu uma imagem válida de até 10 MB.");
        }
        const bytes = deBase64(b64);
        if (bytes.length > LIMITE_IMAGEM_BYTES || !mimeReal(bytes)) return recusa("A imagem recebida não é um PNG, JPEG ou WEBP válido de até 10 MB.");
        return { ok: true, bytes, custo: custoInformadoOpenrouter(modelo, corpo.usage) };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
  };
}
