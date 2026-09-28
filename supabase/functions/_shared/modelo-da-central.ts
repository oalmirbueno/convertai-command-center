/**
 * O modelo que escreve na Central, nos rituais, na semana e no mensal
 * (frente CE, 28/09/2026).
 *
 * O dono: "está usando o GPT 4.1, coloque o Luna 6 máximo". Padrão: GPT-6
 * Luna pelo OpenRouter com raciocínio "max", pelo mesmo motor das mesas
 * (_shared/ia-motor.ts: catálogo ia_modelos, chave do cliente ou da agência,
 * carteira de IA do cliente e registro do uso). O seletor da Central pode
 * escolher outro modelo do catálogo ou o GPT-4.1 antigo; a escolha vem no
 * pedido e é conferida aqui contra a lista.
 *
 * Reserva sem laço de correção: se o motor não conseguir (sem saldo na
 * carteira do cliente, provedor fora, tempo esgotado), a mesma mensagem é
 * escrita UMA vez pela cadeia antiga (gpt-4.1 > gpt-4o > gpt-4o-mini) e a
 * tela recebe o aviso do que aconteceu. Nunca duas escritas do mesmo modelo.
 *
 * Tempo: raciocínio máximo leva de 30 s a 2 min. Quem chama responde com
 * fôlego (resposta-com-folego.ts) para a plataforma não cortar em 150 s; aqui
 * o motor tem até 125 s e a reserva, o que sobrar.
 */

import {
  DEFAULT_LOVABLE_MODEL_CHAIN,
  requestAiChatCompletion,
  resolveAiProviderChain,
} from "./ai-provider.ts";

export const MODELO_PADRAO_DA_CENTRAL = "openrouter:openai/gpt-6-luna";
export const RACIOCINIO_PADRAO_DA_CENTRAL = "max";
/** A cadeia antiga (o que os rituais usavam até 28/09). */
export const MODELO_LEGADO = "legado:gpt-4.1";
export const CADEIA_LEGADA = ["gpt-4.1", "gpt-4o", "gpt-4o-mini"];

export const MODELOS_DA_CENTRAL: ReadonlyArray<{ id: string; rotulo: string }> = [
  { id: MODELO_PADRAO_DA_CENTRAL, rotulo: "GPT-6 Luna" },
  { id: "openrouter:openai/gpt-6-sol", rotulo: "GPT-6 Sol" },
  { id: MODELO_LEGADO, rotulo: "GPT-4.1 (antigo)" },
];
export const RACIOCINIOS_DA_CENTRAL = ["max", "xhigh", "high", "medium", "low"] as const;

export const TEMPO_DO_MOTOR_MS = 125_000;

export interface EscolhaDoModelo {
  modelo: string;
  raciocinio: string;
}

/** Confere a escolha que veio do navegador; o que não estiver na lista vira o padrão. */
export function escolhaDoModelo(modelo?: unknown, raciocinio?: unknown): EscolhaDoModelo {
  const m = typeof modelo === "string" && MODELOS_DA_CENTRAL.some((x) => x.id === modelo) ? modelo : MODELO_PADRAO_DA_CENTRAL;
  const r = typeof raciocinio === "string" && (RACIOCINIOS_DA_CENTRAL as readonly string[]).includes(raciocinio) ? raciocinio : RACIOCINIO_PADRAO_DA_CENTRAL;
  return { modelo: m, raciocinio: r };
}

export function rotuloDoModelo(id: string): string {
  return MODELOS_DA_CENTRAL.find((x) => x.id === id)?.rotulo ?? id.replace(/^openrouter:|^openai:|^legado:/, "");
}

export interface PedidoDeEscrita {
  clientId: string;
  sistema: string;
  usuario: string;
  escolha?: EscolhaDoModelo;
  /** Só a cadeia antiga usa; o raciocínio do motor não aceita temperatura. */
  temperatura?: number;
  criadoPor?: string | null;
  /** Para o registro do uso (ia_usos.referencia). */
  referencia?: { tipo: string; id: string };
}

export interface TextoEscrito {
  texto: string;
  /** Id do modelo que de fato respondeu. */
  modelo: string;
  rotulo: string;
  raciocinio: string | null;
  custoUsd: number | null;
  /** Aviso para a tela quando não foi o modelo escolhido. */
  reserva: string | null;
  usage?: unknown;
}

/** O motor, injetável para teste. Em produção vem de ia-motor.ts (import dinâmico). */
export type ChamadaDoMotor = (e: {
  clientId: string;
  modeloId: string;
  raciocinio: string;
  sistema: string;
  usuario: string;
  criadoPor?: string | null;
  referencia?: { tipo: string; id: string };
}) => Promise<{ texto: string; modeloId: string; custoUsd: number }>;

