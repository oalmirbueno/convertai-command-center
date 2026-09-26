import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, Check, Circle, Loader2, Square } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  chamarFuncao,
  custoDaResposta,
  ErroDaMesa,
  inicioDoMes,
  limitesDoMes,
  padraoPara,
  rotuloDoMes,
  saidaPorRaciocinio,
  somarMeses,
  TAMANHOS,
  usd,
  type ParteDaEstimativa,
} from "@/lib/mesa/api";
import { AvisoDeErro, BotaoComCusto } from "./Custo";
import { useFiltroDaMarca, useMesa } from "./MesaContexto";
import { projetosDaListaNaMarca } from "@/lib/mesa/marcas";
import { atualizarAgenda, novoIdDaProposta } from "./mesaV4Api";
import MesEscolhaEditorial from "./MesEscolhaEditorial";
import { corpoDaEscolha, escolhaLivre, raciocinioPadraoDaTela, type EscolhaEditorial } from "./MesConhecimento";
import { useKitDoCliente } from "./contextoDoCliente";
import { chavesDoPlano, lerPlanosCombinados } from "./planoDoMes";
import { Campo, SeletorDeModelo, SeletorDeRaciocinio } from "./Seletores";

/**
 * Planejamento automático: a pessoa escolhe o período (de um mês até 12), a
 * frequência por semana, o objetivo e a oferta, e a tela faz sozinha, mês a
 * mês: propor_temas → escolhe os melhores temas pela nota do Jev (aderência +
 * potencial, na quantidade da frequência do mês) → escolher_temas → detalhar
 * → gravar na agenda do projeto de social do cliente.
 *
 * O andamento mora fora do componente (por cliente), então trocar de aba no
 * meio não perde o que já foi feito nem deixa começar outra rodada por cima.
 * Mês que falha mostra o erro e pode ser refeito sozinho, do passo onde parou.
 */

type Fase = "espera" | "temas" | "escolhendo" | "detalhando" | "gravando" | "gravado" | "erro" | "parado";

interface EstadoDoMes {
  mes: string;
  fase: Fase;
  alvo: number;
  propostaId: string | null;
  escolheu: boolean;
  detalhou: boolean;
  custo: number;
  itens: number | null;
  erro: unknown;
  /** Id da proposta que o propor_temas está criando (a linha acompanha os temas chegando). */
  acompanhar?: string | null;
}

interface ConfigDoPlano {
  frequenciaSemanal: number;
  objetivo?: string;
  oferta?: string;
  modeloId: string;
  raciocinio?: string;
  projetoId: string;
  escolha?: EscolhaEditorial;
}

interface Execucao {
  meses: string[];
  linhas: Record<string, EstadoDoMes>;
  config: ConfigDoPlano;
  rodando: boolean;
  parar: boolean;
}

interface TemaDaProposta {
  id: string;
  tema?: string;
  jev?: { aderencia?: number; potencial?: number } | null;
}

/** Erros que param a rodada toda: o próximo mês falharia do mesmo jeito. */
const CODIGOS_QUE_PARAM_TUDO = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave", "sem_modelo", "nao_autorizado", "somente_admin"];

// ------------------------------------------------------------------ andamento por cliente

const execucoes: Record<string, Execucao | undefined> = {};
const ouvintes: Record<string, Array<() => void>> = {};

function avisar(clientId: string) {
  (ouvintes[clientId] || []).slice().forEach((f) => f());
}

function useExecucao(clientId: string): Execucao | null {
  const [, setVersao] = useState(0);
  useEffect(() => {
    const f = () => setVersao((v) => v + 1);
    ouvintes[clientId] = (ouvintes[clientId] || []).concat([f]);
    return () => {
      ouvintes[clientId] = (ouvintes[clientId] || []).filter((x) => x !== f);
    };
  }, [clientId]);
  return execucoes[clientId] || null;
}

function mudarMes(clientId: string, mes: string, patch: Partial<EstadoDoMes>) {
  const ex = execucoes[clientId];
  if (!ex || !ex.linhas[mes]) return;
  ex.linhas = { ...ex.linhas, [mes]: { ...ex.linhas[mes], ...patch } };
  avisar(clientId);
}

// ------------------------------------------------------------------ contas do período

/** Período de um mês; no mês corrente começa hoje (não planeja dia passado). */
function periodoDoMes(mes: string): { inicio: string; fim: string } {
  const l = limitesDoMes(mes);
  if (mes === inicioDoMes()) {
    const d = new Date();
    const hoje = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { inicio: hoje > l.inicio ? hoje : l.inicio, fim: l.fim };
  }
  return l;
}

