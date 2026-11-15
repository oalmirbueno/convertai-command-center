import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign, Pencil } from "lucide-react";
import {
  AjudaRecolhida, botao, campo, Carregando, EstadoDeErro, EstadoVazio, etiqueta, juntar, RegiaoRolavel, SeletorCompacto, texto,
  superficie,
} from "@/components/sistema";
import { Avatar, CardSurface, ProgressBar, StatusPill, type Tone } from "@/components/ds";
import { useFreelaContatos, useFreelaParcelas, useFreelaProjetos } from "./dadosFreela";
import { dataBR, fmtMoeda, hojeISO, ROTULO_STATUS_PARCELA, statusVisualDaParcela, type Moeda } from "@/lib/freela/freelaLib";

const tomDaParcela: Record<string, Tone> = {
  aberta: "warning",
  atrasada: "danger",
  paga: "success",
  cancelada: "neutral",
};

/**
 * Caixa do freela: todas as parcelas, com os totais SEMPRE separados por
 * moeda. Real e dólar nunca se somam nem se convertem.
 */
export default function AbaCaixa() {
  const { data: parcelas, isLoading, isError, refetch } = useFreelaParcelas();
  const { data: projetos } = useFreelaProjetos();
  const { data: contatos } = useFreelaContatos();
  const [filtroStatus, setFiltroStatus] = useState("todas");
  const [filtroMoeda, setFiltroMoeda] = useState("todas");
  const [filtroMes, setFiltroMes] = useState("");

  const hoje = hojeISO();
  const mesCorrente = hoje.slice(0, 7);

  const projetoPorId = useMemo(() => {
    const mapa = new Map<string, { titulo: string; contato_id: string }>();
    (projetos || []).forEach((p) => mapa.set(p.id, { titulo: p.titulo, contato_id: p.contato_id }));
    return mapa;
  }, [projetos]);

  const nomeDoContato = useMemo(() => {
    const mapa = new Map<string, string>();
    (contatos || []).forEach((c) => mapa.set(c.id, c.nome));
    return (id: string) => mapa.get(id) || "";
  }, [contatos]);

  const totaisPorMoeda = (moeda: Moeda) => {
    const doMesmo = (parcelas || []).filter((p) => p.moeda === moeda && p.status !== "cancelada");
    const aberto = doMesmo
      .filter((p) => p.status === "aberta" && p.vencimento >= hoje)
      .reduce((s, p) => s + Number(p.valor), 0);
    const atrasado = doMesmo
      .filter((p) => p.status === "aberta" && p.vencimento < hoje)
      .reduce((s, p) => s + Number(p.valor), 0);
    const recebidoNoMes = doMesmo
      .filter((p) => p.status === "paga" && (p.pago_em || "").slice(0, 7) === mesCorrente)
      .reduce((s, p) => s + Number(p.valor), 0);
    return { aberto, atrasado, recebidoNoMes };
  };

  const lista = useMemo(
    () =>
      (parcelas || []).filter((p) => {
        const visual = statusVisualDaParcela(p, hoje);
        if (filtroStatus !== "todas" && visual !== filtroStatus) return false;
        if (filtroMoeda !== "todas" && p.moeda !== filtroMoeda) return false;
        if (filtroMes && p.vencimento.slice(0, 7) !== filtroMes) return false;
        return true;
      }),
    [parcelas, filtroStatus, filtroMoeda, filtroMes, hoje],
  );

  if (isLoading) return <Carregando forma="lista" linhas={4} rotulo="Carregando o caixa" />;
  if (isError) {
    return (
      <EstadoDeErro
        titulo="Não foi possível carregar o caixa do freela."
        acao={<button type="button" onClick={() => void refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      {/* Um cartão por moeda: os números nunca se misturam. */}
      <div className="mb-5 grid min-w-0 shrink-0 grid-cols-1 gap-3 sm:gap-5 lg:grid-cols-2">
      {(["BRL", "USD"] as Moeda[]).map((moeda) => {
        const t = totaisPorMoeda(moeda);
        const aReceber = t.aberto + t.atrasado;
        return (
          <div key={moeda} role="group" aria-label={moeda === "BRL" ? "Caixa em real (R$)" : "Caixa em dólar (US$)"} className="min-w-0">
            <CardSurface padded variant={moeda === "BRL" ? "ink" : "default"} className="flex h-full min-w-0 flex-col">
              <div className="flex min-w-0 items-center">
                <span aria-hidden="true" className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-[13px] font-semibold text-foreground">{moeda === "USD" ? "US$" : "R$"}</span>
                <p className="min-w-0 truncate text-[13px] font-medium leading-5 text-muted-foreground">Recebido no mês · {moeda === "BRL" ? "real" : "dólar"}</p>
              </div>
              <p className="mt-4 truncate text-[32px] font-semibold leading-10 tracking-[-0.035em] tabular-nums text-foreground sm:text-[40px] sm:leading-[44px]">{fmtMoeda(t.recebidoNoMes, moeda)}</p>
              <dl className="mt-5 grid min-w-0 grid-cols-2 gap-x-4">
                <div className="min-w-0">
                  <dt className={juntar(texto.rotulo, "flex items-center")}><span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 rounded-full bg-warning" />Em aberto</dt>
                  <dd className="mt-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] tabular-nums text-foreground">{fmtMoeda(t.aberto, moeda)}</dd>
                </div>
                <div className="min-w-0">
                  <dt className={juntar(texto.rotulo, "flex items-center")}><span aria-hidden="true" className="mr-1.5 h-1.5 w-1.5 rounded-full bg-destructive" />Atrasado</dt>
                  <dd className={juntar("mt-1 truncate text-[20px] font-semibold leading-7 tracking-[-0.02em] tabular-nums", t.atrasado > 0 ? "text-destructive" : "text-foreground")}>{fmtMoeda(t.atrasado, moeda)}</dd>
                </div>
              </dl>
              {aReceber > 0 && (
                <div className="mt-auto pt-5">
                  <ProgressBar value={t.aberto} max={aReceber} striped label={`Em dia ${fmtMoeda(t.aberto, moeda)} de ${fmtMoeda(aReceber, moeda)} a receber`} />
                </div>
              )}
            </CardSurface>
          </div>
        );
      })}
      </div>

      <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2 pb-1">
          <SeletorCompacto
            opcoes={[
              { valor: "todas", rotulo: "Todas" },
              ...Object.entries(ROTULO_STATUS_PARCELA).map(([valor, rotulo]) => ({ valor, rotulo })),
            ]}
            valor={filtroStatus}
            onEscolher={setFiltroStatus}
            rotulo="Status da parcela"
            listaQuandoNaoCabe
          />
          <SeletorCompacto
            opcoes={[
              { valor: "todas", rotulo: "Todas as moedas" },
              { valor: "BRL", rotulo: "R$ Real" },
              { valor: "USD", rotulo: "US$ Dólar" },
            ]}
            valor={filtroMoeda}
            onEscolher={setFiltroMoeda}
            rotulo="Moeda"
          />
          <input
            type="month"
            value={filtroMes}
            onChange={(e) => setFiltroMes(e.target.value)}
            className={juntar(campo, "w-auto")}
            aria-label="Filtrar por mês de vencimento"
          />
          {filtroMes && (
            <button type="button" onClick={() => setFiltroMes("")} className={botao.barra}>
              Limpar mês
            </button>
          )}
          <p className={juntar(texto.auxiliar, "min-w-0 truncate tabular-nums")}>{lista.length} {lista.length === 1 ? "parcela" : "parcelas"}</p>
          <AjudaRecolhida className="ml-auto" rotulo="Sobre as parcelas">O vencimento que passou e segue em aberto aparece como atrasado. Baixar ou cancelar uma parcela é na aba Projetos.</AjudaRecolhida>
      </div>

      <RegiaoRolavel rotulo="Lista de parcelas" memoria="freela:caixa" className="min-w-0 lg:pb-12 lg:pr-1">
        {lista.length === 0 ? (
          <EstadoVazio
            compacto
            icone={<CircleDollarSign className="h-5 w-5" />}
            titulo="Nenhuma parcela encontrada"
            descricao="Gere as parcelas de um projeto na aba Projetos."
          />
        ) : (
          <ul className={juntar(superficie.painel, "divide-y divide-border/60 overflow-hidden [&>li]:px-4 sm:[&>li]:px-6")}>
            {lista.map((p) => {
              const visual = statusVisualDaParcela(p, hoje);
              const projeto = projetoPorId.get(p.projeto_id);
              return (
                <li key={p.id} className="flex min-w-0 items-center py-3.5 transition-colors hover:bg-muted/40">
                  <Avatar name={(projeto && nomeDoContato(projeto.contato_id)) || projeto?.titulo || "Projeto"} className="mr-3 hidden sm:inline-flex" />
                  <div className="mr-3 min-w-0 flex-1">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>
                      {projeto?.titulo || "Projeto"} · Parcela {p.numero}
                    </p>
                    <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>
                      {projeto ? nomeDoContato(projeto.contato_id) : ""}
                      {" · "}vence {dataBR(p.vencimento)}
                      {p.status === "paga" && p.pago_em && <> · paga em {dataBR(p.pago_em)}</>}
                      {p.description && <> · {p.description}</>}
                    </p>
                  </div>
                  <StatusPill tone={tomDaParcela[visual] || "neutral"} className="mr-3 max-sm:hidden">
                    {ROTULO_STATUS_PARCELA[visual] || visual}
                  </StatusPill>
                  <span className="mr-2 flex shrink-0 flex-col items-end">
                    <span className="text-[13px] font-semibold tabular-nums text-foreground">{fmtMoeda(p.valor, p.moeda)}</span>
                    <span className={juntar(etiqueta, "mt-1 bg-muted text-muted-foreground sm:hidden")}>{ROTULO_STATUS_PARCELA[visual] || visual}</span>
                  </span>
                  <Link to="/freela/projetos" className={juntar(botao.icone, "inline-flex items-center")} aria-label="Abrir na aba Projetos">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </RegiaoRolavel>
    </div>
  );
}
