/**
 * Monta o quadro de Configurações › Chaves e custos a partir do que o banco
 * devolve (chaves_admin_listar) e da presença dos segredos no ambiente da
 * função (frente CHV, 01/10/2026). Puro: roda no vitest.
 *
 * Regras:
 * - a chave em uso é a do servidor (ambiente) quando existe; senão, a do cofre;
 * - o último teste só vale se foi da mesma chave (mesma origem e mesmo final);
 *   senão a linha fica "Não testada";
 * - o gasto do mês é o da agência no ia_usos (o banco já tira a chave do cliente).
 */

import { type EstadoDaChave, type EventoDaChave, type GastoDoCliente, type IdDoProvedor, type LinhaDaChave, type NumerosDoProvedor, PROVEDORES, type ProvedorDoPainel, type QuadroDasChaves, SALDO_MINIMO_PADRAO_USD } from "./catalogo.ts";

export interface ListadoDoBanco {
  cofre?: Array<{ nome: string; provedor: string; final_chave: string; atualizado_em?: string }>;
  testes?: Array<{ provedor: string; estado: string; origem: string; final_chave: string | null; resultado?: unknown; testada_em: string }>;
  gasto_mes?: Record<string, unknown>;
  alertas?: Record<string, unknown>;
  por_cliente?: Array<{ client_id: string; nome?: string | null; mes_usd?: unknown; carteira_usd?: unknown }>;
  eventos?: EventoDaChave[];
}

/** Para cada segredo presente no ambiente, os últimos 4 caracteres. */
export type PresencaNoServidor = Record<string, string>;

const arred = (v: number, casas = 4) => Math.round(v * 10 ** casas) / 10 ** casas;

export function finalDe(valor: string): string {
  const v = String(valor || "").trim();
  return v.length >= 4 ? v.slice(-4) : v;
}

/** Origem e final da chave em uso de um provedor. */
export function chaveEmUso(p: ProvedorDoPainel, servidor: PresencaNoServidor, cofre: Record<string, string>): { origem: "servidor" | "painel" | null; final: string | null } {
  const origens = p.campos.map((c) => (servidor[c.nome] ? "servidor" : cofre[c.nome] ? "painel" : null));
  if (origens.some((o) => o === null)) return { origem: null, final: null };
  const primeiro = p.campos[0].nome;
  const origem = origens.indexOf("painel") >= 0 ? "painel" : "servidor";
  return { origem, final: servidor[primeiro] || cofre[primeiro] || null };
}

function numerosDe(resultado: unknown): { mensagem: string | null; numeros: NumerosDoProvedor } {
  const r = resultado && typeof resultado === "object" ? (resultado as Record<string, unknown>) : {};
  const numeros = r.numeros && typeof r.numeros === "object" ? (r.numeros as NumerosDoProvedor) : {};
  return { mensagem: typeof r.mensagem === "string" ? r.mensagem : null, numeros };
}

export function montarQuadro(listado: ListadoDoBanco, servidor: PresencaNoServidor, agora = new Date()): QuadroDasChaves {
  const cofre: Record<string, string> = {};
  (listado.cofre || []).forEach((c) => {
    cofre[c.nome] = c.final_chave;
  });
  const testes: Record<string, NonNullable<ListadoDoBanco["testes"]>[number]> = {};
  (listado.testes || []).forEach((t) => {
    testes[t.provedor] = t;
  });
  const gasto = listado.gasto_mes || {};
  const alertas = listado.alertas || {};

  const linhas: LinhaDaChave[] = PROVEDORES.map((p) => {
    const uso = chaveEmUso(p, servidor, cofre);
    const teste = testes[p.id];
    const mes = Number(gasto[p.id]);
    const ajustado = Number(alertas[p.id]);
    const minimo = alertas[p.id] !== undefined && alertas[p.id] !== null && isFinite(ajustado) ? ajustado : SALDO_MINIMO_PADRAO_USD;
    const base = {
      id: p.id,
      origem: uso.origem,
      no_painel: p.campos.some((c) => !!cofre[c.nome]),
      no_servidor: p.campos.some((c) => !!servidor[c.nome]),
      final: uso.final,
      mes_usd: isFinite(mes) ? arred(mes) : 0,
      saldo_minimo_usd: minimo,
      saldo_baixo: false,
    };
    if (!uso.origem) {
      return { ...base, estado: "sem_chave" as EstadoDaChave, testada_em: null, mensagem: null, numeros: {} };
    }
    const mesmaChave = !!teste && teste.origem === uso.origem && (teste.final_chave || null) === (uso.final || null);
    if (!mesmaChave) {
      return { ...base, estado: "nao_testada" as EstadoDaChave, testada_em: null, mensagem: teste ? "A chave mudou desde o último teste." : null, numeros: {} };
    }
    const { mensagem, numeros } = numerosDe(teste.resultado);
    const estado: EstadoDaChave = teste.estado === "valida" || teste.estado === "invalida" ? teste.estado : "nao_testada";
    const saldoBaixo = typeof numeros.saldo_usd === "number" && numeros.saldo_usd < minimo;
    return { ...base, estado, testada_em: teste.testada_em, mensagem, numeros, saldo_baixo: saldoBaixo };
  });

  // Total do mês: todos os provedores do registro de uso (não só os do catálogo).
  const total = Object.keys(gasto).reduce((s, k) => {
    const v = Number(gasto[k]);
    return s + (isFinite(v) ? v : 0);
  }, 0);
  const porCliente: GastoDoCliente[] = (listado.por_cliente || [])
    .map((c) => {
      const mesDoCliente = Number(c.mes_usd);
      const carteira = c.carteira_usd === null || c.carteira_usd === undefined ? null : Number(c.carteira_usd);
      return {
        client_id: String(c.client_id),
        nome: String(c.nome || "cliente sem nome").slice(0, 80),
        mes_usd: isFinite(mesDoCliente) ? arred(mesDoCliente) : 0,
        carteira_usd: carteira !== null && isFinite(carteira) ? arred(carteira) : null,
      };
    })
    .sort((a, b) => b.mes_usd - a.mes_usd);

  return {
    linhas,
    eventos: (listado.eventos || []).slice(0, 12),
    mes_total_usd: arred(total),
    por_cliente: porCliente,
    saldo_baixo: linhas.filter((l) => l.saldo_baixo).map((l) => l.id as IdDoProvedor),
    conferido_em: agora.toISOString(),
  };
}
