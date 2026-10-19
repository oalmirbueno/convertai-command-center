import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight, Loader2, RotateCcw, SlidersHorizontal, Wallet } from "lucide-react";
import { JanelaCentral, botao, campo, juntar, lista, texto } from "@/components/sistema";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { carregarCreditos, chaveDosCreditos, definirLimiteDosCreditos, lerCreditos, type CreditosDoLab, type MovimentoDeCredito } from "@/lib/laboratorio/api";

/**
 * Créditos do Laboratório (20/10/2026, pedido do dono: "ter o crédito no
 * Laboratório, poder carregar aqui dentro, para não misturar com os outros").
 * Uma carteira só do Laboratório (função laboratorio, ações creditos,
 * creditos_carregar e creditos_limite; migration 20261020050000).
 *
 * - Chip no cabeçalho: carteira + saldo; abre a janela.
 * - Janela: saldo, gasto do mês, carregar (só admin; registro manual, sem
 *   pagamento), ligar/desligar o limite (só admin), gasto por projeto e extrato.
 * - Limite desligado (o começo): rodar só registra o uso, nada trava. Ele liga
 *   na primeira carga.
 */

/** Os créditos (chip, janela e janela de custo usam a mesma leitura). */
export function useCreditosDoLab(ligado = true) {
  return useQuery({ queryKey: chaveDosCreditos, queryFn: lerCreditos, enabled: ligado, staleTime: 15_000 });
}

export function ChipDeCreditos() {
  const [aberta, setAberta] = useState(false);
  const q = useCreditosDoLab();
  const c = q.data;
  const nome = c && c.disponivel ? `Créditos do Laboratório: ${usd(c.saldo_usd)}${c.ativa ? "" : " (limite desligado)"}` : "Créditos do Laboratório";
  return (
    <>
      <button type="button" className={botao.barra} onClick={() => setAberta(true)} title={nome} aria-label={nome} data-chip-de-creditos="">
        <Wallet className="mr-1.5 h-4 w-4" aria-hidden="true" />
        <span className="tabular-nums">{c ? usd(c.saldo_usd) : q.isError ? "?" : "…"}</span>
      </button>
      <JanelaDeCreditos aberta={aberta} onFechar={() => setAberta(false)} />
    </>
  );
}

const ROTULO_DO_TIPO: Record<MovimentoDeCredito["tipo"], string> = { carga: "Carga", uso: "Uso", estorno: "Estorno", ajuste: "Ajuste" };

const quando = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
};

function LinhaDoExtrato({ m }: { m: MovimentoDeCredito }) {
  const entra = m.tipo === "carga" || m.tipo === "estorno";
  const Icone = m.tipo === "carga" ? ArrowDownLeft : m.tipo === "estorno" ? RotateCcw : m.tipo === "ajuste" ? SlidersHorizontal : ArrowUpRight;
  const detalhe = [m.projeto_nome, m.nota].filter(Boolean).join(" · ");
  return (
    <li className={juntar(lista.linha, "items-start")} data-movimento={m.tipo}>
      <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", entra ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={juntar(texto.corpo, "block truncate")}>{ROTULO_DO_TIPO[m.tipo]}{detalhe ? ` · ${detalhe}` : ""}</span>
        <span className={juntar(texto.auxiliar, "block truncate")}>{quando(m.criado_em)} · saldo {usd(m.saldo_depois)}</span>
      </span>
      <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums", entra ? "text-primary" : "")}>
        {m.tipo === "ajuste" ? "" : entra ? "+" : "−"}
        {m.tipo === "ajuste" ? "" : usd(m.valor_usd)}
      </span>
    </li>
  );
}

