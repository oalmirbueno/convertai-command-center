import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CalendarPlus,
  CalendarRange,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  ImagePlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Send,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { rotuloDoMes, textoDoErro } from "@/lib/mesa/api";
import {
  mensagemDeCobranca,
  montarFila,
  useFeitoDaFila,
  useFilaDePrioridades,
  type AbaDaMesa,
  type AcaoDaFila,
  type FeitoDaFila,
  type GrupoDaFila,
  type MarcadoDaFila,
  type Nivel,
  type TipoDeAcao,
} from "@/lib/mesa/fila";

/**
 * Fila de prioridades da Mesa: uma lista curta, do mais urgente para o menos,
 * agrupada por cliente, com o porquê em uma frase e o botão que leva direto
 * para a aba certa. Regras de ordem em src/lib/mesa/fila.ts (acoesDoCliente).
 * Só clientes dentro da Mesa. Cada ação tem "Feito" para quando o sistema não
 * reconhece sozinho: some até chegar coisa nova, com "Desfazer" no aviso e na
 * lista dos marcados, no pé.
 */

const ICONE: Record<TipoDeAcao, typeof Send> = {
  resolver: AlertTriangle,
  gerar_mes: CalendarPlus,
  gerar_artes: ImagePlus,
  cobrar: BellRing,
  ajustar: Wrench,
  entregar: Send,
  revisar: Eye,
  completar_mes: CalendarRange,
};

const NIVEL: Record<Nivel, { rotulo: string; barra: string; selo: string; ponto: string }> = {
  agora: { rotulo: "Agora", barra: "bg-destructive", selo: "bg-destructive/10 text-destructive", ponto: "bg-destructive" },
  semana: { rotulo: "Esta semana", barra: "bg-warning", selo: "bg-warning/15 text-foreground", ponto: "bg-warning" },
  depois: { rotulo: "Depois", barra: "bg-border", selo: "bg-muted text-muted-foreground", ponto: "bg-muted-foreground/60" },
};

type Filtro = "tudo" | "cobrar" | "mes" | "artes" | "entrega";

const FILTROS: { chave: Filtro; rotulo: string; tipos: TipoDeAcao[] }[] = [
  { chave: "tudo", rotulo: "Tudo", tipos: [] },
  { chave: "cobrar", rotulo: "Cobrar aprovação", tipos: ["cobrar"] },
  { chave: "mes", rotulo: "Gerar mês", tipos: ["gerar_mes", "completar_mes"] },
  { chave: "artes", rotulo: "Gerar artes", tipos: ["gerar_artes", "ajustar"] },
  { chave: "entrega", rotulo: "Entregar", tipos: ["entregar", "revisar", "resolver"] },
];

const noFiltro = (f: Filtro, a: AcaoDaFila) => f === "tudo" || (FILTROS.find((x) => x.chave === f) || FILTROS[0]).tipos.indexOf(a.tipo) >= 0;