function diasUteis(inicio: string, fim: string): number {
  const a = new Date(`${inicio}T12:00:00`);
  const b = new Date(`${fim}T12:00:00`);
  let n = 0;
  for (let d = new Date(a.getTime()); d.getTime() <= b.getTime(); d.setDate(d.getDate() + 1)) {
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) n++;
  }
  return n;
}

/** Publicações do mês: frequência por semana vezes as semanas úteis do período. */
function publicacoesDoMes(mes: string, porSemana: number): number {
  const p = periodoDoMes(mes);
  const uteis = diasUteis(p.inicio, p.fim);
  if (uteis === 0) return 0;
  return Math.max(1, Math.round((porSemana * uteis) / 5));
}

function mesesEntre(de: string, ate: string): string[] {
  const lista: string[] = [];
  let m = de;
  for (let i = 0; i < 12 && m <= ate; i++) {
    lista.push(m);
    m = somarMeses(m, 1);
  }
  return lista;
}

const notaDoJev = (t: TemaDaProposta) => {
  const a = Number(t.jev && t.jev.aderencia);
  const p = Number(t.jev && t.jev.potencial);
  return (Number.isFinite(a) ? a : 0) + (Number.isFinite(p) ? p : 0);
};

/** Os melhores temas pela soma das notas do Jev; empate mantém a ordem do estrategista. */
function melhoresTemas(temas: TemaDaProposta[], quantidade: number): string[] {
  return temas
    .map((t, i) => ({ t, i, nota: notaDoJev(t) }))
    .sort((x, y) => y.nota - x.nota || x.i - y.i)
    .slice(0, Math.max(1, quantidade))
    .map((x) => x.t.id);
}

const idDaProposta = (d: any): string | null => (d && ((d.proposta && d.proposta.id) || d.proposta_id || d.id)) || null;

async function temasDaProposta(propostaId: string): Promise<TemaDaProposta[]> {
  const { data, error } = await (supabase as any).from("calendario_propostas").select("temas").eq("id", propostaId).maybeSingle();
  if (error) throw error;
  return Array.isArray(data && data.temas) ? data.temas : [];
}

const custoDoErro = (e: unknown): number => {
  if (e instanceof ErroDaMesa) {
    const c = Number((e.detalhes || {}).custo_usd);
    return Number.isFinite(c) ? c : 0;
  }
  return 0;
};

function partesDoMes(config: { modeloId: string; raciocinio?: string }, alvo: number, estado?: EstadoDoMes | null): ParteDaEstimativa[] {
  const partes: ParteDaEstimativa[] = [];
  const saida = saidaPorRaciocinio(config.raciocinio);
  if (!estado || !estado.propostaId) {
    partes.push({ modeloId: config.modeloId, tipo: "texto", tokensEntrada: TAMANHOS.proporTemas.entrada, tokensSaida: saida, buscasWeb: TAMANHOS.proporTemas.buscasWeb });
  }
  if (!estado || !estado.detalhou) {
    partes.push({ modeloId: config.modeloId, tipo: "texto", tokensEntrada: TAMANHOS.detalhar.entrada, tokensSaida: alvo * TAMANHOS.detalhar.saidaPorItem + saida });
  }
  return partes;
}

// ------------------------------------------------------------------ o motor

interface Ferramentas {
  clientId: string;
  queryClient: QueryClient;
  atualizarCusto: () => void;
}