function Carregar({ c }: { c: CreditosDoLab }) {
  const queryClient = useQueryClient();
  const [valor, setValor] = useState("");
  const [nota, setNota] = useState("");
  const numero = Number(valor.replace(",", "."));
  const valido = Number.isFinite(numero) && numero >= 1 && numero <= 10000;
  const carregar = useMutation({
    mutationFn: () => carregarCreditos(Math.round(numero * 100) / 100, nota.trim()),
    onSuccess: (r) => {
      setValor("");
      setNota("");
      void queryClient.invalidateQueries({ queryKey: chaveDosCreditos });
      toast.success("Créditos carregados", { description: `Saldo do Laboratório: ${usd(r.saldo_usd)}.` });
    },
    onError: (e) => toast.error("Não deu para carregar", { description: textoDoErro(e) }),
  });
  const limite = useMutation({
    mutationFn: () => definirLimiteDosCreditos(!c.ativa),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: chaveDosCreditos });
      toast.success(r.ativa ? "Limite ligado" : "Limite desligado", { description: r.ativa ? "Rodar desconta do saldo e para quando acabar." : "Rodar só registra o uso, sem travar." });
    },
    onError: (e) => toast.error("Não deu para mudar o limite", { description: textoDoErro(e) }),
  });
  return (
    <section aria-label="Carregar créditos" data-carregar-creditos="">
      <h3 className={juntar(texto.rotulo, "mb-2")}>Carregar</h3>
      <form
        className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[120px_1fr_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (valido && !carregar.isPending) carregar.mutate();
        }}
      >
        <input
          type="number"
          inputMode="decimal"
          min={1}
          max={10000}
          step="0.01"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="US$"
          aria-label="Valor da carga em dólares (1 a 10.000)"
          className={campo}
          data-valor-da-carga=""
        />
        <input type="text" value={nota} onChange={(e) => setNota(e.target.value.slice(0, 400))} placeholder="Nota (opcional)" aria-label="Nota da carga" className={campo} />
        <button type="submit" className={botao.primario} disabled={!valido || carregar.isPending} data-confirmar-carga="">
          {carregar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Carregar
        </button>
      </form>
      <div className="mt-2 flex min-w-0 items-center justify-between">
        <span className={juntar(texto.auxiliar, "min-w-0 truncate")}>{c.ativa ? "Limite ligado: rodar desconta do saldo." : "Limite desligado: rodar só registra o uso."}</span>
        <button type="button" className={juntar(botao.discreto, "ml-2 h-8")} onClick={() => limite.mutate()} disabled={limite.isPending} data-alternar-limite="">
          {c.ativa ? "Desligar limite" : "Ligar limite"}
        </button>
      </div>
    </section>
  );
}

export function JanelaDeCreditos({ aberta, onFechar }: { aberta: boolean; onFechar: () => void }) {
  const q = useCreditosDoLab(aberta);
  const c = q.data;
  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo="Créditos do Laboratório"
      icone={<Wallet className="h-4 w-4" />}
      descricao={c && c.disponivel ? (c.ativa ? "Limite ligado" : "Limite desligado: só registra o uso") : undefined}
      ajuda="Carteira só do Laboratório, separada da carteira de IA dos clientes. Ao rodar, o custo estimado sai daqui; falha não cobra (volta como estorno). A carga é um registro manual, sem pagamento. Enquanto o limite está desligado, nada trava: o uso só fica no extrato. Ele liga na primeira carga."
      largura="md"
      data-janela-de-creditos=""
    >
      {q.isLoading ? (
        <p className={juntar(texto.auxiliar, "flex items-center")}>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
          Lendo os créditos
        </p>
      ) : q.isError ? (
        <p className={texto.auxiliar}>{textoDoErro(q.error)}</p>
      ) : c ? (
        <div className="min-w-0 space-y-6">
          {!c.disponivel ? <p className={juntar(texto.auxiliar, "text-warning")}>Os créditos entram quando o banco for atualizado. Até lá, nada trava.</p> : null}
          <div className="grid min-w-0 grid-cols-2 gap-4">
            <div className="min-w-0">
              <p className={texto.rotulo}>Saldo</p>
              <p className={juntar(texto.numero, "truncate")} data-saldo-do-lab="">{usd(c.saldo_usd)}</p>
            </div>
            <div className="min-w-0">
              <p className={texto.rotulo}>Gasto do mês</p>
              <p className={juntar(texto.numero, "truncate")}>{usd(c.gasto_mes_usd)}</p>
            </div>
          </div>

          {c.disponivel && c.pode_carregar ? <Carregar c={c} /> : c.disponivel ? <p className={texto.auxiliar}>Só o admin carrega créditos.</p> : null}

          {c.por_projeto.length ? (
            <section aria-label="Gasto por projeto">
              <h3 className={juntar(texto.rotulo, "mb-1")}>Gasto por projeto (mês)</h3>
              <ul className={juntar(lista.aberta, lista.divisoria)}>
                {c.por_projeto.map((p) => (
                  <li key={p.projeto_id || "sem"} className={juntar(lista.linha, "justify-between")}>
                    <span className={juntar(texto.corpo, "min-w-0 truncate")}>{p.projeto_nome}</span>
                    <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{usd(p.gasto_usd)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-label="Extrato">
            <h3 className={juntar(texto.rotulo, "mb-1")}>Extrato</h3>
            {c.movimentos.length ? (
              <ul className={juntar(lista.aberta, lista.divisoria)} data-extrato="">
                {c.movimentos.map((m) => (
                  <LinhaDoExtrato key={m.id} m={m} />
                ))}
              </ul>
            ) : (
              <p className={texto.auxiliar}>Nada no extrato ainda.</p>
            )}
          </section>
        </div>
      ) : null}
    </JanelaCentral>
  );
}