async function copiar(texto: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    /* tenta o jeito antigo */
  }
  try {
    const area = document.createElement("textarea");
    area.value = texto;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

const dataCurtinha = (iso: string | null) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/** "Gerar artes (outubro)" quando a ação é de um mês; senão só o título. */
const tituloComMes = (a: AcaoDaFila) => (a.mes ? `${a.titulo} (${rotuloDoMes(a.mes).split(" de ")[0]})` : a.titulo);

function LinhaDaAcao({
  acao,
  grupo,
  onAbrir,
  onFeito,
  gravando,
}: {
  acao: AcaoDaFila;
  grupo: GrupoDaFila;
  onAbrir: (clientId: string, aba: AbaDaMesa, mes: string | null) => void;
  onFeito: (grupo: GrupoDaFila, acao: AcaoDaFila) => void;
  gravando: boolean;
}) {
  const Icone = ICONE[acao.tipo];
  const nivel = NIVEL[acao.nivel];
  const cobrar = async () => {
    const link = typeof window !== "undefined" ? `${window.location.origin}/aprovacoes` : "/aprovacoes";
    const ok = await copiar(mensagemDeCobranca(grupo.nome, acao.quantidade, acao.diasEsperando || 0, link));
    if (ok) toast.success("Mensagem copiada", { description: "Cole no WhatsApp do cliente." });
    else toast.error("Não consegui copiar", { description: "Copie o texto à mão pela tela de aprovações." });
  };
  return (
    <li className="flex min-w-0 flex-wrap items-center py-2 sm:flex-nowrap">
      <span className={`mr-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${acao.nivel === "agora" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
        <Icone className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center text-[13px] font-semibold leading-tight">
          <span className="truncate">{acao.titulo}</span>
          <span className={`ml-2 h-1.5 w-1.5 shrink-0 rounded-full ${nivel.ponto}`} aria-label={nivel.rotulo} />
        </p>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{acao.motivo}</p>
      </div>
      <div className="mt-2 flex w-full shrink-0 items-center justify-end sm:ml-3 sm:mt-0 sm:w-auto">
        {acao.tipo === "cobrar" && (
          <button
            type="button"
            onClick={() => void cobrar()}
            className="mr-1.5 inline-flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium hover:border-primary/50"
            aria-label={`Copiar mensagem de cobrança para ${grupo.nome}`}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copiar mensagem
          </button>
        )}
        <button
          type="button"
          disabled={gravando}
          onClick={() => onFeito(grupo, acao)}
          className="mr-1.5 inline-flex h-8 items-center rounded-lg border border-border bg-card px-2.5 text-[12px] font-medium text-muted-foreground hover:border-success/60 hover:text-foreground disabled:opacity-60"
          aria-label={`Marcar como feito: ${acao.titulo} de ${grupo.nome}`}
          title="Já fiz: some da fila até chegar coisa nova"
        >
          {gravando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Feito
        </button>
        <button
          type="button"
          onClick={() => onAbrir(grupo.client_id, acao.aba, acao.mes)}
          className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-[12px] font-medium text-primary-foreground hover:opacity-90"
          aria-label={`${acao.titulo}: abrir ${grupo.nome}`}
        >
          Abrir <ArrowRight className="ml-1 h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export default function FilaDePrioridades({
  clientes,
  clientesProntos,
  onAbrir,
}: {
  clientes: { id: string; nome: string }[];
  /** A lista de clientes chegou (só a leitura direta precisa dela). */
  clientesProntos: boolean;
  onAbrir: (clientId: string, aba: AbaDaMesa, mes: string | null) => void;
}) {
  const consulta = useFilaDePrioridades(clientes, clientesProntos);
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const [verEmDia, setVerEmDia] = useState(false);
  const [verMarcados, setVerMarcados] = useState(false);
  const [gravando, setGravando] = useState<string | null>(null);
  const fila = useMemo(() => (consulta.data ? montarFila(consulta.data) : null), [consulta.data]);
  const { marcar, desfazer } = useFeitoDaFila();

  const desfazerFeito = async (clientId: string, nome: string, titulo: string, feito: FeitoDaFila) => {
    setGravando(feito.id);
    try {
      await desfazer(clientId, feito);
      toast.success("Voltou para a fila", { description: `${titulo}, ${nome}.` });
    } catch (e) {
      toast.error("Não consegui desfazer", { description: textoDoErro(e) });
    } finally {
      setGravando(null);
    }
  };

  const marcarFeito = async (g: GrupoDaFila, a: AcaoDaFila) => {
    setGravando(`${g.client_id}-${a.tipo}-${a.periodo}`);
    try {
      const feito = await marcar(g.client_id, a);
      toast.success("Marcado como feito", {
        description: `${a.titulo}, ${g.nome}. Volta se chegar coisa nova.`,
        action: { label: "Desfazer", onClick: () => void desfazerFeito(g.client_id, g.nome, a.titulo, feito) },
      });
    } catch (e) {
      toast.error("Não consegui marcar como feito", { description: textoDoErro(e) });
    } finally {
      setGravando(null);
    }
  };

  const contagem = (f: Filtro) => (fila ? fila.grupos.reduce((s, g) => s + g.acoes.filter((a) => noFiltro(f, a)).length, 0) : 0);
  const grupos = fila
    ? fila.grupos
        .map((g) => ({ ...g, acoes: g.acoes.filter((a) => noFiltro(filtro, a)) }))
        .filter((g) => g.acoes.length > 0)
    : [];

  return (
    <section aria-label="Prioridades" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between">
        <div className="mb-2 mr-4 min-w-0">
          <h2 className="text-[18px] font-semibold tracking-tight">O que fazer agora</h2>
          <p className="text-[12.5px] text-muted-foreground">Cada cliente com a próxima ação, do mais urgente para o menos.</p>
        </div>
        <div className="mb-2 flex items-center">
          {fila && (
            <ul className="mr-2 flex items-center text-[12px]" aria-label="Resumo">
              {(["agora", "semana", "depois"] as Nivel[]).map((n) => (
                <li key={n} className="mr-3 inline-flex items-center last:mr-0">
                  <span className={`mr-1.5 h-2 w-2 rounded-full ${NIVEL[n].ponto}`} />
                  <strong className="mr-1 font-semibold tabular-nums">{fila.resumo[n]}</strong>
                  <span className="text-muted-foreground">{NIVEL[n].rotulo.toLowerCase()}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => void consulta.refetch()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Atualizar prioridades"
            title="Atualizar"
          >
            {consulta.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {fila && fila.grupos.length > 0 && (
        <div role="group" aria-label="Filtrar por ação" className="flex flex-wrap">
          {FILTROS.map((f) => {
            const n = f.chave === "tudo" ? null : contagem(f.chave);
            if (n === 0) return null;
            return (
              <button
                key={f.chave}
                type="button"
                aria-pressed={filtro === f.chave}
                onClick={() => setFiltro(f.chave)}
                className={`mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-3 text-[12px] font-medium transition-colors ${
                  filtro === f.chave ? "border-foreground bg-foreground text-background" : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.rotulo}
                {n !== null && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {(consulta.isLoading || (!consulta.data && !consulta.isError)) && (
        <div aria-busy="true" aria-label="Carregando prioridades" className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {consulta.isError && (
        <p className="rounded-xl border border-destructive/40 bg-card p-3 text-[12.5px] text-destructive">
          Não consegui montar a fila. {textoDoErro(consulta.error)}
        </p>
      )}

      {fila && fila.grupos.length === 0 && (
        <div className="flex items-center rounded-xl border border-border bg-card p-5">
          <CheckCircle2 className="mr-3 h-5 w-5 shrink-0 text-success" />
          <p className="text-[13px]">Tudo em dia. Nenhum cliente precisa de ação agora.</p>
        </div>
      )}

      {grupos.length > 0 && (
        <ol className="space-y-2.5">
          {grupos.map((g, i) => {
            const nivel = NIVEL[g.acoes[0].nivel];
            return (
              <li key={g.client_id} className="relative overflow-hidden rounded-xl border border-border bg-card">
                <span className={`absolute bottom-0 left-0 top-0 w-1 ${nivel.barra}`} aria-hidden="true" />
                <div className="px-4 pb-1.5 pl-5 pt-3">
                  <div className="flex min-w-0 items-center">
                    <span className="mr-2 w-5 shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">{i + 1}</span>
                    <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{g.nome}</h3>
                    <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${nivel.selo}`}>{nivel.rotulo}</span>
                  </div>
                  {g.pronto && (
                    <p className="ml-7 mt-0.5 flex min-w-0 items-center text-[11.5px] text-muted-foreground">
                      <CheckCircle2 className="mr-1 h-3 w-3 shrink-0 text-success" />
                      <span className="truncate">{g.pronto}</span>
                    </p>
                  )}
                  <ul className="mt-1 divide-y divide-border">
                    {g.acoes.map((a) => (
                      <LinhaDaAcao
                        key={`${a.tipo}-${a.mes || ""}`}
                        acao={a}
                        grupo={g}
                        onAbrir={onAbrir}
                        onFeito={(gg, aa) => void marcarFeito(gg, aa)}
                        gravando={gravando === `${g.client_id}-${a.tipo}-${a.periodo}`}
                      />
                    ))}
                  </ul>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {fila && fila.grupos.length > 0 && grupos.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-5 text-center text-[13px] text-muted-foreground">Nada com esse filtro.</p>
      )}

      {fila && fila.emDia.length > 0 && (
        <div className="text-[12.5px] text-muted-foreground">
          <button type="button" onClick={() => setVerEmDia((v) => !v)} className="inline-flex items-center hover:text-foreground" aria-expanded={verEmDia}>
            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5 text-success" />
            {fila.emDia.length === 1 ? "1 cliente em dia" : `${fila.emDia.length} clientes em dia`}
          </button>
          {verEmDia && (
            <ul className="mt-2 flex flex-wrap">
              {fila.emDia.map((c) => (
                <li key={c.client_id} className="mb-1.5 mr-1.5">
                  <button
                    type="button"
                    onClick={() => onAbrir(c.client_id, "mes", null)}
                    title={c.pronto || undefined}
                    className="rounded-full border border-border bg-card px-2.5 py-1 text-[12px] text-foreground hover:border-primary/50"
                  >
                    {c.nome}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {fila && fila.marcados.length > 0 && (
        <div className="text-[12.5px] text-muted-foreground">
          <button type="button" onClick={() => setVerMarcados((v) => !v)} className="inline-flex items-center hover:text-foreground" aria-expanded={verMarcados}>
            <Check className="mr-1.5 h-3.5 w-3.5 text-success" />
            {fila.marcados.length === 1 ? "1 marcado como feito" : `${fila.marcados.length} marcados como feito`}
          </button>
          {verMarcados && (
            <ul className="mt-2 divide-y divide-border rounded-xl border border-border bg-card px-3" aria-label="Marcados como feito">
              {fila.marcados.map((m: MarcadoDaFila) => (
                <li key={m.feito.id} className="flex min-w-0 items-center py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-foreground">
                      <strong className="font-semibold">{m.nome}</strong>: {tituloComMes(m.acao)}
                    </p>
                    <p className="truncate text-[11.5px]">
                      Feito{m.feito.marcado_por_nome ? ` por ${m.feito.marcado_por_nome}` : ""}
                      {m.feito.marcado_em ? ` em ${dataCurtinha(m.feito.marcado_em)}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={gravando === m.feito.id}
                    onClick={() => void desfazerFeito(m.client_id, m.nome, m.acao.titulo, m.feito)}
                    className="ml-3 inline-flex h-7 shrink-0 items-center rounded-lg px-2 text-[12px] font-medium text-foreground hover:bg-muted disabled:opacity-60"
                    aria-label={`Desfazer feito: ${m.acao.titulo} de ${m.nome}`}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Desfazer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {consulta.data && consulta.data.origem === "direto" && (
        <p className="text-[11.5px] text-muted-foreground">
          Lido direto das tabelas: a função da fila ainda não foi aplicada no banco, então o último acesso de cada cliente não aparece.
        </p>
      )}
    </section>
  );
}
