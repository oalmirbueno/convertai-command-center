import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CircleDollarSign, Pencil } from "lucide-react";
import {
  Carregando, EstadoDeErro, EstadoVazio, FaixaDeNumeros, Secao, SeletorCompacto,
  botao, campo, etiqueta, juntar, texto,
} from "@/components/sistema";
import { useFreelaContatos, useFreelaParcelas, useFreelaProjetos } from "./dadosFreela";
import { dataBR, fmtMoeda, hojeISO, ROTULO_STATUS_PARCELA, statusVisualDaParcela, type Moeda } from "@/lib/freela/freelaLib";

const corDaParcela: Record<string, string> = {
  aberta: "bg-warning/15 text-warning",
  atrasada: "bg-destructive/15 text-destructive",
  paga: "bg-success/15 text-success",
  cancelada: "bg-muted text-muted-foreground",
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
    <div className="min-w-0 space-y-4">
      {/* Um cartão por moeda: os números nunca se misturam. */}
      {(["BRL", "USD"] as Moeda[]).map((moeda) => {
        const t = totaisPorMoeda(moeda);
        return (
          <FaixaDeNumeros
            key={moeda}
            rotulo={moeda === "BRL" ? "Caixa em real (R$)" : "Caixa em dólar (US$)"}
            colunas={3}
            itens={[
              { rotulo: "Em aberto", valor: fmtMoeda(t.aberto, moeda), ponto: "aviso" as const },
              { rotulo: "Atrasado", valor: fmtMoeda(t.atrasado, moeda), ponto: "erro" as const },
              { rotulo: "Recebido no mês", valor: fmtMoeda(t.recebidoNoMes, moeda), ponto: "ok" as const },
            ]}
          />
        );
      })}

      <Secao
        titulo="Parcelas"
        descricao={`${lista.length} ${lista.length === 1 ? "parcela" : "parcelas"}`}
        ajuda="O vencimento que passou e segue em aberto aparece como atrasado. Baixar ou cancelar uma parcela é na aba Projetos."
        divisoria
      >
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
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
        </div>

        {lista.length === 0 ? (
          <EstadoVazio
            compacto
            icone={<CircleDollarSign className="h-5 w-5" />}
            titulo="Nenhuma parcela encontrada"
            descricao="Gere as parcelas de um projeto na aba Projetos."
          />
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((p) => {
              const visual = statusVisualDaParcela(p, hoje);
              const projeto = projetoPorId.get(p.projeto_id);
              return (
                <li key={p.id} className="flex min-w-0 items-center gap-2 px-1 py-2.5">
                  <div className="mr-1 min-w-0 flex-1">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>
                      {projeto?.titulo || "Projeto"} · Parcela {p.numero}
                    </p>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {projeto ? nomeDoContato(projeto.contato_id) : ""}
                      {" · "}vence {dataBR(p.vencimento)}
                      {p.status === "paga" && p.pago_em && <> · paga em {dataBR(p.pago_em)}</>}
                      {p.description && <> · {p.description}</>}
                    </p>
                  </div>
                  <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>{p.moeda === "USD" ? "US$" : "R$"}</span>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums text-foreground">{fmtMoeda(p.valor, p.moeda)}</span>
                  <span className={juntar(etiqueta, corDaParcela[visual] || "bg-muted text-muted-foreground")}>
                    {ROTULO_STATUS_PARCELA[visual] || visual}
                  </span>
                  <Link to="/freela/projetos" className={juntar(botao.barra, "inline-flex items-center")} aria-label="Abrir na aba Projetos">
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Secao>
    </div>
  );
}
