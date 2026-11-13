import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { casa, fraseDoErro, lerFaturamento, reais, ROTULO_DO_ESTADO, type FaturamentoDoProduto as Faturamento } from "@/lib/produto/api";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  FaixaDeNumeros,
  GrupoDeCampos,
  JanelaCentral,
  Secao,
  botao,
  campo,
  etiqueta,
  juntar,
  lista,
  texto,
} from "@/components/sistema";

const ROTULO_DO_CUSTO: Record<string, string> = {
  taxa_asaas: "Taxas do Asaas",
  maquina_de_leads: "Máquina de leads",
  conferencia: "Conferências de IA",
  email: "E-mail",
  fixo: "Fixo",
  outro: "Outro",
};
const TIPOS_PARA_LANCAR = ["email", "maquina_de_leads", "conferencia", "fixo", "outro"];

/** O primeiro dia do mês de hoje, em São Paulo. */
export const mesDeHoje = () => `${new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 7)}-01`;

export function somarMeses(mes: string, passo: number): string {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(ano, m - 1 + passo, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function nomeDoMes(mes: string, curto = false): string {
  const [ano, m] = mes.split("-").map(Number);
  const nome = new Date(ano, m - 1, 1).toLocaleDateString("pt-BR", { month: curto ? "short" : "long" }).replace(".", "");
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}${curto ? "" : ` de ${ano}`}`;
}

/** O que sobra do mês: recebido menos taxas, imposto e os custos da casa. */
export const resultadoDoMes = (f: Pick<Faturamento, "recebido" | "custo_total">) => Math.round((f.recebido - f.custo_total) * 100) / 100;

/**
 * Faturamento e custo do produto CRM e E-mail (13/11/2026): quanto entra por
 * mês, de quem, o que está atrasado e quanto a casa gasta para entregar.
 * Mora no Financeiro e na administração do produto, lendo a mesma função.
 */
export default function FaturamentoDoProduto({ compacto = false }: { compacto?: boolean }) {
  const qc = useQueryClient();
  const [mes, setMes] = useState(mesDeHoje);
  const [lancando, setLancando] = useState(false);
  const fat = useQuery({ queryKey: ["produto", "faturamento", mes], queryFn: () => lerFaturamento(mes), placeholderData: (antes) => antes });
  const custos = useQuery({ queryKey: ["produto", "custos", mes], queryFn: () => casa.listarCustos(mes), enabled: !compacto });
  const reler = () => {
    void qc.invalidateQueries({ queryKey: ["produto", "faturamento"] });
    void qc.invalidateQueries({ queryKey: ["produto", "custos"] });
  };

  const seletorDeMes = (
    <div className="flex h-9 items-center" role="group" aria-label="Mês">
      <button type="button" className={botao.icone} onClick={() => setMes(somarMeses(mes, -1))} aria-label="Mês anterior" title="Mês anterior">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="min-w-[112px] px-1 text-center text-[13px] font-medium tabular-nums text-foreground" aria-live="polite">{nomeDoMes(mes)}</span>
      <button type="button" className={botao.icone} onClick={() => setMes(somarMeses(mes, 1))} disabled={mes >= mesDeHoje()} aria-label="Próximo mês" title="Próximo mês">
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );

  if (fat.isLoading) return <Carregando linhas={5} rotulo="Carregando o faturamento" />;
  if (fat.isError || !fat.data) {
    return <EstadoDeErro titulo="Não foi possível carregar o faturamento do produto." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void fat.refetch()}>Tentar de novo</button>} />;
  }
  const f = fat.data;
  const resultado = resultadoDoMes(f);
  const margem = f.recebido > 0 ? Math.round((resultado / f.recebido) * 100) : null;
  const maior = Math.max(1, ...f.serie.map((s) => Math.max(s.recebido, s.custos)));

  return (
    <div className="min-w-0 space-y-6" data-faturamento-do-produto="">
      <Secao
        titulo="CRM e E-mail"
        descricao={`${f.contas.ativas} ${f.contas.ativas === 1 ? "empresa ativa" : "empresas ativas"} · ${f.contas.usuarios_pagos} ${f.contas.usuarios_pagos === 1 ? "usuário pago" : "usuários pagos"}`}
        ajuda="Receita recorrente é a soma das mensalidades das empresas ativas e em atraso. Recebido é o que o Asaas confirmou no mês. O custo soma as taxas do Asaas, o imposto estimado, o custo fixo, o e-mail e o que foi lançado."
        acao={seletorDeMes}
      >
        <FaixaDeNumeros
          rotulo="Faturamento do produto"
          itens={[
            { rotulo: "Receita recorrente", valor: reais(f.mrr), apoio: "por mês" },
            {
              rotulo: "Recebido no mês",
              valor: reais(f.recebido),
              apoio: [f.a_receber > 0 ? `${reais(f.a_receber)} a receber` : "", f.atrasado > 0 ? `${reais(f.atrasado)} em atraso` : ""].filter(Boolean).join(" · ") || "confirmado no Asaas",
              ponto: f.atrasado > 0 ? "alerta" : "verde",
            },
            { rotulo: "Custo do mês", valor: reais(f.custo_total), apoio: `taxas ${reais(f.taxas)} · imposto ${reais(f.imposto)}` },
            { rotulo: "Resultado", valor: reais(resultado), apoio: margem == null ? "sem recebimento no mês" : `${margem}% de margem`, ponto: resultado >= 0 ? "verde" : "perigo" },
          ]}
        />
      </Secao>

      {!compacto && (
        <Secao titulo="Últimos 6 meses" recolher="produto:faturamento:serie">
          <div className="grid min-w-0 grid-cols-6 items-end gap-2" role="img" aria-label="Recebido e custos por mês" data-serie-do-produto="">
            {f.serie.map((s) => (
              <div key={s.mes} className="min-w-0 text-center" title={`${nomeDoMes(s.mes)}: recebido ${reais(s.recebido)}, custos lançados ${reais(s.custos)}`}>
                <div className="mx-auto flex h-24 w-full max-w-[56px] items-end justify-center">
                  <span className="mr-1 block w-1/2 rounded-sm bg-primary" style={{ height: `${Math.max(2, Math.round((s.recebido / maior) * 100))}%` }} />
                  <span className="block w-1/2 rounded-sm bg-muted-foreground/40" style={{ height: `${Math.max(2, Math.round((s.custos / maior) * 100))}%` }} />
                </div>
                <span className={juntar(texto.etiqueta, "mt-1 block truncate text-muted-foreground")}>{nomeDoMes(s.mes, true)}</span>
              </div>
            ))}
          </div>
        </Secao>
      )}

      <Secao titulo="Por empresa" descricao={`${f.por_conta.length}`} recolher="produto:faturamento:contas">
        {f.por_conta.length === 0 ? (
          <EstadoVazio compacto titulo="Nenhuma empresa no produto ainda." />
        ) : (
          <ul className={juntar(lista.aberta, lista.divisoria)} data-faturamento-por-conta="">
            {f.por_conta.map((c) => (
              <li key={c.conta_id} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {ROTULO_DO_ESTADO[c.estado]} · {c.usuarios} {c.usuarios === 1 ? "usuário" : "usuários"} · {reais(c.mensal)} por mês
                  </span>
                </span>
                {c.aberto > 0 && <span className={juntar(etiqueta, "ml-2 bg-warning/10 text-warning")}>{reais(c.aberto)} em aberto</span>}
                <span className="ml-3 w-[96px] shrink-0 text-right">
                  <span className={juntar(texto.corpo, "block tabular-nums")}>{reais(c.recebido)}</span>
                  {c.custo > 0 && <span className={juntar(texto.auxiliar, "block tabular-nums")}>custo {reais(c.custo)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {!compacto && (
        <Secao
          titulo="Custos do mês"
          descricao={reais(f.custo_total)}
          ajuda="As taxas do Asaas entram sozinhas a cada pagamento, e o Google Maps da Máquina de leads entra como estimativa a cada busca. O custo fixo, o imposto e o custo por caixa de e-mail vêm dos Preços. O resto você lança aqui."
          acao={
            <button type="button" className={botao.icone} onClick={() => setLancando(true)} aria-label="Lançar custo" title="Lançar custo" data-lancar-custo="">
              <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
            </button>
          }
        >
          <ul className={juntar(lista.aberta, lista.divisoria)} data-custos-do-produto="">
            <li className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Imposto estimado sobre o recebido</span>
              <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.imposto)}</span>
            </li>
            <li className={lista.linha}>
              <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Custo fixo do produto</span>
              <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.custo_fixo)}</span>
            </li>
            {f.custo_email > 0 && (
              <li className={lista.linha}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>Caixas de e-mail além do plano gratuito</span>
                <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(f.custo_email)}</span>
              </li>
            )}
            {(custos.data || []).map((c) => (
              <li key={c.id} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{c.descricao || ROTULO_DO_CUSTO[c.tipo] || c.tipo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {ROTULO_DO_CUSTO[c.tipo] || c.tipo}
                    {c.estimado ? " · estimado" : ""}
                  </span>
                </span>
                <span className={juntar(texto.corpo, "ml-3 shrink-0 tabular-nums")}>{reais(c.valor)}</span>
                <button
                  type="button"
                  className={juntar(botao.icone, "ml-1")}
                  aria-label={`Apagar o custo ${c.descricao || c.tipo}`}
                  title="Apagar"
                  onClick={() => void casa.apagarCusto(c.id).then(reler).catch((e) => toast.error(fraseDoErro(e)))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      {lancando && <LancarCusto mes={mes} contas={f.por_conta} onFechar={() => setLancando(false)} onSalvo={reler} />}
    </div>
  );
}

function LancarCusto({ mes, contas, onFechar, onSalvo }: { mes: string; contas: Faturamento["por_conta"]; onFechar: () => void; onSalvo: () => void }) {
  const [tipo, setTipo] = useState("outro");
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [conta, setConta] = useState("");
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const v = parseFloat(valor.replace(/\./g, "").replace(",", "."));
    if (!(v > 0)) return void toast.error("Informe um valor maior que zero.");
    setSalvando(true);
    try {
      await casa.lancarCusto({ conta_id: conta || null, competencia: mes, tipo, valor: Math.round(v * 100) / 100, descricao: descricao.trim() });
      onSalvo();
      onFechar();
      toast.success("Custo lançado.");
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível lançar."));
    } finally {
      setSalvando(false);
    }
  };
  return (
    <JanelaCentral
      aberta
      onFechar={onFechar}
      largura="sm"
      titulo="Lançar custo"
      descricao={nomeDoMes(mes)}
      rodape={<button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>{salvando ? "Salvando..." : "Lançar"}</button>}
    >
      <GrupoDeCampos colunas={1}>
        <CampoDeFormulario rotulo="Tipo">
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={campo}>
            {TIPOS_PARA_LANCAR.map((t) => <option key={t} value={t}>{ROTULO_DO_CUSTO[t]}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Valor (R$)" obrigatorio>
          <input value={valor} onChange={(e) => setValor(e.target.value)} className={campo} inputMode="decimal" placeholder="0,00" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="O que é">
          <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} maxLength={160} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Empresa" apoio="Vazio quando o custo é do produto todo">
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo}>
            <option value="">Produto todo</option>
            {contas.map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
          </select>
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