export type ChamadaLegada = (sistema: string, usuario: string, temperatura: number) => Promise<{ texto: string; modelo: string; usage: unknown } | null>;

async function motorDeVerdade(e: Parameters<ChamadaDoMotor>[0]) {
  // Import dinâmico: o ia-motor lê o ambiente do Deno e o Vitest não carrega.
  const { chamarTexto } = await import("./ia-motor.ts");
  const saida = await chamarTexto({
    clientId: e.clientId,
    tarefa: "conversa",
    agente: "estrategista",
    modeloId: e.modeloId,
    raciocinio: e.raciocinio,
    sistema: e.sistema,
    mensagens: [{ papel: "usuario", conteudo: e.usuario }],
    criadoPor: e.criadoPor ?? null,
    referencia: e.referencia,
    timeoutMs: TEMPO_DO_MOTOR_MS,
  });
  return { texto: saida.texto, modeloId: saida.modeloId, custoUsd: saida.custoUsd };
}

async function legadoDeVerdade(sistema: string, usuario: string, temperatura: number) {
  const providers = resolveAiProviderChain({ primaryModels: CADEIA_LEGADA, lovableModels: DEFAULT_LOVABLE_MODEL_CHAIN, openRouterReserve: true });
  const { response, provider } = await requestAiChatCompletion(providers, {
    messages: [{ role: "system", content: sistema }, { role: "user", content: usuario }],
    temperature: temperatura,
  });
  if (!response.ok) {
    console.warn(`[modelo-da-central] cadeia antiga esgotada, último: ${provider.label} HTTP ${response.status}`);
    return null;
  }
  const c = await response.json();
  return { texto: String(c?.choices?.[0]?.message?.content ?? ""), modelo: provider.model, usage: c?.usage ?? null };
}

function motivoLegivel(e: unknown): string {
  const codigo = e && typeof e === "object" && "codigo" in e ? String((e as { codigo: unknown }).codigo) : "";
  const porCodigo: Record<string, string> = {
    saldo_insuficiente: "sem saldo na carteira de IA do cliente",
    provedor_sem_chave: "sem chave do provedor",
    cliente_sem_chave: "cliente sem chave de IA",
    cota_da_chave_esgotada: "cota da chave do cliente esgotada",
    provedor_timeout: "o modelo demorou demais",
    openrouter_sem_credito: "OpenRouter sem crédito",
    modelo_inativo: "modelo desligado no catálogo",
    modelo_indisponivel: "modelo indisponível no provedor",
    resposta_vazia: "o modelo não devolveu texto",
  };
  return porCodigo[codigo] ?? (codigo || "falha do provedor");
}

/**
 * Escreve com o modelo escolhido; se ele falhar, uma vez pela cadeia antiga.
 * Devolve null só quando nenhum dos dois respondeu (quem chama usa o texto de
 * reserva do painel).
 */
export async function escreverComModeloDaCentral(
  p: PedidoDeEscrita,
  dependencias: { motor?: ChamadaDoMotor; legado?: ChamadaLegada } = {},
): Promise<TextoEscrito | null> {
  const escolha = p.escolha ?? escolhaDoModelo();
  const motor = dependencias.motor ?? motorDeVerdade;
  const legado = dependencias.legado ?? legadoDeVerdade;
  const temperatura = p.temperatura ?? 0.5;
  let reserva: string | null = null;

  if (escolha.modelo !== MODELO_LEGADO) {
    try {
      const r = await motor({
        clientId: p.clientId,
        modeloId: escolha.modelo,
        raciocinio: escolha.raciocinio,
        sistema: p.sistema,
        usuario: p.usuario,
        criadoPor: p.criadoPor,
        referencia: p.referencia,
      });
      if (r.texto.trim()) {
        return { texto: r.texto, modelo: r.modeloId, rotulo: rotuloDoModelo(r.modeloId), raciocinio: escolha.raciocinio, custoUsd: r.custoUsd, reserva: null };
      }
      reserva = `${rotuloDoModelo(escolha.modelo)} não devolveu texto; escrito com o GPT-4.1.`;
    } catch (e) {
      reserva = `${rotuloDoModelo(escolha.modelo)} indisponível (${motivoLegivel(e)}); escrito com o GPT-4.1.`;
      console.warn(`[modelo-da-central] motor falhou: ${motivoLegivel(e)}`);
    }
  }

  const antigo = await legado(p.sistema, p.usuario, temperatura).catch(() => null);
  if (!antigo || !antigo.texto.trim()) return null;
  return { texto: antigo.texto, modelo: antigo.modelo, rotulo: antigo.modelo, raciocinio: null, custoUsd: null, reserva, usage: antigo.usage };
}
