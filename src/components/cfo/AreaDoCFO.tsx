import { useMemo, useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, CheckCircle2, Lightbulb, MessageSquare } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, FaixaDeNumeros, Secao, SeletorCompacto, botao, campo, juntar, superficie, texto, useEstadoDaTela,
} from "@/components/sistema";
import { Etiqueta, corDoTom, type Tom } from "@/components/finance/pecasDoFinanceiro";
import { EVENTO_ABRIR_AGENTE } from "@/lib/lancador";
import { useDadosDoCFO } from "@/lib/cfo/dadosDoCFO";
import ConversaDoCFO from "./ConversaDoCFO";
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
    <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] xl:items-start" data-area-do-cfo="">
      <div className="min-w-0 space-y-8">
        <FaixaDeNumeros
          rotulo="Saúde financeira"
          colunas={5}
          itens={[
            { rotulo: "Saúde", valor: `${r.saude.nota}/100`, apoio: r.saude.rotulo, ponto: tomDaSaude(r.saude.nota) },
            { rotulo: "Caixa livre", valor: reais(r.caixa.saldoLivre), apoio: `caixa ${reais(r.caixa.saldo)} menos caixinhas`, ponto: r.caixa.saldoLivre >= 0 ? "verde" : "perigo" },
            { rotulo: "Fôlego", valor: mesesEmTexto(r.folego.meses), apoio: "se a receita parar", ponto: r.folego.meses !== null && r.folego.meses >= 3 ? "verde" : r.folego.meses !== null && r.folego.meses >= 1 ? "alerta" : "perigo" },
            { rotulo: "Sobra da carteira", valor: reais(r.margem.mensal), apoio: "por mês, depois da estrutura", ponto: r.margem.mensal >= 0 ? "verde" : "perigo" },
            { rotulo: `Limite de ${l.rotulo.split(" ")[0]}`, valor: reais(l.valor), apoio: l.recorrente > 0 ? `fixo novo até ${reais(l.recorrente)}/mês` : "nenhum custo fixo novo", ponto: l.valor > 0 ? "verde" : "perigo" },
          ]}
        />

        <LimiteDoMes retrato={r} />

        <Secao
          titulo="Onde você está errando"
          descricao={`${r.alertas.filter((a) => a.nivel !== "bom").length} ponto(s)`}
          recolher="financeiro:cfo:erros"
          ajuda="Cada ponto é uma regra em código sobre os lançamentos reais: estrutura maior que a carteira, assinaturas de IA sobrepostas, pró-labore acima da escada do Plano Diretor, gasto pessoal no caixa, atrasados, contas paradas, preço abaixo da tabela, sem reserva."
        >
          <ul className="min-w-0 space-y-2">
            {r.alertas.map((a) => {
              const Icone = ICONE_DO_NIVEL[a.nivel];
              return (
                <li key={a.chave} className={juntar(superficie.poco, "flex min-w-0 px-3 py-2.5")} data-alerta-do-cfo={a.chave}>
                  <Icone className={juntar("mr-2.5 mt-0.5 h-4 w-4 shrink-0", corDoTom[TOM_DO_NIVEL[a.nivel]])} aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <Etiqueta tom={TOM_DO_NIVEL[a.nivel]}>{ROTULO_DO_NIVEL[a.nivel]}</Etiqueta>
                    <p className="mt-1 text-[13px] font-medium leading-5 text-foreground">{a.titulo}</p>
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
          <ol className="min-w-0 list-decimal space-y-2 pl-5">
            {r.acoesDoMes.map((a) => (
              <li key={a.chave} className={texto.corpo}>
                <span className="font-medium">{a.titulo}.</span> <span className="text-muted-foreground">{a.detalhe}</span>
              </li>
            ))}
            {!r.acoesDoMes.length && <li className={texto.corpo}>Nada urgente: mantenha a rotina e guarde a sobra na reserva.</li>}
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
          <ul className="min-w-0 divide-y divide-border">
            {r.cortes.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center py-2" data-corte-do-cfo={c.essencial ? "essencial" : "cortavel"}>
                <div className="mr-3 min-w-0 flex-1">
                  <p className={juntar("truncate text-[13px] font-medium leading-5", c.essencial ? "text-muted-foreground" : "text-foreground")}>{c.descricao}</p>
                  <p className={juntar(texto.auxiliar, "truncate")}>{c.essencial ? "essencial" : c.motivo}</p>
                </div>
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
        <div className="mb-2 flex min-w-0 items-center justify-end">
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
  const numeroDigitado = Number(String(valor).replace(/\./g, "").replace(",", "."));
  const avaliacao = numeroDigitado > 0 ? avaliarGasto(r, { valor: numeroDigitado, recorrente: todoMes }) : null;
  const tom: Tom = avaliacao ? (avaliacao.nivel === "bloqueado" ? "perigo" : avaliacao.nivel === "atencao" ? "aviso" : "sucesso") : "apagado";
  return (
    <Secao
      titulo={`Limite de ${l.rotulo}`}
      descricao={`${reais(l.valor)} de gasto novo · fixo novo até ${reais(l.recorrente)}/mês`}
      recolher="financeiro:cfo:limite"
      ajuda={`O quanto dá para gastar a mais sem o caixa livre ficar abaixo de ${reais(l.piso)} (meio mês de estrutura) nos próximos 3 meses, mesmo entrando 15% a menos. ${r.diasRestantes <= 3 ? `Faltam ${r.diasRestantes} dia(s) para virar o mês: vale o limite do mês que vem.` : ""} Despesa nova acima do limite pede a sua confirmação explícita no Fluxo de caixa e nos Custos fixos.`}
    >
      <div className="min-w-0 space-y-3">
        <p className={texto.corpo}>
          {l.valor > 0 ? "Pode gastar até " : "Limite zerado: "}
          <span className="font-semibold tabular-nums">{reais(l.valor)}</span>
          {l.valor > 0 ? ` em ${l.rotulo}, porque ${l.motivo}.` : ` ${l.motivo}.`}
          {l.valor <= 0 && l.comCortes > 0 ? ` Com os 3 maiores cortes (${reais(l.cortesConsiderados)}/mês), o limite sobe para ${reais(l.comCortes)}.` : ""}
        </p>
        <ul className="min-w-0 list-disc space-y-1 pl-5">
          {r.naoGastar.map((x) => <li key={x} className={texto.corpo}>{x}</li>)}
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
      <div className="h-[260px] min-w-0" data-grafico-da-projecao="">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={linhas} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="rotulo" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
            <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" width={56} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
            <Tooltip formatter={(v: number) => reais(v)} contentStyle={{ fontSize: 12 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="entradas" name="Entra" fill="hsl(var(--success))" radius={[3, 3, 0, 0]} />
            <Bar dataKey="saidas" name="Sai" fill="hsl(var(--destructive))" radius={[3, 3, 0, 0]} />
            <Line type="monotone" dataKey="saldoLivre" name="Caixa livre" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="saldoLivreConservador" name="Conservador" stroke="hsl(var(--warning))" strokeDasharray="4 3" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="min-w-0 overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12px] tabular-nums" data-tabela-da-projecao="">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Mês</th>
              <th className="py-1.5 pr-2 text-right font-medium">Entra</th>
              <th className="py-1.5 pr-2 text-right font-medium">Sai</th>
              <th className="py-1.5 pr-2 text-right font-medium">Imposto</th>
              <th className="py-1.5 pr-2 text-right font-medium">Resultado</th>
              <th className="py-1.5 pr-2 text-right font-medium">Caixa livre</th>
              <th className="py-1.5 text-right font-medium">Conservador</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {linhas.map((p) => (
              <tr key={p.mes}>
                <td className="py-1.5 pr-2 text-foreground">{p.rotulo}</td>
                <td className="py-1.5 pr-2 text-right text-foreground">{reais(p.entradas)}</td>
                <td className="py-1.5 pr-2 text-right text-foreground">{reais(p.saidas)}</td>
                <td className="py-1.5 pr-2 text-right text-muted-foreground">{reais(p.imposto)}</td>
                <td className={juntar("py-1.5 pr-2 text-right", p.resultado < 0 ? "text-destructive" : "text-success")}>{reais(p.resultado)}</td>
                <td className={juntar("py-1.5 pr-2 text-right font-medium", p.saldoLivre < 0 ? "text-destructive" : "text-foreground")}>{reais(p.saldoLivre)}</td>
                <td className={juntar("py-1.5 text-right", p.saldoLivreConservador < 0 ? "text-destructive" : "text-muted-foreground")}>{reais(p.saldoLivreConservador)}</td>
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
      <ol className="min-w-0 space-y-3">
        {r.plano.map((m, i) => {
          const progresso = m.alvo > 0 ? Math.max(0, Math.min(1, m.atual / m.alvo)) : 0;
          return (
            <li key={m.chave} className="min-w-0" data-meta-do-plano={m.chave}>
              <div className="flex min-w-0 items-baseline">
                <p className="mr-2 min-w-0 flex-1 truncate text-[13px] font-medium leading-5 text-foreground">{i + 1}. {m.titulo}</p>
                <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                  {m.falta > 0 ? `faltam ${reais(m.falta)}${m.prazoMeses ? ` · ~${m.prazoMeses} ${m.prazoMeses === 1 ? "mês" : "meses"}` : ""}` : "cumprida"}
                </span>
              </div>
              <div className="mt-1 h-1.5 min-w-0 overflow-hidden rounded bg-muted" aria-hidden="true">
                <div className={juntar("h-full rounded", m.falta > 0 ? "bg-primary" : "bg-success")} style={{ width: `${Math.round(progresso * 100)}%` }} />
              </div>
              <p className={juntar(texto.auxiliar, "mt-1 leading-5")}>{reais(m.atual)} de {reais(m.alvo)} · {m.como[0]}</p>
            </li>
          );
        })}
      </ol>
      {r.metas.length > 0 && (
        <div className="min-w-0">
          <p className={texto.rotulo}>Metas guardadas</p>
          <ul className="mt-1 min-w-0 divide-y divide-border">
            {r.metas.map((m) => (
              <li key={m.id} className="flex min-w-0 items-center py-1.5" data-meta-guardada="">
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
      <FaixaDeNumeros
        rotulo="Movimento do mês"
        tamanho="compacto"
        semMoldura
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
          <ul className="mt-1 min-w-0 divide-y divide-border">
            {r.mes.variaveis.slice(0, 8).map((v, i) => (
              <li key={`${v.descricao}-${i}`} className="flex min-w-0 items-center py-1.5">
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
          <ul className="mt-1 min-w-0 divide-y divide-border">
            {r.atrasados.receber.map((x) => (
              <li key={x.id} className="flex min-w-0 items-center py-1.5">
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