/** Um mês, do passo em que parou até gravar. Nunca lança: o erro fica no mês. */
async function rodarMes(f: Ferramentas, mes: string): Promise<{ ok: boolean; parar: boolean; custo: number }> {
  const ex = execucoes[f.clientId];
  if (!ex) return { ok: false, parar: true, custo: 0 };
  const cfg = ex.config;
  const periodo = periodoDoMes(mes);
  let custo = 0;
  let temas: TemaDaProposta[] | null = null;
  mudarMes(f.clientId, mes, { erro: null });
  try {
    let estado = execucoes[f.clientId]!.linhas[mes];
    // A tentativa anterior caiu no meio mas os temas ficaram gravados: aproveita, sem pagar de novo.
    if (!estado.propostaId && estado.acompanhar) {
      const anterior = await temasDaProposta(estado.acompanhar).catch(() => [] as TemaDaProposta[]);
      if (anterior.length >= Math.min(estado.alvo, 8)) {
        temas = anterior;
        mudarMes(f.clientId, mes, { propostaId: estado.acompanhar });
      }
    }
    estado = execucoes[f.clientId]!.linhas[mes];
    if (!estado.propostaId) {
      const acompanhar = novoIdDaProposta();
      mudarMes(f.clientId, mes, { fase: "temas", acompanhar });
      const d = await chamarFuncao<any>("agente-calendario", {
        acao: "propor_temas",
        client_id: f.clientId,
        proposta_id: acompanhar,
        periodo_inicio: periodo.inicio,
        periodo_fim: periodo.fim,
        frequencia: estado.alvo,
        objetivo: cfg.objetivo,
        oferta: cfg.oferta,
        modelo_id: cfg.modeloId,
        raciocinio: cfg.raciocinio,
        ...corpoDaEscolha(cfg.escolha),
      });
      const c = custoDaResposta(d) || 0;
      custo += c;
      const id = idDaProposta(d);
      if (!id) throw new Error("O estrategista respondeu, mas a proposta não veio. Tente este mês de novo.");
      temas = d && d.proposta && Array.isArray(d.proposta.temas) ? d.proposta.temas : null;
      mudarMes(f.clientId, mes, { propostaId: id, custo: estado.custo + c });
      f.atualizarCusto();
    }
    estado = execucoes[f.clientId]!.linhas[mes];
    const propostaId = estado.propostaId as string;

    if (!estado.escolheu) {
      mudarMes(f.clientId, mes, { fase: "escolhendo" });
      const lista = temas || (await temasDaProposta(propostaId));
      if (!lista.length) throw new Error("A proposta deste mês veio sem temas. Tente este mês de novo.");
      await chamarFuncao("agente-calendario", { acao: "escolher_temas", proposta_id: propostaId, temas: melhoresTemas(lista, estado.alvo) });
      mudarMes(f.clientId, mes, { escolheu: true });
    }

    estado = execucoes[f.clientId]!.linhas[mes];
    if (!estado.detalhou) {
      mudarMes(f.clientId, mes, { fase: "detalhando" });
      // Antes (bug do "conteúdo não entra no mês"): o detalhar voltava 200 com
      // temas faltando, o mês marcava "detalhou" e o gravar recusava a proposta
      // não pronta para sempre, até na nova tentativa. Agora só marca com tudo
      // detalhado; o que faltou é pedido mais uma vez (só o resto).
      let faltam: unknown[] = [];
      for (let passada = 0; passada < 2; passada++) {
        const d = await chamarFuncao<any>("agente-calendario", {
          acao: "detalhar",
          proposta_id: propostaId,
          modelo_id: cfg.modeloId || undefined,
          raciocinio: cfg.raciocinio || undefined,
        });
        const c = custoDaResposta(d) || 0;
        custo += c;
        mudarMes(f.clientId, mes, { custo: execucoes[f.clientId]!.linhas[mes].custo + c });
        f.atualizarCusto();
        faltam = d && Array.isArray(d.faltam) ? d.faltam : [];
        if (!faltam.length) break;
      }
      if (faltam.length) {
        throw new Error(`Faltou detalhar ${faltam.length} tema(s) deste mês. O que ficou pronto está guardado: tente este mês de novo para fazer só o resto.`);
      }
      mudarMes(f.clientId, mes, { detalhou: true });
    }

    mudarMes(f.clientId, mes, { fase: "gravando" });
    const g = await chamarFuncao<any>("agente-calendario", { acao: "gravar", proposta_id: propostaId, project_id: cfg.projetoId });
    const n = Array.isArray(g && g.itens) ? g.itens.length : Array.isArray(g && g.proposta && g.proposta.task_ids) ? g.proposta.task_ids.length : null;
    mudarMes(f.clientId, mes, { fase: "gravado", itens: n });
    // Agenda do mês, lista do Estúdio (itens-do-mes) e propostas.
    atualizarAgenda(f.queryClient, f.clientId);
    return { ok: true, parar: false, custo };
  } catch (e) {
    const c = custoDoErro(e);
    custo += c;
    const linha = execucoes[f.clientId] ? execucoes[f.clientId]!.linhas[mes] : null;
    mudarMes(f.clientId, mes, { fase: "erro", erro: e, custo: (linha ? linha.custo : 0) + c });
    if (c) f.atualizarCusto();
    // Gravação parcial (409) já criou parte dos itens: a agenda relê igual.
    atualizarAgenda(f.queryClient, f.clientId);
    return { ok: false, parar: e instanceof ErroDaMesa && CODIGOS_QUE_PARAM_TUDO.indexOf(e.codigo) >= 0, custo };
  }
}

/**
 * Meses ao mesmo tempo (25/09): antes era um por vez e 4 meses levavam 4 vezes
 * o tempo de um. Cada mês grava assim que termina, então a agenda vai enchendo.
 */
