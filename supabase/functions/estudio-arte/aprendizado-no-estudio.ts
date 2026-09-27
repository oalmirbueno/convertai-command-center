/**
 * Aprendizado contínuo no Estúdio (frente AP, 27/09/2026): o lado Deno do
 * que as regras puras (_shared/aprendizado-continuo.ts e
 * _shared/aprendizado-das-entregas.ts) decidem.
 *
 * - aprenderComAEntrega: depois de ENTREGAR (post ou criativo de anúncio), em
 *   segundo plano, registra a memória da entrega UMA vez (leitura por visão
 *   barata da capa e de uma lâmina do miolo, pela cópia leve) e o padrão no
 *   cérebro; e aproveita para ligar as entregas antigas aos números reais (no
 *   máximo a cada 6 dias por cliente, sem IA).
 * - blocosParaALamina / blocoParaODiretor: o bloco "O QUE FUNCIONOU NAS
 *   ENTREGAS DESTE CLIENTE" (teto de 700 caracteres) e, na capa, a linha da
 *   variedade. Cliente sem entrega: vazio (o prompt fica como antes).
 *
 * Nada aqui derruba a entrega nem a geração: toda falha vira vazio ou log.
 */

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chamarTexto, type ImagemEntrada, modeloPadrao } from "../_shared/ia-motor.ts";
import { reduzidaSemTransformacao } from "../_shared/imagem-reduzida.ts";
import { gravarNoCerebro } from "../_shared/cerebro-nas-mesas.ts";
import { type ArquivoDaLamina, type DescricaoVisual, normalizarDescricao, type TrabalhoParaMemoria } from "../_shared/aprendizado-continuo.ts";
import {
  aprenderComOsNumeros,
  type BancoDoAprendizado,
  blocosDasEntregas,
  type GravarNoCerebro,
  registrarMemoriaDaEntrega,
} from "../_shared/aprendizado-das-entregas.ts";
import { MAX_PIXELS_LEITURA_EM_LOTE } from "./imagens-leves.ts";

let cache: SupabaseClient | null = null;
function servico(): SupabaseClient {
  if (!cache) {
    cache = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cache;
}
const banco = () => servico() as unknown as BancoDoAprendizado;

/** O padrão entra sem o Jev: o texto é canônico, a mesma receita já vira reforço pela chave. */
export const gravarSemJev: GravarNoCerebro = (novo) => gravarNoCerebro(servico(), novo, { julgar: null });

export const SISTEMA_DA_DESCRICAO_DA_ENTREGA = `Você descreve o DESIGN de lâminas de post já aprovadas e entregues, para a equipe lembrar do que funcionou e não repetir a composição exata.
Para cada campo, UMA frase curta e concreta (posição, escala, peso, cor com função). Sem opinião, sem copiar o texto das lâminas, sem nome da marca. Português do Brasil, sem travessão.
- capa: a composição da capa (onde ficam o título, a imagem e a logo; o que domina; o recorte da foto).
- miolo: como o conteúdo da lâmina do miolo foi desenhado (componente, grade, divisão); null quando só veio a capa.
- cor: a hierarquia de cor (fundo, texto, destaque).
- tipografia: peso, caixa e contraste de tamanho entre título e apoio.`;

export const ESQUEMA_DA_DESCRICAO_DA_ENTREGA = {
  nome: "descricao_da_entrega",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["capa", "miolo", "cor", "tipografia"],
    properties: {
      capa: { type: "string" },
      miolo: { type: ["string", "null"] },
      cor: { type: "string" },
      tipografia: { type: "string" },
    },
  },
};

/** Cópia leve de uma lâmina (768 px): a que existe ao lado ou pedida à copias-leves; nunca o original grande. */
async function laminaLeve(a: ArquivoDaLamina, nome: string): Promise<ImagemEntrada | null> {
  if (!a) return null;
  try {
    const r = await reduzidaSemTransformacao(servico(), a.bucket, a.caminho, 768, 768, {
      folga: 1.1,
      maxBytes: 20 * 1024 * 1024,
      pedirCopia: true,
      maxPixels: MAX_PIXELS_LEITURA_EM_LOTE,
    });
    return r && r.cabe ? { bytes: r.bytes, mime: r.mime, nome: `${nome}.${r.mime === "image/png" ? "png" : "jpg"}` } : null;
  } catch {
    return null;
  }
}

/** Leitura por visão barata (modelo de leitura do catálogo), uma vez por entrega; custo na carteira do cliente. */
async function lerVisaoDaEntrega(t: TrabalhoParaMemoria, capa: ArquivoDaLamina, miolo: ArquivoDaLamina, criadoPor: string): Promise<DescricaoVisual | null> {
  const [c, m] = await Promise.all([laminaLeve(capa, "capa"), laminaLeve(miolo, "miolo")]);
  if (!c) return null;
  const leitor = await modeloPadrao("leitura");
  if (!leitor) return null;
  const imagens = m ? [c, m] : [c];
  const r = await chamarTexto({
    clientId: t.client_id,
    tarefa: "leitura_referencia",
    agente: "leitor",
    modeloId: leitor.id,
    sistema: SISTEMA_DA_DESCRICAO_DA_ENTREGA,
    mensagens: [{ papel: "usuario", conteudo: m ? "Imagem 1: a capa. Imagem 2: uma lâmina do miolo." : "Imagem 1: a capa (post de lâmina única).", imagens }],
    esquemaJson: ESQUEMA_DA_DESCRICAO_DA_ENTREGA,
    maxTokensSaida: 800,
    referencia: { tipo: "estudio_trabalho", id: t.id },
    criadoPor,
  });
  return normalizarDescricao(r.json);
}

/** Trabalho depois da resposta (EdgeRuntime.waitUntil); sem ele, segue sozinho com o erro só no log. */
function emSegundoPlano(p: Promise<unknown>) {
  const seguro = p.catch((e) => console.error("[estudio-arte] aprendizado da entrega", { erro: e instanceof Error ? e.message : "desconhecido" }));
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(seguro);
}

/**
 * Depois de entregar: memória da entrega (uma vez) e os números das
 * entregas antigas. Em segundo plano: a entrega responde na hora.
 */
export function aprenderComAEntrega(t: TrabalhoParaMemoria, criadoPor: string, titulo?: string | null): void {
  emSegundoPlano((async () => {
    const r = await registrarMemoriaDaEntrega(banco(), t, {
      gravarNoCerebro: gravarSemJev,
      lerVisao: (capa, miolo) => lerVisaoDaEntrega(t, capa, miolo, criadoPor),
      titulo: titulo ?? null,
    });
    if (r.situacao === "falhou") console.error("[estudio-arte] memoria da entrega", { trabalho_id: t.id, erro: r.erro });
    if (r.situacao === "registrada") await aprenderComOsNumeros(banco(), t.client_id, { gravarNoCerebro: gravarSemJev });
  })());
}

/** Bloco das entregas para a lâmina (e a linha da variedade na capa). Vazio sem entrega ou com falha. */
export async function blocosParaALamina(t: { client_id: string; tipo?: string | null }, capa: boolean): Promise<{ bloco: string; variedade: string }> {
  const r = await blocosDasEntregas(banco(), t.client_id, { tipo: t.tipo === "ads" ? "ads" : "social", capa });
  return { bloco: r.bloco, variedade: r.variedade };
}

/** Bloco das entregas para o diretor de arte (sem a linha da variedade). */
export async function blocoParaODiretor(clientId: string, tipo?: string | null): Promise<string> {
  return (await blocosDasEntregas(banco(), clientId, { tipo: tipo === "ads" ? "ads" : "social" })).bloco;
}
