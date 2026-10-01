/**
 * A fila do worker em dois sabores com a mesma forma:
 * - FilaSupabase (produção do piloto): motor_trabalhos, motor_eventos,
 *   motor_executores e o Storage `mesa`, com a service_role do ambiente;
 * - FilaLocal (teste de ponta a ponta e piloto sem banco): tudo em arquivos
 *   numa pasta (trabalhos/*.json, eventos/*.jsonl, armazem/<bucket>/<path>).
 *
 * O custo real vai para a carteira pela RPC ia_registrar_uso (só backend).
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EventoResumido, ModeloDoMotor } from "../../../supabase/functions/_shared/motor-codigo.ts";

export type LinhaDaFila = {
  id: string;
  client_id: string;
  marca_id: string | null;
  mesa: string;
  projeto: string;
  referencia_tipo: string | null;
  referencia_id: string | null;
  tipo: string;
  estado: string;
  modelo: string | null;
  instrucao: string;
  pedido: Record<string, unknown>;
  teto_usd: number;
  estimativa_usd: number | null;
  custo_usd: number;
  criado_por: string | null;
  /** Quem pegou o trabalho (a pegada grava; a gravação final confere). */
  executor?: string | null;
};

export type UsoDoTrabalho = { modeloId: string; provedor: string; tokensEntrada: number; tokensSaida: number; tokensCache: number; custoUsd: number; fonte: "provedor" | "tabela" };

export interface Fila {
  nome: string;
  pegar(executor: string): Promise<LinhaDaFila | null>;
  atualizar(id: string, campos: Record<string, unknown>): Promise<void>;
  /**
   * Frente MTR (rodada 2): a gravação FINAL só vale se o trabalho ainda está
   * executando/parando com ESTE executor. Se outro worker varreu como órfão
   * (batidas falharam por rede), não sobrescreve "falhou" com "feito":
   * devolve false e o worker registra um aviso.
   */
  fechar?(id: string, executor: string | null | undefined, campos: Record<string, unknown>): Promise<boolean>;
  evento(t: Pick<LinhaDaFila, "id" | "client_id">, ev: EventoResumido): Promise<void>;
  estado(id: string): Promise<string | null>;
  baixar(bucket: string, path: string): Promise<Uint8Array | null>;
  subir(bucket: string, path: string, bytes: Uint8Array, mime: string): Promise<void>;
  registrarUso(t: LinhaDaFila, u: UsoDoTrabalho): Promise<string | null>;
  mesclarPublicacao(siteId: string, dados: Record<string, unknown>): Promise<void>;
  batida(nome: string, info: { versao: string; capacidades: Record<string, unknown>; trabalho_id: string | null }): Promise<void>;
  /** Frente MTR: o mesmo modelo servido pelo OpenRouter (ids em ordem de preferência), para quando falta a chave do provedor direto. */
  modeloAlternativo?(ids: string[]): Promise<ModeloDoMotor | null>;
}

// ------------------------------------------------------------------ Supabase

export async function filaSupabase(url: string, chaveServico: string): Promise<Fila> {
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, chaveServico, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    nome: "supabase",
    async pegar(executor) {
      const { data, error } = await db.rpc("motor_pegar_trabalho", { _executor: executor, _mesas: ["site"] });
      if (error) throw new Error(`fila: ${error.message}`);
      const linha = (Array.isArray(data) ? data[0] : data) as LinhaDaFila | null;
      return linha && linha.id ? { ...linha, teto_usd: Number(linha.teto_usd) || 0, custo_usd: Number(linha.custo_usd) || 0 } : null;
    },
    async atualizar(id, campos) {
      const { error } = await db.from("motor_trabalhos").update(campos).eq("id", id);
      if (error) throw new Error(`fila: atualizar ${error.message}`);
    },
    async fechar(id, executor, campos) {
      let q = db.from("motor_trabalhos").update(campos).eq("id", id).in("estado", ["executando", "parando"]);
      if (executor) q = q.eq("executor", executor);
      const { data, error } = await q.select("id");
      if (error) throw new Error(`fila: fechar ${error.message}`);
      return Array.isArray(data) && data.length > 0;
    },
    async evento(t, ev) {
      const { error } = await db.from("motor_eventos").insert({ trabalho_id: t.id, client_id: t.client_id, tipo: ev.tipo, resumo: ev.resumo.slice(0, 300) || "-", dados: ev.dados || {} });
      if (error) console.error("[motor] evento não gravado:", error.message);
    },
    async estado(id) {
      const { data } = await db.from("motor_trabalhos").select("estado").eq("id", id).maybeSingle();
      return data ? String((data as { estado: string }).estado) : null;
    },
    async baixar(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async subir(bucket, path, bytes, mime) {
      const { error } = await db.storage.from(bucket).upload(path, new Blob([bytes as unknown as ArrayBuffer], { type: mime }), { contentType: mime, upsert: true });
      if (error) throw new Error(`storage: ${error.message}`);
    },
    async registrarUso(t, u) {
      if (!(u.custoUsd > 0)) return null;
      const { data, error } = await db.rpc("ia_registrar_uso", {
        _client_id: t.client_id,
        _tarefa: "site",
        _agente: "site",
        _modelo_id: u.modeloId,
        _provedor: u.provedor,
        _tokens_entrada: Math.round(u.tokensEntrada),
        _tokens_saida: Math.round(u.tokensSaida),
        _tokens_cache: Math.round(u.tokensCache),
        _imagens: 0,
        _qualidade: null,
        _custo_usd: Math.round(u.custoUsd * 1e6) / 1e6,
        _custo_fonte: u.fonte,
        _referencia_tipo: "motor_trabalho",
        _referencia_id: t.id,
        _criado_por: t.criado_por,
        _chave_origem: "agencia",
        _chave_id: null,
      });
      if (error) throw new Error(`carteira: ${error.message}`);
      const linha = (Array.isArray(data) ? data[0] : data) as { uso_id?: string } | null;
      return linha && linha.uso_id ? String(linha.uso_id) : null;
    },
    async mesclarPublicacao(siteId, dados) {
      const { data } = await db.from("sites").select("publicacao").eq("id", siteId).maybeSingle();
      const atual = data && typeof (data as { publicacao?: unknown }).publicacao === "object" ? ((data as { publicacao: Record<string, unknown> }).publicacao || {}) : {};
      const { error } = await db.from("sites").update({ publicacao: { ...atual, ...dados } }).eq("id", siteId);
      if (error) throw new Error(`site: ${error.message}`);
    },
    async batida(nome, info) {
      const { error } = await db.from("motor_executores").upsert({ nome, visto_em: new Date().toISOString(), versao: info.versao, capacidades: info.capacidades, trabalho_id: info.trabalho_id });
      if (error) console.error("[motor] batida não gravada:", error.message);
    },
    async modeloAlternativo(ids) {
      if (!ids.length) return null;
      const { data, error } = await db.from("ia_modelos").select("id, provedor, modelo_api, preco_entrada_1m, preco_saida_1m, preco_cache_1m, contexto_tokens").in("id", ids).eq("ativo", true);
      if (error) {
        console.error("[motor] catálogo indisponível para a rota pelo OpenRouter:", error.message);
        return null;
      }
      const linhas = (data || []) as ModeloDoMotor[];
      for (const id of ids) {
        const l = linhas.find((x) => x.id === id);
        if (l) return { ...l, preco_entrada_1m: Number(l.preco_entrada_1m), preco_saida_1m: Number(l.preco_saida_1m), preco_cache_1m: l.preco_cache_1m == null ? null : Number(l.preco_cache_1m) };
      }
      return null;
    },
  };
}