export const MESES_EM_PARALELO = 3;

/** Roda os meses que faltam, até MESES_EM_PARALELO de cada vez, até acabar ou até pedirem para parar. */
async function rodarFila(f: Ferramentas, meses: string[]): Promise<{ custo_usd: number; gravados: number; falhas: number }> {
  const ex = execucoes[f.clientId];
  if (!ex || ex.rodando) return { custo_usd: 0, gravados: 0, falhas: 0 };
  ex.rodando = true;
  ex.parar = false;
  for (const m of meses) {
    const l = ex.linhas[m];
    if (l && (l.fase === "parado" || l.fase === "erro")) mudarMes(f.clientId, m, { fase: "espera" });
  }
  avisar(f.clientId);
  let custo = 0;
  let gravados = 0;
  let falhas = 0;
  try {
    let proximo = 0;
    const trabalhador = async () => {
      while (proximo < meses.length) {
        if (execucoes[f.clientId] !== ex) return;
        if (ex.parar) {
          for (const resto of meses.slice(proximo)) {
            if (ex.linhas[resto] && ex.linhas[resto].fase === "espera") mudarMes(f.clientId, resto, { fase: "parado" });
          }
          return;
        }
        const m = meses[proximo++];
        if (ex.linhas[m] && ex.linhas[m].fase === "gravado") continue;
        const r = await rodarMes(f, m);
        custo += r.custo;
        if (r.ok) gravados++;
        else falhas++;
        if (r.parar) ex.parar = true;
      }
    };
    await Promise.all(Array.from({ length: Math.min(MESES_EM_PARALELO, meses.length) }, trabalhador));
  } finally {
    ex.rodando = false;
    avisar(f.clientId);
  }
  return { custo_usd: custo, gravados, falhas };
}

// ------------------------------------------------------------------ tela

const ROTULO_DA_FASE: Record<Fase, string> = {
  espera: "na fila",
  temas: "propondo temas...",
  escolhendo: "escolhendo os melhores temas...",
  detalhando: "detalhando...",
  gravando: "gravando na agenda...",
  gravado: "gravado",
  erro: "falhou",
  parado: "parado",
};

function Passo({ rotulo, feito, agora }: { rotulo: string; feito: boolean; agora: boolean }) {
  return (
    <span className={`mr-3 inline-flex items-center text-[11.5px] ${feito ? "text-foreground" : agora ? "text-primary" : "text-muted-foreground"}`}>
      {feito ? (
        <Check className="mr-1 h-3.5 w-3.5 text-success" />
      ) : agora ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Circle className="mr-1 h-2.5 w-2.5" />
      )}
      {rotulo}
    </span>
  );
}

function ErroDoMes({ erro }: { erro: unknown }) {
  if (erro instanceof ErroDaMesa && erro.codigo === "provedor_timeout") {
    return (
      <p className="flex items-start rounded-lg border border-destructive/40 bg-card p-2.5 text-[12px] leading-relaxed">
        <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          O provedor de IA demorou demais e o tempo esgotou (504). O que este mês já tinha pronto fica guardado: tente este mês de novo.
        </span>
      </p>
    );
  }
  return <AvisoDeErro erro={erro} />;
}

