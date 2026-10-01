/** Montagem do supervisor com workers falsos, banco, cofre e bandeja falsos (usada por vários testes). */

import { createHash } from "node:crypto";
import path from "node:path";
import type { Banco, RespostaDoSinal } from "../banco.ts";
import type { EstadoDaBandeja } from "../bandeja.ts";
import { caminhos, type ConfigDaMaquina, type IdDoMotor } from "../config.ts";
import { cofreEmMemoria } from "../segredos.ts";
import { Supervisor } from "../supervisor.ts";
import { criarWorkerFalso, pastaTemp, registroEmMemoria } from "./apoio.ts";

export const CHAVE_DE_SERVICO = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.chave-de-servico-de-teste";
export const h = (v: string) => createHash("sha256").update(v).digest("hex").slice(0, 12);

export function bancoFalso(resposta: () => Partial<RespostaDoSinal>, chaves: Record<string, string> = {}) {
  const sinais: Array<Record<string, unknown>> = [];
  const b: Banco & { sinais: typeof sinais } = {
    sinais,
    async sinal(d) {
      sinais.push(d as unknown as Record<string, unknown>);
      return { maquina_id: "m-1", revogada: false, nome: null, motores: null, versao_alvo: null, ...resposta() };
    },
    async chaves() {
      return { ...chaves };
    },
    async urlDoPacote() {
      return "mem://pacote";
    },
    async baixar() {
      return new Uint8Array();
    },
  };
  return b;
}

export function montar(o: {
  motores?: IdDoMotor[];
  banco?: Banco;
  cofre?: Record<string, string>;
  comportamento?: Partial<Record<IdDoMotor, Parameters<typeof criarWorkerFalso>[3]>>;
  versao?: string | null;
  raiz?: string;
  raizDoCodigo?: string;
  extra?: Partial<ConstructorParameters<typeof Supervisor>[0]>;
}) {
  const raiz = o.raiz || pastaTemp();
  const c = caminhos(raiz);
  const raizDoCodigo = o.raizDoCodigo || path.join(raiz, "codigo");
  const dirs = {
    render: criarWorkerFalso(raizDoCodigo, "render", "principal.ts", o.comportamento?.render || { modo: "normal" }),
    codigo: criarWorkerFalso(raizDoCodigo, "motor-codigo", "worker.ts", o.comportamento?.codigo || { modo: "normal" }),
    navegador: criarWorkerFalso(raizDoCodigo, "computador", "principal.ts", o.comportamento?.navegador || { modo: "normal" }),
  };
  const maquina: ConfigDaMaquina = { maquina_id: null, nome: "Teste", motores: o.motores || ["render", "codigo", "navegador"], supabase_url: "https://exemplo.supabase.co", painel_url: "https://painel.exemplo" };
  const registro = registroEmMemoria();
  const regs: Record<string, ReturnType<typeof registroEmMemoria>> = {};
  const bandejas: EstadoDaBandeja[] = [];
  const saidas: number[] = [];
  const abertos: string[] = [];
  const cofre = cofreEmMemoria(o.cofre ?? { SUPABASE_SERVICE_ROLE_KEY: CHAVE_DE_SERVICO, OPENROUTER_API_KEY: "sk-or-local-0000000000000000" });
  const banco = o.banco || bancoFalso(() => ({}));
  const s = new Supervisor({
    c,
    maquina,
    versao: o.versao === undefined ? null : o.versao,
    raizDoCodigo,
    cofre,
    criarBanco: () => banco,
    criarBandeja: () => ({ mostrar: (e) => void bandejas.push(e), avisar: () => {}, fechar: () => {} }),
    registro,
    registroDe: (m) => (regs[m] = regs[m] || registroEmMemoria()),
    sair: (c) => void saidas.push(c),
    abrir: (a) => void abertos.push(a),
    ambiente: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, TEMP: process.env.TEMP, TMP: process.env.TMP, OPENROUTER_API_KEY: "sk-or-ambiente-111111111111111" },
    espera: { base: 100, teto: 1_000, estavel: 60_000 },
    prazoOcioso: 3_000,
    intervaloDoSinal: 200,
    intervaloDasChaves: 60_000,
    semNpm: true,
    hostname: "PC-TESTE",
    ...o.extra,
  });
  return { s, c, dirs, registro, regs, bandejas, saidas, abertos, cofre, banco, raiz, raizDoCodigo };
}

