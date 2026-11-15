import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Lightbulb, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, Secao, SeletorCompacto, botao, campo, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import { Etiqueta, Numeros, fundoDoTom, grafico, tabela, type Tom } from "@/components/finance/pecasDoFinanceiro";
import { ChartLegend, ProgressBar } from "@/components/ds";
import { EVENTO_ABRIR_AGENTE } from "@/lib/lancador";
import { useDadosDoCFO } from "@/lib/cfo/dadosDoCFO";
import ConversaDoCFO from "./ConversaDoCFO";
import { valorDigitadoEmReais } from "@/lib/financeiro/valorDigitado";
import {
  avaliarGasto,
  reais,
  retratoDoCFO,
  type Nivel,
  type Retrato,
} from "../../../supabase/functions/agente-cfo/modulos/cfo-calculos";

/**
 * Financeiro › CFO (frente CFO, 30/09): o campo próprio do agente financeiro.
 * Painel de saúde, limite do mês (com o simulador "posso gastar?"), onde o
 * dono está errando, o que fazer neste mês, projeção de 6 a 12 meses, onde
 * cortar e o plano de crescimento com metas. Ao lado, a conversa com o CFO.
 * Todos os números vêm do motor em código (cfo-calculos.ts), o mesmo da
 * função e da trava. Só admin (a rota e a aba já são só dele; RLS idem).
 */

const TOM_DO_NIVEL: Record<Nivel, Tom> = { critico: "perigo", atencao: "aviso", bom: "sucesso" };
const ROTULO_DO_NIVEL: Record<Nivel, string> = { critico: "Agir agora", atencao: "Atenção", bom: "No caminho" };
const ICONE_DO_NIVEL = { critico: AlertTriangle, atencao: Lightbulb, bom: CheckCircle2 };

const tomDaSaude = (nota: number): "verde" | "info" | "alerta" | "perigo" => (nota >= 80 ? "verde" : nota >= 60 ? "info" : nota >= 35 ? "alerta" : "perigo");
const mesesEmTexto = (m: number | null) => (m === null ? "sem custo fixo" : `${String(m).replace(".", ",")} ${m >= 0.95 && m < 1.95 ? "mês" : "meses"}`);

function abrirNoAssist() {
  try {
    window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_AGENTE, { detail: { servico: "cfo" } }));
  } catch {
    /* navegador sem CustomEvent: o campo de conversa ao lado já atende */
  }
}