// ------------------------------------------------------------------ Local (arquivos)

export function filaLocal(pasta: string): Fila & { enfileirar(linha: LinhaDaFila): void; ler(id: string): Record<string, unknown>; eventos(id: string): EventoResumido[]; usos(): unknown[] } {
  const dirT = join(pasta, "trabalhos");
  const dirE = join(pasta, "eventos");
  const dirA = join(pasta, "armazem");
  for (const d of [dirT, dirE, dirA]) mkdirSync(d, { recursive: true });
  const arq = (id: string) => join(dirT, `${id}.json`);
  const ler = (id: string) => JSON.parse(readFileSync(arq(id), "utf8")) as Record<string, unknown>;
  const gravar = (id: string, v: Record<string, unknown>) => writeFileSync(arq(id), JSON.stringify(v, null, 2));
  return {
    nome: "local",
    enfileirar(linha) {
      gravar(linha.id, { ...linha, criado_em: new Date().toISOString() });
    },
    ler,
    eventos(id) {
      const f = join(dirE, `${id}.jsonl`);
      return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    },
    usos() {
      const f = join(pasta, "usos.jsonl");
      return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    },
    async pegar(executor) {
      const ids = readdirSync(dirT).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5));
      const linhas = ids.map((id) => ler(id)).filter((l) => l.estado === "na_fila").sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
      const l = linhas[0];
      if (!l) return null;
      const novo = { ...l, estado: "executando", executor, pego_em: new Date().toISOString() };
      gravar(String(l.id), novo);
      return novo as unknown as LinhaDaFila;
    },
    async atualizar(id, campos) {
      gravar(id, { ...ler(id), ...campos, atualizado_em: new Date().toISOString() });
    },
    async fechar(id, executor, campos) {
      const atual = ler(id);
      if (["executando", "parando"].indexOf(String(atual.estado)) < 0 || (executor && atual.executor !== executor)) return false;
      gravar(id, { ...atual, ...campos, atualizado_em: new Date().toISOString() });
      return true;
    },
    async evento(t, ev) {
      appendFileSync(join(dirE, `${t.id}.jsonl`), `${JSON.stringify({ ...ev, em: new Date().toISOString() })}\n`);
    },
    async estado(id) {
      return existsSync(arq(id)) ? String(ler(id).estado) : null;
    },
    async baixar(bucket, path) {
      const f = join(dirA, bucket, path);
      return existsSync(f) ? new Uint8Array(readFileSync(f)) : null;
    },
    async subir(bucket, path, bytes) {
      const f = join(dirA, bucket, path);
      mkdirSync(dirname(f), { recursive: true });
      writeFileSync(f, bytes);
    },
    async registrarUso(t, u) {
      if (!(u.custoUsd > 0)) return null;
      appendFileSync(join(pasta, "usos.jsonl"), `${JSON.stringify({ trabalho_id: t.id, client_id: t.client_id, tarefa: "site", agente: "site", ...u, em: new Date().toISOString() })}\n`);
      return `local-${t.id}`;
    },
    async mesclarPublicacao(siteId, dados) {
      appendFileSync(join(pasta, "publicacoes.jsonl"), `${JSON.stringify({ site_id: siteId, ...dados })}\n`);
    },
    async batida() {
      /* sem banco: nada a avisar */
    },
  };
}