function LinhaDoMes({
  estado,
  config,
  bloqueado,
  onTentarDeNovo,
  onVer,
}: {
  estado: EstadoDoMes;
  config: ConfigDoPlano;
  bloqueado: boolean;
  onTentarDeNovo: () => Promise<any>;
  onVer: () => void;
}) {
  const f = estado.fase;
  const rodando = f === "temas" || f === "escolhendo" || f === "detalhando" || f === "gravando";
  const idAcompanhado = estado.propostaId || estado.acompanhar || "";
  // Resultado parcial: temas e conteúdos aparecem conforme o estrategista grava.
  const parcial = useQuery({
    queryKey: ["mesa", "proposta-parcial", idAcompanhado],
    enabled: rodando && !!idAcompanhado && (f === "temas" || f === "detalhando"),
    refetchInterval: 4000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("calendario_propostas").select("temas, itens").eq("id", idAcompanhado).maybeSingle();
      if (error) throw error;
      return {
        temas: data && Array.isArray(data.temas) ? data.temas.length : 0,
        itens: data && Array.isArray(data.itens) ? data.itens.length : 0,
      };
    },
  });
  return (
    <li className="min-w-0 space-y-2 px-3.5 py-3">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mr-2 text-[13px] font-medium capitalize">{rotuloDoMes(estado.mes)}</p>
        <span
          className={`mr-2 rounded-full px-2 py-0.5 text-[11px] ${
            f === "gravado"
              ? "bg-success text-white"
              : f === "erro"
                ? "bg-destructive text-destructive-foreground"
                : rodando
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
          }`}
        >
          {ROTULO_DA_FASE[f]}
        </span>
        <span className="text-[11.5px] text-muted-foreground">
          {estado.alvo} {estado.alvo === 1 ? "publicação" : "publicações"}
          {estado.itens !== null ? ` · ${estado.itens} na agenda` : ""}
          {rodando && parcial.data && f === "temas" && parcial.data.temas > 0 ? ` · ${parcial.data.temas} temas chegaram` : ""}
          {rodando && parcial.data && f === "detalhando" ? ` · ${parcial.data.itens} de ${estado.alvo} detalhados` : ""}
          {estado.custo > 0 ? ` · ${usd(estado.custo)}` : ""}
        </span>
        {f === "gravado" && (
          <Button type="button" size="sm" variant="ghost" className="ml-auto h-7 px-2 text-[11.5px]" onClick={onVer}>
            Ver na agenda
          </Button>
        )}
      </div>
      {(rodando || f === "erro" || f === "gravado" || estado.propostaId) && (
        <div className="flex flex-wrap">
          <Passo rotulo="Temas" feito={!!estado.propostaId && estado.escolheu} agora={f === "temas" || f === "escolhendo"} />
          <Passo rotulo="Detalhe" feito={estado.detalhou} agora={f === "detalhando"} />
          <Passo rotulo="Agenda" feito={f === "gravado"} agora={f === "gravando"} />
        </div>
      )}
      {f === "erro" && (
        <div className="space-y-2">
          <ErroDoMes erro={estado.erro} />
          <BotaoComCusto
            rotulo="Tentar este mês de novo"
            titulo={`Refazer ${rotuloDoMes(estado.mes)}`}
            descricao="Refaz só este mês, a partir do passo que falhou. Os outros meses ficam como estão."
            variant="outline"
            className="h-8 text-[12px]"
            disabled={bloqueado}
            fecharAoConfirmar
            partes={() => partesDoMes(config, estado.alvo, estado)}
            executar={onTentarDeNovo}
          />
        </div>
      )}
    </li>
  );
}

// ------------------------------------------------------------------ pelo agente do mês

/**
 * Pedido ao agente do mês "crie todos os conteúdos de outubro" (25/09 à
 * noite): o cartão da conversa confirma com o custo e roda ESTE motor, o
 * mesmo do "Planejar e preencher a agenda", com o mesmo andamento.
 */
export interface GeracaoPeloAgente {
  /** Meses AAAA-MM-01. */
  meses: string[];
  frequenciaSemanal: number;
  modeloId: string;
  raciocinio?: string;
  projetoId: string;
}

/** Publicações de cada mês e a estimativa de custo (temas e detalhe de cada mês). */
export function estimativaDaGeracao(g: Pick<GeracaoPeloAgente, "meses" | "frequenciaSemanal" | "modeloId" | "raciocinio">) {
  const porSemana = Math.max(1, Math.min(14, Math.round(g.frequenciaSemanal) || 3));
  const alvos = g.meses.map((m) => publicacoesDoMes(m, porSemana));
  const partes = alvos.reduce((acc: ParteDaEstimativa[], alvo) => acc.concat(partesDoMes({ modeloId: g.modeloId, raciocinio: g.raciocinio }, alvo, null)), []);
  return { alvos, total: alvos.reduce((t, n) => t + n, 0), partes };
}

/** Começa a geração. Null quando já há uma rodada deste cliente em andamento. */
export function iniciarGeracaoPeloAgente(
  f: { clientId: string; queryClient: QueryClient; atualizarCusto: () => void },
  g: GeracaoPeloAgente,
): Promise<{ custo_usd: number; gravados: number; falhas: number }> | null {
  const atual = execucoes[f.clientId];
  if (atual && atual.rodando) return null;
  const { alvos } = estimativaDaGeracao(g);
  const linhas: Record<string, EstadoDoMes> = {};
  g.meses.forEach((m, i) => {
    linhas[m] = { mes: m, fase: "espera", alvo: alvos[i], propostaId: null, escolheu: false, detalhou: false, custo: 0, itens: null, erro: null };
  });
  execucoes[f.clientId] = {
    meses: g.meses.slice(),
    linhas,
    config: {
      frequenciaSemanal: Math.max(1, Math.min(14, Math.round(g.frequenciaSemanal) || 3)),
      modeloId: g.modeloId,
      raciocinio: g.raciocinio || undefined,
      projetoId: g.projetoId,
      escolha: escolhaLivre(),
    },
    rodando: false,
    parar: false,
  };
  avisar(f.clientId);
  return rodarFila(f, g.meses);
}

