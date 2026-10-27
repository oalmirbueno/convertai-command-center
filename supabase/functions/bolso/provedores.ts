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

export type ResultadoTexto = { ok: true; conteudo: ConteudoDaCampanha; custo?: { modelo: string; custo_usd: number } } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };
export type ResultadoImagem = { ok: true; bytes: Uint8Array; custo?: { modelo: string; custo_usd: number } } | { ok: false; motivo: string; definitiva: boolean; incerto?: boolean };

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

/** Adaptador OpenAI. NÃO VALIDADO em chamada real: nenhum gasto foi feito para testar. */
export function openai(env: { habilitado?: string; chave?: string; modeloTexto?: string; modeloImagem?: string }, buscar: Busca = fetch): Provedor {
  const pronta = openaiPronta(env);
  const recusa = (motivo: string) => ({ ok: false as const, motivo, definitiva: true });
  // Falha de rede ou tempo esgotado: o fornecedor pode ter processado. O job não é tocado: o lease vence e o
  // banco o marca "incerto" para a administração conferir (nunca repete sozinho nem devolve às cegas).
  // O custo real ainda não é medido: nada é registrado em bolso_custos_fornecedor até haver a medição.
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
      if (res.status === 429 || res.status >= 500) return { ok: false, motivo: `Fornecedor indisponível (${res.status}).`, definitiva: false };
      if (!res.ok) return recusa(`Fornecedor recusou o pedido (${res.status}).`);
      try {
        const corpo = await res.json();
        const bruto = JSON.parse(corpo.choices[0].message.content);
        const v = validarConteudo(bruto, ctx.briefing);
        if (!v.ok) return recusa(v.motivo);
        return { ok: true, conteudo: v.conteudo };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
    async imagem(ctx) {
      if (!pronta.ok) return recusa(pronta.motivo || "Geração real indisponível.");
      if (!ctx.formato) return recusa("Formato ausente.");
      const modelo = modeloPermitido("imagem", env.modeloImagem)!;
      const f = FORMATOS[ctx.formato];
      // Tamanhos aceitos pelo modelo; a arte final sai no formato pedido no recorte da tela do membro.
      const tamanho = f.altura > f.largura ? "1024x1536" : "1024x1024";
      let res: Response;
      try {
        res = await buscar("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: { Authorization: `Bearer ${env.chave}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: modelo, prompt: pedidoDeImagem(ctx.marca, ctx.briefing, ctx.versao, ctx.formato), size: tamanho, n: 1 }),
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        return incerto("Sem resposta do fornecedor de imagem.");
      }
      if (res.status === 429 || res.status >= 500) return { ok: false, motivo: `Fornecedor indisponível (${res.status}).`, definitiva: false };
      if (!res.ok) return recusa(`Fornecedor recusou o pedido (${res.status}).`);
      try {
        const corpo = await res.json();
        const b64 = corpo && corpo.data && corpo.data[0] && corpo.data[0].b64_json;
        if (typeof b64 !== "string") return recusa("Fornecedor não devolveu a imagem.");
        return { ok: true, bytes: deBase64(b64) };
      } catch {
        return recusa("Resposta do fornecedor ilegível.");
      }
    },
  };
}