export default function AreaDoCFO() {
  const { user } = useAuth();
  const dados = useDadosDoCFO(user?.id);
  const [meses, setMeses] = useEstadoDaTela<string>("financeiro:cfo:meses", "6", { validar: (v) => v === "6" || v === "12" });
  const retrato = useMemo<Retrato | null>(() => (dados.data ? retratoDoCFO(dados.data, { meses: 12 }) : null), [dados.data]);

  if (dados.isLoading) return <Carregando forma="aba" rotulo="Fazendo a conta do CFO" />;
  if (dados.isError || !retrato) {
    return (
      <EstadoDeErro
        titulo="Não consegui ler o financeiro para o CFO."
        descricao={dados.error instanceof Error ? dados.error.message : "Tente de novo."}
        acao={<button type="button" onClick={() => void dados.refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  const r = retrato;
  const l = r.limiteQueVale;
  const n = meses === "12" ? 12 : 6;

  return (
    <div className="grid min-w-0 grid-cols-1 gap-6 sm:gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start" data-area-do-cfo="">
      <div className="min-w-0 space-y-8">
        <Numeros
          rotulo="Saúde financeira"
          // Número grande: 3 por fileira onde cabem (com a conversa ao lado, 2). A saúde ocupa a fileira quando são 2.
          grade="grid-cols-2 md:grid-cols-3 xl:grid-cols-2 min-[1700px]:grid-cols-3 max-md:[&>*:first-child]:col-span-2 xl:max-[1699px]:[&>*:first-child]:col-span-2"
          tamanho="lg"
          itens={[
            {
              rotulo: "Saúde",
              valor: `${r.saude.nota}/100`,
              apoio: r.saude.rotulo,
              ponto: tomDaSaude(r.saude.nota),
              variante: r.saude.nota >= 60 ? "accent" : "ink",
              extra: <ProgressBar value={r.saude.nota} max={100} striped label={`Saúde financeira: ${r.saude.nota} de 100`} />,
            },
            { rotulo: "Caixa livre", valor: reais(r.caixa.saldoLivre), apoio: `caixa ${reais(r.caixa.saldo)} menos caixinhas`, ponto: r.caixa.saldoLivre >= 0 ? "verde" : "perigo", variante: r.caixa.saldoLivre >= 0 && r.saude.nota >= 60 ? "ink" : "default", corDoValor: r.caixa.saldoLivre < 0 ? "text-destructive" : undefined },
            { rotulo: "Fôlego", valor: mesesEmTexto(r.folego.meses), apoio: "se a receita parar", ponto: r.folego.meses !== null && r.folego.meses >= 3 ? "verde" : r.folego.meses !== null && r.folego.meses >= 1 ? "alerta" : "perigo", variante: "default" },
            { rotulo: "Sobra da carteira", valor: reais(r.margem.mensal), apoio: "por mês, depois da estrutura", ponto: r.margem.mensal >= 0 ? "verde" : "perigo", variante: "default", corDoValor: r.margem.mensal < 0 ? "text-destructive" : undefined },
            { rotulo: `Limite de ${l.rotulo.split(" ")[0]}`, valor: reais(l.valor), apoio: l.recorrente > 0 ? `fixo novo até ${reais(l.recorrente)}/mês` : "nenhum custo fixo novo", ponto: l.valor > 0 ? "verde" : "perigo", variante: "default" },
          ]}
        />

        <LimiteDoMes retrato={r} />

        <Secao
          titulo="Onde você está errando"
          descricao={`${r.alertas.filter((a) => a.nivel !== "bom").length} ponto(s)`}
          recolher="financeiro:cfo:erros"
          ajuda="Cada ponto é uma regra em código sobre os lançamentos reais: estrutura maior que a carteira, assinaturas de IA sobrepostas, pró-labore acima da escada do Plano Diretor, gasto pessoal no caixa, atrasados, contas paradas, preço abaixo da tabela, sem reserva."
        >
          <ul className="min-w-0 space-y-3">
            {r.alertas.map((a) => {
              const Icone = ICONE_DO_NIVEL[a.nivel];
              return (
                <li key={a.chave} className={juntar(superficie.poco, "flex min-w-0 p-4 sm:p-5")} data-alerta-do-cfo={a.chave}>
                  <span aria-hidden="true" className={juntar("mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full", fundoDoTom[TOM_DO_NIVEL[a.nivel]])}>
                    <Icone className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Etiqueta tom={TOM_DO_NIVEL[a.nivel]}>{ROTULO_DO_NIVEL[a.nivel]}</Etiqueta>
                    <p className="mt-2 text-[13px] font-semibold leading-5 text-foreground">{a.titulo}</p>
                    <p className={juntar(texto.auxiliar, "mt-0.5 leading-5")}>{a.detalhe}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Secao>

        <Secao
          titulo={`O que fazer em ${l.rotulo.split(" ")[0]}`}
          descricao={`${r.acoesDoMes.length} passo(s), na ordem`}
          recolher="financeiro:cfo:mes"
          ajuda="A ordem é a do CFO: primeiro o dinheiro que já é seu (atrasados), depois o que vaza todo mês (custo fixo), depois preço e venda. Cobrança a cliente é sempre você quem envia: o painel não manda nada sozinho."
        >
          <ol className="min-w-0">
            {r.acoesDoMes.map((a, i) => (
              <li key={a.chave} className={juntar(texto.corpo, "flex min-w-0 items-start py-3.5")}>
                <span aria-hidden="true" className={juntar("mr-3 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums", i === 0 ? "bg-foreground text-background" : "bg-muted text-foreground")}>{i + 1}</span>
                <span className="min-w-0 flex-1 pt-1.5">
                  <span className="font-semibold">{a.titulo}.</span> <span className="text-muted-foreground">{a.detalhe}</span>
                </span>
              </li>
            ))}
            {!r.acoesDoMes.length && <li className={juntar(texto.corpo, "py-3")}>Nada urgente: mantenha a rotina e guarde a sobra na reserva.</li>}
          </ol>
        </Secao>

        <Secao
          titulo="Projeção"
          descricao={`${n} meses · saldo livre no fim de cada mês`}
          recolher="financeiro:cfo:projecao"
          ajuda="Entradas: mensalistas ativos (a cobrança lançada do mês quando existe; paga antes já está no caixa) mais avulsos e parcelas em aberto. Atrasado não entra: está em cobrar. Saídas: contas a pagar e custos fixos que se repetem (anual no mês dele). Imposto estimado de 6% vai para a caixinha. Conservador: 15% a menos de entrada."
          acao={
            <SeletorCompacto
              opcoes={[{ valor: "6", rotulo: "6 meses" }, { valor: "12", rotulo: "12 meses" }]}
              valor={meses}
              onEscolher={(v) => setMeses(v === "12" ? "12" : "6")}
              rotulo="Meses da projeção"
            />
          }
        >
          <Projecao retrato={r} meses={n} />
        </Secao>

        <Secao
          titulo="Onde cortar"
          descricao={`${r.cortes.filter((c) => !c.essencial).length} custo(s) não essenciais · estrutura ${reais(r.estrutura.custoFixoTotal)}/mês`}
          recolher="financeiro:cfo:cortes"
          ajuda="Custos fixos (mensal e anual dividido por 12), do maior para o menor. Essencial (contador, infraestrutura do painel, impostos) fica no fim e não é sugerido. Para cortar com Confirmar e Desfazer, peça ao CFO: 'onde corto?'."
        >
          <ul className="min-w-0">
            {r.cortes.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-3.5" data-corte-do-cfo={c.essencial ? "essencial" : "cortavel"}>
                <div className="mr-3 min-w-0 flex-1">
                  <p className={juntar("truncate text-[13px] font-medium leading-5", c.essencial ? "text-muted-foreground" : "text-foreground")}>{c.descricao}</p>
                  <p className={juntar(texto.auxiliar, "mt-0.5 truncate")}>{c.essencial ? "essencial" : c.motivo}</p>
                </div>
                {r.estrutura.custoFixoTotal > 0 && (
                  <span className="mr-4 hidden w-24 shrink-0 sm:block">
                    <ProgressBar value={c.mensal} max={r.estrutura.custoFixoTotal} height={6} tone={c.essencial ? "muted" : 4} label={`${reais(c.mensal)} de ${reais(r.estrutura.custoFixoTotal)} de estrutura por mês`} />
                  </span>
                )}
                <span className={juntar("shrink-0 text-[13px] font-semibold tabular-nums", c.essencial ? "text-muted-foreground" : "text-foreground")}>{reais(c.mensal)}/mês</span>
              </li>
            ))}
          </ul>
        </Secao>

        <Secao
          titulo="Plano de crescimento"
          descricao={`${r.plano.filter((m) => m.falta > 0).length} meta(s) em aberto`}
          recolher="financeiro:cfo:plano"
          ajuda="Metas na ordem certa: a carteira pagar a estrutura, a reserva de segurança, a meta mensal e o próximo degrau do pró-labore. Prazos com 2 contratos novos por mês no plano de entrada da tabela. Peça ao CFO 'monte meu plano' para guardar as metas e acompanhar aqui."
        >
          <Plano retrato={r} />
        </Secao>

        <Secao
          titulo={`Entradas e saídas de ${r.rotuloDoMes.split(" ")[0]}`}
          descricao={`entrou ${reais(r.mes.recebido)} · saiu ${reais(r.mes.pago)}`}
          recolher="financeiro:cfo:movimento"
          recolhidaDeInicio
        >
          <Movimento retrato={r} />
        </Secao>
      </div>

      <div className="min-w-0 xl:sticky xl:top-4">
        <div className="mb-3 flex min-w-0 items-center justify-end">
          <button type="button" onClick={abrirNoAssist} className={botao.discreto} data-abrir-cfo-no-assist="">
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> Abrir no Assist
          </button>
        </div>
        <ConversaDoCFO className="xl:h-[720px]" />
      </div>
    </div>
  );
}

function LimiteDoMes({ retrato: r }: { retrato: Retrato }) {
  const l = r.limiteQueVale;
  const [valor, setValor] = useState("");
  const [todoMes, setTodoMes] = useState(false);
  // "1500.50" virava 150050 (todo ponto era tratado como milhar); a regra está em valorDigitado.ts.
  const numeroDigitado = valorDigitadoEmReais(valor) ?? 0;
  const avaliacao = numeroDigitado > 0 ? avaliarGasto(r, { valor: numeroDigitado, recorrente: todoMes }) : null;
  const tom: Tom = avaliacao ? (avaliacao.nivel === "bloqueado" ? "perigo" : avaliacao.nivel === "atencao" ? "aviso" : "sucesso") : "apagado";
  return (
    <Secao
      titulo={`Limite de ${l.rotulo}`}
      descricao={`${reais(l.valor)} de gasto novo · fixo novo até ${reais(l.recorrente)}/mês`}
      recolher="financeiro:cfo:limite"
      ajuda={`O quanto dá para gastar a mais sem o caixa livre ficar abaixo de ${reais(l.piso)} (meio mês de estrutura) nos próximos 3 meses, mesmo entrando 15% a menos. ${r.diasRestantes <= 3 ? `Faltam ${r.diasRestantes} dia(s) para virar o mês: vale o limite do mês que vem.` : ""} Despesa nova acima do limite pede a sua confirmação explícita no Fluxo de caixa e nos Custos fixos.`}
    >
      <div className={juntar("min-w-0 space-y-4 rounded-lg p-5 sm:p-6", l.valor > 0 ? "ds-ink" : "bg-danger-soft")}>
        <p className={texto.numeroGrande} data-limite-do-cfo="">{reais(l.valor)}</p>
        <p className={texto.corpo}>
          {l.valor > 0 ? "Pode gastar até " : "Limite zerado: "}
          <span className="font-semibold tabular-nums">{reais(l.valor)}</span>
          {l.valor > 0 ? ` em ${l.rotulo}, porque ${l.motivo}.` : ` ${l.motivo}.`}
          {l.valor <= 0 && l.comCortes > 0 ? ` Com os 3 maiores cortes (${reais(l.cortesConsiderados)}/mês), o limite sobe para ${reais(l.comCortes)}.` : ""}
        </p>
        <ul className="min-w-0 list-disc space-y-1.5 pl-5 marker:text-muted-foreground">
          {r.naoGastar.map((x) => <li key={x} className={juntar(texto.corpo, "text-muted-foreground")}>{x}</li>)}
        </ul>
        <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:max-w-[460px]">
          <CampoDeFormulario rotulo="Posso gastar? (R$)">
            <input type="text" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="1.500" className={campo} data-simulador-do-cfo="" />
          </CampoDeFormulario>
          <label className="mb-2 inline-flex cursor-pointer items-center text-[13px] text-foreground">
            <input type="checkbox" checked={todoMes} onChange={(e) => setTodoMes(e.target.checked)} className="mr-1.5 h-4 w-4" /> todo mês
          </label>
        </div>
        {avaliacao && (
          <p className={juntar(texto.corpo, "min-w-0")} data-resposta-do-simulador={avaliacao.nivel}>
            <Etiqueta tom={tom} className="mr-1.5">{avaliacao.nivel === "bloqueado" ? "Não" : avaliacao.nivel === "atencao" ? "Com cuidado" : "Pode"}</Etiqueta>
            {avaliacao.motivo}
          </p>
        )}
      </div>
    </Secao>
  );
}

function Projecao({ retrato: r, meses }: { retrato: Retrato; meses: number }) {
  const linhas = r.projecao.slice(0, meses);
  const negativo = linhas.filter((p) => p.saldoLivreConservador < 0)[0];
  return (
    <div className="min-w-0 space-y-3">
      <p className={texto.corpo}>
        {negativo ? `No conservador, o caixa livre fica negativo em ${negativo.rotulo}.` : "No conservador, o caixa livre não fica negativo no período."} Fim do período: {reais(linhas[linhas.length - 1].saldoLivre)} (conservador {reais(linhas[linhas.length - 1].saldoLivreConservador)}).
      </p>
      <ChartLegend
        className="flex flex-wrap divide-y-0 [&>li]:mr-5 [&>li]:py-1"
        items={[{ label: "Entra", tone: 1 }, { label: "Sai", tone: 4 }, { label: "Caixa livre", tone: 2 }, { label: "Conservador", tone: "muted" }]}
      />
      <div className="h-[280px] min-w-0" data-grafico-da-projecao="">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={linhas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={4} barCategoryGap="28%">
            <CartesianGrid {...grafico.grade} />
            <XAxis dataKey="rotulo" {...grafico.eixo} />
            <YAxis {...grafico.eixo} width={48} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => reais(v)} {...grafico.dica} />
            <Bar dataKey="entradas" name="Entra" fill={grafico.cor(1)} radius={grafico.raio} maxBarSize={22} />
            <Bar dataKey="saidas" name="Sai" fill={grafico.cor(4)} radius={grafico.raio} maxBarSize={22} />
            <Line type="monotone" dataKey="saldoLivre" name="Caixa livre" stroke={grafico.cor(2)} strokeWidth={3} dot={false} activeDot={{ r: 5, strokeWidth: 0 }} />
            <Line type="monotone" dataKey="saldoLivreConservador" name="Conservador" stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className={tabela.moldura}>
        <table className={juntar(tabela.tabela, "min-w-[720px] tabular-nums [&_td]:whitespace-nowrap")} data-tabela-da-projecao="">
          <thead className={tabela.cabeca}>
            <tr>
              <th>Mês</th>
              <th className="!text-right">Entra</th>
              <th className="!text-right">Sai</th>
              <th className="!text-right">Imposto</th>
              <th className="!text-right">Resultado</th>
              <th className="!text-right">Caixa livre</th>
              <th className="!text-right">Conservador</th>
            </tr>
          </thead>
          <tbody className={tabela.corpo}>
            {linhas.map((p) => (
              <tr key={p.mes}>
                <td className="font-medium text-foreground">{p.rotulo}</td>
                <td className="text-right text-foreground">{reais(p.entradas)}</td>
                <td className="text-right text-foreground">{reais(p.saidas)}</td>
                <td className="text-right text-muted-foreground">{reais(p.imposto)}</td>
                <td className={juntar("text-right", p.resultado < 0 ? "text-destructive" : "text-success")}>{reais(p.resultado)}</td>
                <td className={juntar("text-right font-semibold", p.saldoLivre < 0 ? "text-destructive" : "text-foreground")}>{reais(p.saldoLivre)}</td>
                <td className={juntar("text-right", p.saldoLivreConservador < 0 ? "text-destructive" : "text-muted-foreground")}>{reais(p.saldoLivreConservador)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Plano({ retrato: r }: { retrato: Retrato }) {
  return (
    <div className="min-w-0 space-y-4">
      <ol className="min-w-0 space-y-5">
        {r.plano.map((m, i) => {
          const progresso = m.alvo > 0 ? Math.max(0, Math.min(1, m.atual / m.alvo)) : 0;
          return (
            <li key={m.chave} className="min-w-0" data-meta-do-plano={m.chave}>
              <div className="flex min-w-0 items-center">
                <p className="mr-2 min-w-0 flex-1 truncate text-[13px] font-semibold leading-5 text-foreground">{i + 1}. {m.titulo}</p>
                <Etiqueta tom={m.falta > 0 ? "apagado" : "sucesso"} semPonto={m.falta > 0} className="max-w-[60%]">
                  <span className="truncate">{m.falta > 0 ? `faltam ${reais(m.falta)}${m.prazoMeses ? ` · ~${m.prazoMeses} ${m.prazoMeses === 1 ? "mês" : "meses"}` : ""}` : "cumprida"}</span>
                </Etiqueta>
              </div>
              <div className="mt-2.5 h-2 min-w-0 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={juntar("h-full rounded-full", m.falta > 0 ? "bg-primary" : "bg-success")} style={{ width: `${Math.round(progresso * 100)}%` }} />
              </div>
              <p className={juntar(texto.auxiliar, "mt-2 leading-5")}>{reais(m.atual)} de {reais(m.alvo)} · {m.como[0]}</p>
            </li>
          );
        })}
      </ol>
      {r.metas.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Metas guardadas</p>
          <ul className="mt-1 min-w-0">
            {r.metas.map((m) => (
              <li key={m.id} className="flex min-w-0 items-center py-3" data-meta-guardada="">
                <span className="mr-2 min-w-0 flex-1 truncate text-[13px] text-foreground">{m.titulo}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{Math.round(m.progresso * 100)}% · alvo {reais(m.alvo)}{m.prazo ? ` até ${m.prazo.slice(8, 10)}/${m.prazo.slice(5, 7)}/${m.prazo.slice(0, 4)}` : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Movimento({ retrato: r }: { retrato: Retrato }) {
  return (
    <div className="min-w-0 space-y-4">
      <Numeros
        rotulo="Movimento do mês"
        tamanho="md"
        destaques={false}
        colunas={4}
        itens={[
          { rotulo: "Recebido", valor: reais(r.mes.recebido), apoio: `${reais(r.mes.recebidoOperacional)} sem o imposto` },
          { rotulo: "Custo fixo pago", valor: reais(r.mes.pagoFixo) },
          { rotulo: "Pró-labore pago", valor: reais(r.mes.pagoProLabore) },
          { rotulo: "Variável pago", valor: reais(r.mes.pagoVariavel) },
        ]}
      />
      {r.mes.variaveis.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Maiores gastos variáveis</p>
          <ul className="mt-1 min-w-0">
            {r.mes.variaveis.slice(0, 8).map((v, i) => (
              <li key={`${v.descricao}-${i}`} className="flex min-w-0 items-center py-3">
                <span className="mr-2 min-w-0 flex-1 truncate text-[13px] text-foreground">{v.descricao}</span>
                <span className="shrink-0 text-[13px] tabular-nums text-foreground">{reais(v.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.atrasados.receber.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>A cobrar (atrasado) · {reais(r.atrasados.totalReceber)}</p>
          <ul className="mt-1 min-w-0">
            {r.atrasados.receber.map((x) => (
              <li key={x.id} className="flex min-w-0 items-center py-3">
                <span className="mr-2 min-w-0 flex-1 truncate text-[13px] text-foreground">{x.cliente}</span>
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{x.dias} dia(s) · {reais(x.valor)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