/** Andamento da rodada do cliente (a do agente ou a da tela), para o cartão da conversa. */
export function useAndamentoDaGeracao(clientId: string): { rodando: boolean; gravados: number; total: number; falhas: number; custo: number } | null {
  const ex = useExecucao(clientId);
  if (!ex) return null;
  const linhas = ex.meses.map((m) => ex.linhas[m]).filter((l): l is EstadoDoMes => !!l);
  return {
    rodando: ex.rodando,
    gravados: linhas.filter((l) => l.fase === "gravado").length,
    total: linhas.length,
    falhas: linhas.filter((l) => l.fase === "erro").length,
    custo: linhas.reduce((t, l) => t + (l.custo || 0), 0),
  };
}

export default function PlanejamentoAutomatico() {
  const mesa = useMesa();
  const { clientId, catalogo } = mesa;
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const execucao = useExecucao(clientId);

  const mesAtual = inicioDoMes();
  const [de, setDe] = useState(somarMeses(mesAtual, 1));
  const [ate, setAte] = useState(() => {
    const proximo = somarMeses(mesAtual, 1);
    const dezembro = `${proximo.slice(0, 4)}-12-01`;
    return dezembro >= proximo ? dezembro : proximo;
  });
  const [frequencia, setFrequencia] = useState("3");
  const [objetivo, setObjetivo] = useState("");
  const [oferta, setOferta] = useState("");
  const [modeloId, setModeloId] = useState("");
  const [raciocinio, setRaciocinio] = useState("");
  const [projetoId, setProjetoId] = useState("");
  const [escolha, setEscolha] = useState<EscolhaEditorial>(escolhaLivre);

  useEffect(() => {
    if (modeloId || !catalogo.length) return;
    const padrao = padraoPara(catalogo, "estrategista");
    if (!padrao) return;
    setModeloId(padrao.id);
    // Medium por padrão (25/09): o mais alto deixava cada mês lento demais.
    setRaciocinio(raciocinioPadraoDaTela(padrao.raciocinio));
  }, [catalogo, modeloId]);

  // Contexto facilita o mês: objetivo e oferta já vêm do contexto do cliente (só se o campo estiver vazio).
  const kit = useKitDoCliente(clientId);
  useEffect(() => {
    const c = kit.data && kit.data.contexto;
    if (!c) return;
    if (c.oferta && typeof c.oferta === "string") setOferta((v) => v || String(c.oferta).slice(0, 200));
  }, [kit.data]);

  const projetos = useQuery({
    queryKey: ["mesa", "projetos-social", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, name, status, project_type")
        .eq("client_id", clientId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as { id: string; name: string; status: string; project_type: string }[];
    },
  });
  // Projeto de social do cliente; sem nenhum de social, qualquer projeto.
  // Marca por projeto (Acerbi e CME): só os projetos da marca aberta; sem marca, todos.
  const filtroDaMarca = useFiltroDaMarca();
  const candidatos = useMemo(() => {
    const todos = projetos.data || [];
    const social = todos.filter((p) => p.project_type === "social_media");
    return projetosDaListaNaMarca(social.length ? social : todos, filtroDaMarca);
  }, [projetos.data, filtroDaMarca]);
  useEffect(() => {
    if (!projetoId && candidatos.length === 1) setProjetoId(candidatos[0].id);
  }, [candidatos, projetoId]);

  const opcoesDe = useMemo(() => Array.from({ length: 13 }, (_, i) => somarMeses(mesAtual, i)), [mesAtual]);
  const opcoesAte = useMemo(() => Array.from({ length: 12 }, (_, i) => somarMeses(de, i)), [de]);
  useEffect(() => {
    if (ate < de) setAte(de);
    else if (ate > somarMeses(de, 11)) setAte(somarMeses(de, 11));
  }, [de, ate]);

  const porSemana = Math.max(1, Math.min(14, Number(frequencia) || 3));
  const meses = mesesEntre(de, ate);
  // O plano combinado com o agente do mês entra no estrategista de cada mês.
  const planos = useQuery({ queryKey: chavesDoPlano.planos(clientId), queryFn: () => lerPlanosCombinados(clientId) });
  const mesesComPlano = meses.filter((m) => (planos.data || []).some((p) => p.mes === m.slice(0, 7)));
  const alvos = meses.map((m) => publicacoesDoMes(m, porSemana));
  const totalPublicacoes = alvos.reduce((t, n) => t + n, 0);
  const modelo = catalogo.find((m) => m.id === modeloId) || null;

  const trocarModelo = (id: string) => {
    setModeloId(id);
    setRaciocinio(raciocinioPadraoDaTela(catalogo.find((m) => m.id === id)?.raciocinio));
  };

  const ferramentas: Ferramentas = { clientId, queryClient, atualizarCusto: mesa.atualizarCusto };
  const rodando = !!(execucao && execucao.rodando);
  const pode = !!modeloId && !!projetoId && meses.length > 0 && !rodando;

  const comecar = () => {
    const linhas: Record<string, EstadoDoMes> = {};
    meses.forEach((m, i) => {
      linhas[m] = { mes: m, fase: "espera", alvo: alvos[i], propostaId: null, escolheu: false, detalhou: false, custo: 0, itens: null, erro: null };
    });
    execucoes[clientId] = {
      meses: meses.slice(),
      linhas,
      config: {
        frequenciaSemanal: porSemana,
        objetivo: objetivo.trim() || undefined,
        oferta: oferta.trim() || undefined,
        modeloId,
        raciocinio: raciocinio || undefined,
        projetoId,
        escolha,
      },
      rodando: false,
      parar: false,
    };
    avisar(clientId);
    return rodarFila(ferramentas, meses);
  };

  const concluir = (r: { gravados: number; falhas: number; custo_usd: number } | null) => {
    if (!r) return;
    const partes = [`${r.gravados} ${r.gravados === 1 ? "mês gravado" : "meses gravados"}`];
    if (r.falhas) partes.push(`${r.falhas} com erro`);
    const aviso = r.falhas ? toast.warning : toast.success;
    aviso("Planejamento automático", { description: `${partes.join(", ")}. Custo real: ${usd(r.custo_usd)}.` });
  };

  const verMes = (m: string) => {
    const next = new URLSearchParams(params);
    next.set("mes", m);
    setParams(next, { replace: true });
    const agenda = typeof document !== "undefined" ? document.getElementById("agenda-do-mes") : null;
    if (agenda && typeof agenda.scrollIntoView === "function") agenda.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const linhas = execucao ? execucao.meses.map((m) => execucao.linhas[m]).filter((l): l is EstadoDoMes => !!l) : [];
  const custoReal = linhas.reduce((t, l) => t + (l.custo || 0), 0);
  const faltam = linhas.filter((l) => l.fase === "parado" || l.fase === "espera").map((l) => l.mes);
  const gravados = linhas.filter((l) => l.fase === "gravado").length;

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div>
          <p className="flex items-center text-[13.5px] font-medium">
            <CalendarRange className="mr-1.5 h-4 w-4 text-primary" /> Planejar e preencher a agenda
          </p>
          <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
            Para cada mês do período, o estrategista propõe os temas, a Mesa escolhe os melhores pela nota do Jev, detalha e grava na agenda. Até três meses correm ao mesmo tempo e cada um entra na agenda assim que fica pronto; você pode parar a qualquer hora (o que já começou termina).
          </p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo rotulo="De">
            <Select value={de} onValueChange={setDe} disabled={rodando}>
              <SelectTrigger className="h-9 text-[12.5px] capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {opcoesDe.map((m) => <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Até (no máximo 12 meses)">
            <Select value={ate} onValueChange={setAte} disabled={rodando}>
              <SelectTrigger className="h-9 text-[12.5px] capitalize"><SelectValue /></SelectTrigger>
              <SelectContent>
                {opcoesAte.map((m) => <SelectItem key={m} value={m} className="capitalize">{rotuloDoMes(m)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
          <Campo rotulo="Publicações por semana">
            <Input type="number" min={1} max={14} value={frequencia} onChange={(e) => setFrequencia(e.target.value)} className="h-9" disabled={rodando} />
          </Campo>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Campo rotulo="Objetivo principal">
            <Input value={objetivo} onChange={(e) => setObjetivo(e.target.value)} placeholder="Ex.: pedidos pelo WhatsApp" className="h-9" disabled={rodando} />
          </Campo>
          <Campo rotulo="Oferta principal">
            <Input value={oferta} onChange={(e) => setOferta(e.target.value)} placeholder="Ex.: kit de mudas de outono" className="h-9" disabled={rodando} />
          </Campo>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SeletorDeModelo catalogo={catalogo} tipo="texto" valor={modeloId} onChange={trocarModelo} rotulo="Modelo do estrategista" disabled={rodando} />
          <SeletorDeRaciocinio modelo={modelo} valor={raciocinio} onChange={setRaciocinio} />
          <Campo rotulo="Projeto de social">
            <Select value={projetoId} onValueChange={setProjetoId} disabled={rodando || candidatos.length === 0}>
              <SelectTrigger className="h-9 text-[12.5px]">
                <SelectValue placeholder={projetos.isLoading ? "Lendo projetos..." : candidatos.length ? "Escolha o projeto" : "Cliente sem projeto ativo"} />
              </SelectTrigger>
              <SelectContent>
                {candidatos.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Campo>
        </div>
        <MesEscolhaEditorial valor={escolha} onChange={setEscolha} disabled={rodando} />
        <div className="flex flex-col border-t border-border pt-3 sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1 text-[12px] text-muted-foreground sm:mr-3">
            {meses.length} {meses.length === 1 ? "mês" : "meses"} · cerca de {totalPublicacoes} publicações
            {meses.length ? ` (${alvos.join(", ")} por mês)` : ""}. A estimativa soma temas e detalhe de cada mês.
            {mesesComPlano.length > 0 && (
              <span className="mt-0.5 flex items-center text-foreground">
                <Check className="mr-1 h-3.5 w-3.5 shrink-0 text-success" />
                {mesesComPlano.length === meses.length
                  ? "Todos os meses têm plano combinado com o agente do mês: o estrategista segue cada um."
                  : `Com plano combinado: ${mesesComPlano.map((m) => rotuloDoMes(m).split(" ")[0]).join(", ")}. O estrategista segue esses planos.`}
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center sm:mt-0 sm:justify-end">
            {rodando && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-1 mr-2"
                disabled={!!execucao && execucao.parar}
                onClick={() => {
                  if (!execucao) return;
                  execucao.parar = true;
                  avisar(clientId);
                }}
              >
                <Square className="mr-1.5 h-3.5 w-3.5" />
                {execucao && execucao.parar ? "Vai parar depois dos meses em andamento" : "Parar depois dos meses em andamento"}
              </Button>
            )}
            <BotaoComCusto
              rotulo={rodando ? "Planejando..." : `Planejar e preencher ${meses.length} ${meses.length === 1 ? "mês" : "meses"}`}
              titulo="Planejar e preencher a agenda"
              descricao="Para cada mês: propõe temas, escolhe os melhores pela nota do Jev, detalha e grava na agenda do projeto escolhido."
              className="mb-1"
              disabled={!pode}
              fecharAoConfirmar
              partes={() => {
                const cfg = { modeloId, raciocinio };
                return alvos.reduce((acc: ParteDaEstimativa[], alvo) => acc.concat(partesDoMes(cfg, alvo, null)), []);
              }}
              executar={comecar}
              aoConcluir={(r) => concluir(r)}
            />
          </div>
        </div>
      </section>

      {execucao && linhas.length > 0 && (
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center border-b border-border px-3.5 py-2.5">
            <p className="mr-2 text-[13px] font-medium">Andamento</p>
            <span className="text-[12px] text-muted-foreground">
              {gravados} de {linhas.length} {linhas.length === 1 ? "mês gravado" : "meses gravados"} · custo real {usd(custoReal)}
            </span>
            {!rodando && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto h-7 px-2 text-[11.5px]"
                onClick={() => {
                  delete execucoes[clientId];
                  avisar(clientId);
                }}
              >
                Limpar
              </Button>
            )}
          </div>
          <ul className="divide-y divide-border">
            {linhas.map((l) => (
              <LinhaDoMes
                key={l.mes}
                estado={l}
                config={execucao.config}
                bloqueado={rodando}
                onTentarDeNovo={() => rodarFila(ferramentas, [l.mes]).then((r) => { concluir(r); return r; })}
                onVer={() => verMes(l.mes)}
              />
            ))}
          </ul>
          {!rodando && faltam.length > 0 && (
            <div className="flex justify-end border-t border-border px-3.5 py-2.5">
              <BotaoComCusto
                rotulo={`Continuar os ${faltam.length} ${faltam.length === 1 ? "mês que falta" : "meses que faltam"}`}
                titulo="Continuar o planejamento"
                descricao="Segue do primeiro mês parado, um por vez."
                fecharAoConfirmar
                partes={() => faltam.reduce((acc: ParteDaEstimativa[], m) => acc.concat(partesDoMes(execucao.config, execucao.linhas[m].alvo, execucao.linhas[m])), [])}
                executar={() => rodarFila(ferramentas, faltam)}
                aoConcluir={(r) => concluir(r)}
              />
            </div>
          )}
        </section>
      )}
    </div>
  );
}
