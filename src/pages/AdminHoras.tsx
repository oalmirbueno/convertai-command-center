import { useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Timer, TrendingDown, TrendingUp, Minus } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import CabecalhoDePagina from "@/components/sistema/CabecalhoDePagina";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import GradeDeSecoes from "@/components/sistema/GradeDeSecoes";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, espaco, juntar, lista } from "@/components/sistema/estilos";
import { BarraFina, BarrasPorMes, MapaDeHoras } from "@/components/horas/Graficos";
import {
  CARGA_PADRAO_HORAS,
  OCUPACAO_PARA_CONTRATAR,
  OCUPACAO_PARA_ESCALAR,
  PERIODOS,
  avanco,
  capacidade,
  comparar,
  direcao,
  eficiencia,
  hojeEmSaoPaulo,
  mapaDeCalor,
  mesDoDia,
  periodoQueRendeMais,
  projetar,
  segundosPorCliente,
  segundosPorPeriodo,
  semanasDoMes,
  somarMeses,
  totalizar,
  variacao,
  type Comparacao,
  type MesDoCliente,
  type Periodo,
  type Recorte,
  type TotaisDoMes,
} from "@/lib/horas/calculos";
import { TIPOS_DE_ENTREGA, juntarMeses, useCustosDoHistorico, useResumoDeHoras, MESES_DE_HISTORICO } from "@/lib/horas/dados";
import {
  formatarDuracao,
  formatarHoras,
  formatarNumero,
  formatarUsd,
  formatarVariacao,
  rotuloDoMes,
} from "@/lib/horas/formato";
import { cn } from "@/lib/utils";

/**
 * Horas e custos (frente CR, 28/09). Admin e gestor. Junta o tempo que o
 * cronômetro do topo mede por cliente, o custo de IA (mesma fonte dos Custos
 * da Mesa) e as entregas reais do painel, e responde: quanto cada cliente
 * consome, quanto custa, quanto entrega, e se é hora de escalar, segurar ou
 * contratar. Toda conta está em src/lib/horas/calculos.ts e explicada no "?".
 */

const MESES_VALIDOS = /^\d{4}-\d{2}-01$/;
const ehTexto = (v: unknown) => typeof v === "string";

type ChaveDoRecorte = "mes" | "semana" | "dia";

const NOMES_DA_DECISAO: Record<string, { titulo: string; ponto: "verde" | "alerta" | "perigo" | "neutro" }> = {
  escalar: { titulo: "Escalar", ponto: "verde" },
  segurar: { titulo: "Segurar e organizar", ponto: "alerta" },
  contratar: { titulo: "Contratar", ponto: "perigo" },
  "sem-base": { titulo: "Ainda sem base", ponto: "neutro" },
};

const ROTULO_DO_PERIODO: Record<Periodo, string> = { manha: "manhã", tarde: "tarde", noite: "noite" };

const maiuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

function Tendencia({ v, inverter = false }: { v: number | null; inverter?: boolean }) {
  const d = direcao(v);
  if (d === "sem-base") return <span className="text-muted-foreground">sem base</span>;
  const Icone = d === "sobe" ? TrendingUp : d === "desce" ? TrendingDown : Minus;
  // Para custo e horas por entrega, subir é pior: a cor segue o sentido do bom.
  const bom = d === "estavel" ? null : inverter ? d === "desce" : d === "sobe";
  return (
    <span className={cn("inline-flex items-center tabular-nums", bom === null ? "text-muted-foreground" : bom ? "text-success" : "text-warning")}>
      <Icone className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
      {formatarVariacao(v === null ? null : v * 100)}
    </span>
  );
}

const celula = "whitespace-nowrap px-3 py-2 text-right tabular-nums";
const celulaTitulo = "whitespace-nowrap px-3 py-2 text-right text-[12px] font-medium text-muted-foreground";

function TabelaDeComparacao({
  linhas,
  rotuloDoAtual,
}: {
  linhas: Array<{ rotulo: string; c: Comparacao; formatar: (v: number | null) => string; inverter?: boolean }>;
  rotuloDoAtual: string;
}) {
  return (
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full min-w-[560px] text-[13px]">
        <thead className="border-b border-border">
          <tr>
            <th className="px-3 py-2 text-left text-[12px] font-medium text-muted-foreground">Medida</th>
            <th className={celulaTitulo}>{rotuloDoAtual}</th>
            <th className={celulaTitulo}>Mês anterior</th>
            <th className={celulaTitulo}>Média de 3 meses</th>
            <th className={celulaTitulo}>Contra o anterior</th>
            <th className={celulaTitulo}>Contra a média</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.rotulo} className="border-b border-border last:border-b-0">
              <td className="whitespace-nowrap px-3 py-2 font-medium">{l.rotulo}</td>
              <td className={juntar(celula, "font-semibold")}>{l.formatar(l.c.atual)}</td>
              <td className={celula}>{l.formatar(l.c.anterior)}</td>
              <td className={celula}>{l.formatar(l.c.media3)}</td>
              <td className={celula}>
                <Tendencia v={l.c.vsAnterior} inverter={l.inverter} />
              </td>
              <td className={celula}>
                <Tendencia v={l.c.vsMedia3} inverter={l.inverter} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** As cinco medidas comparáveis de um mês (total ou de um cliente). */
function medidasDoMes(t: { segundos: number; custoUsd: number; entregas: number } | null, mes: string, agora: number, projetar_: boolean) {
  if (!t) return { horas: null, custo: null, entregas: null, hpe: null, cpe: null, eph: null };
  const ef = eficiencia(t.segundos, t.custoUsd, t.entregas);
  const p = (v: number) => (projetar_ ? projetar(v, mes, agora) : v);
  return {
    horas: p(t.segundos / 3600),
    custo: p(t.custoUsd),
    entregas: p(t.entregas),
    hpe: ef.horasPorEntrega,
    cpe: ef.custoPorEntrega,
    eph: ef.entregasPorHora,
  };
}

function linhasDeComparacao(
  porMes: (mes: string) => { segundos: number; custoUsd: number; entregas: number } | null,
  mes: string,
  agora: number,
) {
  const atual = medidasDoMes(porMes(mes), mes, agora, true);
  const anterior = medidasDoMes(porMes(somarMeses(mes, -1)), somarMeses(mes, -1), agora, false);
  const tres = [1, 2, 3].map((n) => medidasDoMes(porMes(somarMeses(mes, -n)), somarMeses(mes, -n), agora, false));
  const h = (v: number | null) => (v === null ? "sem base" : formatarHoras(v));
  const u = (v: number | null) => formatarUsd(v);
  const n = (v: number | null) => formatarNumero(v, 0);
  return [
    { rotulo: "Horas", c: comparar(atual.horas, anterior.horas, tres.map((x) => x.horas)), formatar: h },
    { rotulo: "Custo de IA", c: comparar(atual.custo, anterior.custo, tres.map((x) => x.custo)), formatar: u, inverter: true },
    { rotulo: "Entregas", c: comparar(atual.entregas, anterior.entregas, tres.map((x) => x.entregas)), formatar: n },
    { rotulo: "Horas por entrega", c: comparar(atual.hpe, anterior.hpe, tres.map((x) => x.hpe)), formatar: (v: number | null) => formatarHoras(v, 2), inverter: true },
    { rotulo: "IA por entrega", c: comparar(atual.cpe, anterior.cpe, tres.map((x) => x.cpe)), formatar: u, inverter: true },
    { rotulo: "Entregas por hora", c: comparar(atual.eph, anterior.eph, tres.map((x) => x.eph)), formatar: (v: number | null) => formatarNumero(v, 2) },
  ];
}

function AjudaDaPagina() {
  return (
    <>
      <span className="block">O tempo vem do cronômetro do topo: conta sozinho quando a pessoa trabalha num cliente (mesas, Central, Workspace, Arquivos, Agenda, ficha, Ciclo) e pausa com a aba escondida ou 5 minutos sem mexer.</span>
      <span className="mt-1.5 block">O custo é o gasto de IA da carteira (o mesmo dos Custos da Mesa), por cliente, em dólar. Ele é do cliente, não da pessoa: o filtro de pessoa muda só as horas.</span>
      <span className="mt-1.5 block">Entrega é peça aprovada pelo cliente, vídeo e roteiro aprovados, tarefa concluída que não é peça e marco cumprido. Post publicado aparece à parte, porque é a mesma peça num estágio seguinte.</span>
      <span className="mt-1.5 block">Mês em andamento: horas, custo e entregas são comparados pela projeção linear (o que já foi feito dividido pela parte do mês que passou).</span>
    </>
  );
}

function AjudaDaDecisao({ carga }: { carga: number }) {
  return (
    <>
      <span className="block">Ocupação = horas do mês (projetadas no mês em andamento) ÷ carga mensal ({formatarNumero(carga, 0)} h).</span>
      <span className="mt-1.5 block">Eficiência = horas por entrega. Piorando quando sobe mais de 10% sobre a média dos 3 meses anteriores.</span>
      <span className="mt-1.5 block">Escalar: ocupação abaixo de {Math.round(OCUPACAO_PARA_ESCALAR * 100)}% e eficiência estável ou melhorando.</span>
      <span className="mt-1.5 block">Segurar e organizar: ocupação entre {Math.round(OCUPACAO_PARA_ESCALAR * 100)}% e {Math.round(OCUPACAO_PARA_CONTRATAR * 100)}%, ou eficiência piorando.</span>
      <span className="mt-1.5 block">Contratar: ocupação acima de {Math.round(OCUPACAO_PARA_CONTRATAR * 100)}% neste mês e no anterior, ou atrasos subindo com ocupação a partir de {Math.round(OCUPACAO_PARA_ESCALAR * 100)}%.</span>
      <span className="mt-1.5 block">Clientes novos que cabem = folga (carga menos horas do mês) ÷ horas médias por cliente. A média usa até 3 meses fechados; sem eles, o mês em andamento projetado.</span>
      <span className="mt-1.5 block">Para contratar = horas acima de {Math.round(OCUPACAO_PARA_ESCALAR * 100)}% da carga, que uma pessoa nova assumiria para você voltar à faixa de escalar.</span>
      <span className="mt-1.5 block">Dá para adiantar = folga ÷ horas por dia da carteira (horas do mês ÷ 30).</span>
      <span className="mt-1.5 block">Atrasadas = pautas do mês vencidas e ainda abertas mais marcos do mês vencidos.</span>
    </>
  );
}

function LinhaDoCliente({
  l,
  segundos,
  maiorTempo,
  maiorCusto,
  anterior,
  tres,
  rende,
  recorteNoMes,
  mes,
  agora,
}: {
  l: MesDoCliente;
  segundos: number;
  maiorTempo: number;
  maiorCusto: number;
  anterior: MesDoCliente | null;
  tres: Array<MesDoCliente | null>;
  rende: ReturnType<typeof periodoQueRendeMais>;
  recorteNoMes: boolean;
  mes: string;
  agora: number;
}) {
  const [aberta, setAberta] = useState(false);
  const ef = eficiencia(l.segundos, l.custoUsd, l.entregas);
  const avancoDoCliente = l.previstas ? Math.min(l.feitasDoPlano, l.previstas) / l.previstas : null;
  const vsAnterior = variacao(projetar(l.segundos, mes, agora) ?? l.segundos, anterior ? anterior.segundos : null);
  const detalhes: string[] = [];
  if (rende) detalhes.push(`rende mais à ${ROTULO_DO_PERIODO[rende.periodo]}`);
  if (l.atrasadas > 0) detalhes.push(`${l.atrasadas} atrasada${l.atrasadas > 1 ? "s" : ""}`);
  const porMes = (m: string) => {
    if (m === l.mes) return l;
    if (anterior && m === anterior.mes) return anterior;
    const t = tres.find((x) => x && x.mes === m);
    return t || null;
  };
  return (
    <li className={juntar(lista.linha, "block")} data-cliente-das-horas={l.client_id}>
      <button
        type="button"
        onClick={() => setAberta(!aberta)}
        aria-expanded={aberta}
        className="grid w-full min-w-0 grid-cols-1 items-center gap-y-2 text-left lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-x-6"
      >
        <span className="flex min-w-0 items-center">
          {aberta ? <ChevronDown className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-medium text-foreground">{l.nome}</span>
            <span className="block truncate text-[12px] text-muted-foreground">{detalhes.length ? detalhes.join(" · ") : `${l.dias} dia${l.dias === 1 ? "" : "s"} no mês`}</span>
          </span>
        </span>
        <span className="block min-w-0">
          <span className="mb-1 flex items-baseline justify-between text-[12px]">
            <span className="text-muted-foreground">{recorteNoMes ? "Tempo" : "Tempo no recorte"}</span>
            <span className="tabular-nums text-foreground">{formatarDuracao(segundos)}</span>
          </span>
          <BarraFina fracao={maiorTempo > 0 ? segundos / maiorTempo : 0} rotulo={`Tempo: ${formatarDuracao(segundos)}`} />
        </span>
        <span className="block min-w-0">
          <span className="mb-1 flex items-baseline justify-between text-[12px]">
            <span className="text-muted-foreground">IA no mês</span>
            <span className="tabular-nums text-foreground">{formatarUsd(l.custoUsd)}</span>
          </span>
          <BarraFina fracao={maiorCusto > 0 ? l.custoUsd / maiorCusto : 0} cor="bg-info" rotulo={`Custo de IA: ${formatarUsd(l.custoUsd)}`} />
        </span>
        <span className="block min-w-0 text-[12px]">
          <span className="block truncate text-foreground">
            <span className="tabular-nums">{l.entregas}</span> entrega{l.entregas === 1 ? "" : "s"}
            {l.previstas ? (
              <span className="text-muted-foreground">
                {" "}
                · {Math.min(l.feitasDoPlano, l.previstas)} de {l.previstas} do plano ({Math.round((avancoDoCliente || 0) * 100)}%)
              </span>
            ) : null}
          </span>
          <span className="block truncate text-muted-foreground">
            {ef.horasPorEntrega === null ? "sem horas por entrega" : `${formatarHoras(ef.horasPorEntrega, 2)} por entrega`} · horas <Tendencia v={vsAnterior} />
          </span>
        </span>
      </button>
      {aberta && (
        <div className="mt-3 min-w-0 space-y-3 pl-5" data-detalhe-do-cliente="">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-3 lg:grid-cols-6">
            {TIPOS_DE_ENTREGA.map((t) => (
              <li key={t.chave} className="flex min-w-0 items-baseline justify-between">
                <span className="mr-2 truncate text-muted-foreground">{t.rotulo}</span>
                <span className="tabular-nums text-foreground">{l.porTipo[t.chave] || 0}</span>
              </li>
            ))}
            <li className="flex min-w-0 items-baseline justify-between">
              <span className="mr-2 truncate text-muted-foreground">Posts publicados</span>
              <span className="tabular-nums text-foreground">{l.porTipo.publicados || 0}</span>
            </li>
          </ul>
          <TabelaDeComparacao linhas={linhasDeComparacao(porMes, l.mes, agora)} rotuloDoAtual={fracaoRotulo(l.mes, agora)} />
        </div>
      )}
    </li>
  );
}

function fracaoRotulo(mes: string, agora: number) {
  return mesDoDia(hojeEmSaoPaulo(agora)) === mes ? "Este mês (projetado)" : "Mês escolhido";
}

export default function AdminHoras() {
  const { user, profile } = useAuth();
  const ehAdmin = profile?.role === "admin";
  const agora = Date.now();
  const mesAtual = mesDoDia(hojeEmSaoPaulo(agora));
  const opcoesDeMes = useMemo(() => Array.from({ length: MESES_DE_HISTORICO }).map((_, i) => somarMeses(mesAtual, -i)), [mesAtual]);

  const [mesGuardado, setMes] = useEstadoDaTela<string>("horas:mes", mesAtual, { validar: (v) => typeof v === "string" && MESES_VALIDOS.test(v) });
  const mes = opcoesDeMes.indexOf(mesGuardado) >= 0 ? mesGuardado : mesAtual;
  const [pessoaGuardada, setPessoa] = useEstadoDaTela<string>("horas:pessoa", "eu", { validar: ehTexto });
  const [recorteGuardado, setRecorte] = useEstadoDaTela<string>("horas:recorte", "mes", { validar: ehTexto });
  const [periodoGuardado, setPeriodo] = useEstadoDaTela<string>("horas:periodo", "todos", { validar: ehTexto });
  const [cargaGuardada, setCarga] = useEstadoDaTela<number>("horas:carga", CARGA_PADRAO_HORAS, {
    validar: (v) => typeof v === "number" && v >= 1 && v <= 744,
  });
  const [semanaEscolhida, setSemana] = useState<string>("");
  const [diaEscolhido, setDia] = useState<string>("");

  // Quem: o gestor vê sempre o próprio tempo (o banco garante); o admin escolhe.
  const pessoa = !ehAdmin ? null : pessoaGuardada === "eu" ? (user && user.id) || null : pessoaGuardada === "todos" ? null : pessoaGuardada;
  const resumo = useResumoDeHoras(mes, pessoa);
  const custos = useCustosDoHistorico(mes, {});

  const dados = resumo.data;
  const linhas = useMemo(() => (dados ? juntarMeses(dados, (custos.data && custos.data.linhas) || []) : []), [dados, custos.data]);
  const mesesDoHistorico = useMemo(() => {
    const saida: string[] = [];
    for (let i = MESES_DE_HISTORICO - 1; i >= 0; i--) saida.push(somarMeses(mes, -i));
    return saida;
  }, [mes]);
  const totais = useMemo(() => {
    const t: Record<string, TotaisDoMes> = {};
    for (const m of mesesDoHistorico) t[m] = totalizar(m, linhas);
    return t;
  }, [mesesDoHistorico, linhas]);

  const pessoasNoFiltro = pessoa ? 1 : Math.max(1, dados ? dados.pessoas.filter((p) => p.segundos > 0).length : 1);
  const carga = cargaGuardada * pessoasNoFiltro;
  const cap = capacidade({ mes, agora, cargaHoras: carga, meses: mesesDoHistorico.map((m) => totais[m]) });

  const periodo: Periodo | "todos" = periodoGuardado === "manha" || periodoGuardado === "tarde" || periodoGuardado === "noite" ? periodoGuardado : "todos";
  const chaveDoRecorte: ChaveDoRecorte = recorteGuardado === "semana" || recorteGuardado === "dia" ? recorteGuardado : "mes";
  const semanas = semanasDoMes(mes);
  const hoje = hojeEmSaoPaulo(agora);
  const diasComTempo = useMemo(() => {
    const d: string[] = [];
    for (const x of (dados && dados.detalhe) || []) if (d.indexOf(x.dia) < 0) d.push(x.dia);
    return d.sort().reverse();
  }, [dados]);
  const semanaDeHoje = semanas.filter((s) => s <= hoje).pop() || semanas[0];
  const semanaUsada = semanas.indexOf(semanaEscolhida) >= 0 ? semanaEscolhida : mesDoDia(hoje) === mes ? semanaDeHoje : semanas[0];
  const dia = diasComTempo.indexOf(diaEscolhido) >= 0 ? diaEscolhido : diasComTempo[0] || "";
  const recorte: Recorte = chaveDoRecorte === "semana" ? { tipo: "semana", inicio: semanaUsada } : chaveDoRecorte === "dia" && dia ? { tipo: "dia", dia } : { tipo: "mes" };

  const detalhe = (dados && dados.detalhe) || [];
  const tempoNoRecorte = segundosPorCliente(detalhe, recorte, periodo);
  const doMes = linhas.filter((l) => l.mes === mes);
  const anteriorPorCliente: Record<string, MesDoCliente> = {};
  const tresPorCliente: Record<string, Array<MesDoCliente | null>> = {};
  for (const l of linhas) {
    if (l.mes === somarMeses(mes, -1)) anteriorPorCliente[l.client_id] = l;
  }
  for (const l of doMes) {
    tresPorCliente[l.client_id] = [1, 2, 3].map((n) => linhas.find((x) => x.client_id === l.client_id && x.mes === somarMeses(mes, -n)) || null);
  }
  const recorteNoMes = recorte.tipo === "mes" && periodo === "todos";
  const tempoDaLinha = (l: MesDoCliente) => (recorteNoMes ? l.segundos : tempoNoRecorte[l.client_id] || 0);
  const ordenadas = doMes
    .filter((l) => l.segundos > 0 || l.custoUsd > 0 || l.entregas > 0)
    .sort((a, b) => tempoDaLinha(b) - tempoDaLinha(a) || b.custoUsd - a.custoUsd || b.entregas - a.entregas || a.nome.localeCompare(b.nome, "pt-BR"));
  const maiorTempo = ordenadas.reduce((m, l) => Math.max(m, tempoDaLinha(l)), 0);
  const maiorCusto = ordenadas.reduce((m, l) => Math.max(m, l.custoUsd), 0);

  const tMes = totais[mes];
  const tAnterior = totais[somarMeses(mes, -1)];
  const efMes = tMes ? eficiencia(tMes.segundos, tMes.custoUsd, tMes.entregas) : eficiencia(0, 0, 0);
  const avancoDoMes = tMes ? avanco(tMes) : null;
  const horasProj = tMes ? projetar(tMes.segundos / 3600, mes, agora) : null;
  const semHoras = linhas.every((l) => l.segundos === 0);
  const decisao = NOMES_DA_DECISAO[cap.decisao];
  const porPeriodo = segundosPorPeriodo(detalhe);
  const totalPeriodos = porPeriodo.manha + porPeriodo.tarde + porPeriodo.noite;

  const rotuloDoRecorte = (() => {
    const partes: string[] = [];
    if (recorte.tipo === "semana") partes.push(`semana de ${recorte.inicio.slice(8, 10)}/${recorte.inicio.slice(5, 7)}`);
    if (recorte.tipo === "dia") partes.push(`dia ${recorte.dia.slice(8, 10)}/${recorte.dia.slice(5, 7)}`);
    if (periodo !== "todos") partes.push(ROTULO_DO_PERIODO[periodo]);
    return partes.join(", ");
  })();

  const seletorDoMes = (
    <select aria-label="Mês" value={mes} onChange={(e) => setMes(e.target.value)} className={juntar(campo, "mb-1 mr-2 h-8 w-auto max-w-[200px] px-2")}>
      {opcoesDeMes.map((m) => (
        <option key={m} value={m}>
          {maiuscula(rotuloDoMes(m))}
        </option>
      ))}
    </select>
  );
  const seletorDePessoa = ehAdmin ? (
    <select aria-label="Pessoa" value={pessoaGuardada} onChange={(e) => setPessoa(e.target.value)} className={juntar(campo, "mb-1 h-8 w-auto max-w-[200px] px-2")}>
      <option value="eu">Você</option>
      <option value="todos">Equipe toda</option>
      {((dados && dados.pessoas) || [])
        .filter((p) => !user || p.id !== user.id)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
    </select>
  ) : null;

  let corpo: ReactNode;
  if (resumo.isLoading) {
    corpo = <Carregando forma="aba" rotulo="Carregando horas e custos" />;
  } else if (resumo.isError) {
    corpo = (
      <EstadoDeErro
        titulo="Não consegui ler as horas."
        descricao="A função do banco pode ainda não estar aplicada."
        acao={
          <button type="button" className={botao.secundario} onClick={() => void resumo.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  } else {
    corpo = (
      <>
        <Secao
          titulo="Escalar, segurar ou contratar"
          descricao={decisao.titulo}
          ajuda={<AjudaDaDecisao carga={carga} />}
          acao={
            <label className="inline-flex items-center text-[12px] text-muted-foreground">
              <span className="mr-2">Carga mensal (h){pessoasNoFiltro > 1 ? ` × ${pessoasNoFiltro}` : ""}</span>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={744}
                value={cargaGuardada}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (n >= 1 && n <= 744) setCarga(n);
                }}
                aria-label="Carga mensal em horas"
                className={juntar(campo, "h-8 w-20 px-2 text-right tabular-nums")}
              />
            </label>
          }
          data-decisao={cap.decisao}
        >
          <ul className="mb-4 space-y-1 text-[13px]" data-motivos-da-decisao="">
            {cap.motivos.map((m) => (
              <li key={m} className="text-foreground">
                {m}
              </li>
            ))}
          </ul>
          <FaixaDeNumeros
            rotulo="Capacidade"
            colunas={5}
            itens={[
              {
                rotulo: "Ocupação",
                valor: cap.ocupacao === null ? "sem base" : `${Math.round(cap.ocupacao * 100)}%`,
                apoio: `${formatarHoras(cap.horasDoMes)}${cap.horasProjetadas ? " projetadas" : ""} de ${formatarNumero(carga, 0)} h`,
                ponto: decisao.ponto,
              },
              {
                rotulo: "Clientes que cabem",
                valor: cap.clientesQueCabem === null ? "sem base" : String(cap.clientesQueCabem),
                apoio: cap.horasPorCliente === null ? "falta histórico de horas" : `${formatarHoras(cap.horasPorCliente)} por cliente ao mês`,
              },
              {
                rotulo: "Clientes novos hoje",
                valor: cap.clientesNovosCabem === null ? "sem base" : String(cap.clientesNovosCabem),
                apoio: `folga de ${formatarHoras(cap.folgaHoras)}`,
              },
              {
                rotulo: "Dá para adiantar",
                valor: cap.diasAdiantaveis === null ? "sem base" : `${formatarNumero(cap.diasAdiantaveis, 0)} dias`,
                apoio: "da carteira do mês que vem",
              },
              {
                rotulo: "Uma contratação",
                valor: cap.horasParaContratacao > 0 ? `${formatarHoras(cap.horasParaContratacao, 0)}/mês` : "não precisa",
                apoio: cap.clientesPorContratacao === null ? "atende sem base" : `atende ${cap.clientesPorContratacao} clientes com a mesma carga`,
              },
            ]}
          />
        </Secao>

        <Secao titulo="O mês em números" descricao={rotuloDoMes(mes)} ajuda={<AjudaDaPagina />}>
          <FaixaDeNumeros
            rotulo="Números do mês"
            colunas={6}
            itens={[
              {
                rotulo: "Horas",
                valor: tMes ? formatarDuracao(tMes.segundos) : "0m",
                apoio: horasProj !== null && mesDoDia(hoje) === mes ? `projeção ${formatarHoras(horasProj)}` : `anterior ${tAnterior ? formatarDuracao(tAnterior.segundos) : "0m"}`,
              },
              { rotulo: "Custo de IA", valor: formatarUsd(tMes ? tMes.custoUsd : 0), apoio: `anterior ${formatarUsd(tAnterior ? tAnterior.custoUsd : 0)}` },
              {
                rotulo: "Entregas",
                valor: String(tMes ? tMes.entregas : 0),
                apoio: avancoDoMes === null ? `${tMes ? tMes.porTipo.publicados || 0 : 0} posts publicados` : `${Math.round(avancoDoMes * 100)}% do plano`,
              },
              { rotulo: "Horas por entrega", valor: formatarHoras(efMes.horasPorEntrega, 2), apoio: "tempo ÷ entregas" },
              { rotulo: "IA por entrega", valor: formatarUsd(efMes.custoPorEntrega), apoio: "custo ÷ entregas" },
              { rotulo: "Entregas por hora", valor: formatarNumero(efMes.entregasPorHora, 2), apoio: `${tMes ? tMes.atrasadas : 0} atrasadas` },
            ]}
          />
        </Secao>

        <Secao
          titulo="Por cliente"
          descricao={`${ordenadas.length} cliente${ordenadas.length === 1 ? "" : "s"}${rotuloDoRecorte ? ` · ${rotuloDoRecorte}` : ""}`}
          ajuda="Toque num cliente para ver as entregas por tipo e a comparação com o mês anterior e a média de 3 meses. Custo e entregas são do mês inteiro; o recorte muda só o tempo."
          acao={
            <div className="flex min-w-0 flex-wrap items-center justify-end">
              <SeletorCompacto
                rotulo="Recorte"
                valor={chaveDoRecorte}
                onEscolher={(v) => setRecorte(v)}
                opcoes={[
                  { valor: "mes", rotulo: "Mês" },
                  { valor: "semana", rotulo: "Semana" },
                  { valor: "dia", rotulo: "Dia" },
                ]}
                className="mb-1 mr-2"
              />
              {chaveDoRecorte === "semana" && (
                <select aria-label="Semana" value={semanaUsada} onChange={(e) => setSemana(e.target.value)} className={juntar(campo, "mb-1 mr-2 h-8 w-auto px-2")}>
                  {semanas.map((s) => (
                    <option key={s} value={s}>
                      Semana de {s.slice(8, 10)}/{s.slice(5, 7)}
                    </option>
                  ))}
                </select>
              )}
              {chaveDoRecorte === "dia" && diasComTempo.length > 0 && (
                <select aria-label="Dia" value={dia} onChange={(e) => setDia(e.target.value)} className={juntar(campo, "mb-1 mr-2 h-8 w-auto px-2")}>
                  {diasComTempo.map((d) => (
                    <option key={d} value={d}>
                      {d.slice(8, 10)}/{d.slice(5, 7)}
                    </option>
                  ))}
                </select>
              )}
              <SeletorCompacto
                rotulo="Período do dia"
                valor={periodo}
                onEscolher={(v) => setPeriodo(v)}
                opcoes={[{ valor: "todos", rotulo: "Dia todo" }].concat(PERIODOS.map((p) => ({ valor: p.chave, rotulo: p.rotulo })))}
                className="mb-1"
              />
            </div>
          }
        >
          {ordenadas.length === 0 ? (
            <EstadoVazio
              compacto
              icone={<Timer className="h-5 w-5" />}
              titulo={semHoras ? "O cronômetro começou agora." : "Nada neste mês."}
              descricao={semHoras ? "As horas aparecem aqui conforme o trabalho nos clientes." : "Escolha outro mês."}
            />
          ) : (
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Clientes do mês">
              {ordenadas.map((l) => (
                <LinhaDoCliente
                  key={l.client_id}
                  l={l}
                  segundos={tempoDaLinha(l)}
                  maiorTempo={maiorTempo}
                  maiorCusto={maiorCusto}
                  anterior={anteriorPorCliente[l.client_id] || null}
                  tres={tresPorCliente[l.client_id] || []}
                  rende={periodoQueRendeMais(detalhe, (dados && dados.pecasPorHora) || [], l.client_id)}
                  recorteNoMes={recorteNoMes}
                  mes={mes}
                  agora={agora}
                />
              ))}
            </ul>
          )}
        </Secao>

        <Secao titulo="Comparação" descricao="mês, anterior e média de 3 meses" ajuda="Total de todos os clientes. No mês em andamento, horas, custo e entregas vão pela projeção linear; as razões (por entrega, por hora) usam o que já aconteceu.">
          <TabelaDeComparacao linhas={linhasDeComparacao((m) => totais[m] || null, mes, agora)} rotuloDoAtual={fracaoRotulo(mes, agora)} />
        </Secao>

        <GradeDeSecoes colunas={2}>
          <Secao titulo="Mês a mês" descricao={`${MESES_DE_HISTORICO} meses`} ajuda="Uma medida por gráfico. A barra tracejada é a projeção do mês em andamento. Os números exatos estão no Histórico.">
            <div className="grid min-w-0 grid-cols-1 gap-y-6">
              <BarrasPorMes
                rotulo="Horas"
                mesEscolhido={mes}
                formatar={(v) => formatarHoras(v)}
                serie={mesesDoHistorico.map((m) => ({
                  mes: m,
                  valor: totais[m].segundos / 3600,
                  projetado: m === mesAtual ? projetar(totais[m].segundos / 3600, m, agora) : null,
                }))}
              />
              <BarrasPorMes
                rotulo="Entregas"
                mesEscolhido={mes}
                formatar={(v) => formatarNumero(v, 0)}
                serie={mesesDoHistorico.map((m) => ({ mes: m, valor: totais[m].entregas, projetado: m === mesAtual ? projetar(totais[m].entregas, m, agora) : null }))}
              />
              <BarrasPorMes
                rotulo="Custo de IA"
                mesEscolhido={mes}
                cor="bg-info"
                formatar={(v) => formatarUsd(v)}
                serie={mesesDoHistorico.map((m) => ({ mes: m, valor: totais[m].custoUsd, projetado: m === mesAtual ? projetar(totais[m].custoUsd, m, agora) : null }))}
              />
            </div>
          </Secao>
          <Secao
            titulo="Quando rende mais"
            descricao={
              totalPeriodos > 0
                ? PERIODOS.map((p) => `${p.rotulo} ${Math.round((porPeriodo[p.chave] / totalPeriodos) * 100)}%`).join(" · ")
                : "sem horas no mês"
            }
            ajuda="Mais escuro, mais tempo trabalhado naquele dia da semana e hora. Na lista de clientes, rende mais é o período com mais peças do Estúdio por hora trabalhada (sem peças, o período com mais horas). Manhã 6h às 12h, tarde 12h às 18h, noite 18h às 6h."
          >
            <MapaDeHoras mapa={mapaDeCalor(detalhe, periodo)} formatar={formatarDuracao} />
          </Secao>
        </GradeDeSecoes>

        <Secao titulo="Histórico" descricao="o mês fecha sozinho na virada" ajuda="Cada linha é um mês de São Paulo. O tempo zera no começo do mês e o mês anterior fica guardado aqui.">
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead className="border-b border-border">
                <tr>
                  <th className="px-3 py-2 text-left text-[12px] font-medium text-muted-foreground">Mês</th>
                  <th className={celulaTitulo}>Horas</th>
                  <th className={celulaTitulo}>Clientes</th>
                  <th className={celulaTitulo}>Custo de IA</th>
                  <th className={celulaTitulo}>Entregas</th>
                  <th className={celulaTitulo}>Publicados</th>
                  <th className={celulaTitulo}>Plano</th>
                  <th className={celulaTitulo}>Horas por entrega</th>
                  <th className={celulaTitulo}>IA por entrega</th>
                </tr>
              </thead>
              <tbody>
                {mesesDoHistorico
                  .slice()
                  .reverse()
                  .map((m) => {
                    const t = totais[m];
                    const ef = eficiencia(t.segundos, t.custoUsd, t.entregas);
                    const av = avanco(t);
                    return (
                      <tr key={m} className={cn("border-b border-border last:border-b-0", m === mes && "bg-primary/[0.07]")}>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">{maiuscula(rotuloDoMes(m))}</td>
                        <td className={celula}>{formatarDuracao(t.segundos)}</td>
                        <td className={celula}>{t.clientesAtivos}</td>
                        <td className={celula}>{formatarUsd(t.custoUsd)}</td>
                        <td className={celula}>{t.entregas}</td>
                        <td className={celula}>{t.porTipo.publicados || 0}</td>
                        <td className={celula}>{av === null ? "·" : `${Math.round(av * 100)}%`}</td>
                        <td className={celula}>{ef.horasPorEntrega === null ? "·" : formatarHoras(ef.horasPorEntrega, 2)}</td>
                        <td className={celula}>{ef.custoPorEntrega === null ? "·" : formatarUsd(ef.custoPorEntrega)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </Secao>
      </>
    );
  }

  return (
    <div className={juntar(espaco.pagina, "pb-10")} data-horas-e-custos="">
      <CabecalhoDePagina
        titulo="Horas e custos"
        descricao={dados && dados.escopo === "todos" ? "Equipe toda" : ehAdmin && pessoa && user && pessoa !== user.id ? "Uma pessoa" : "Seu tempo"}
        ajuda={<AjudaDaPagina />}
        acoes={
          <div className="flex min-w-0 flex-wrap items-center justify-end">
            {seletorDoMes}
            {seletorDePessoa}
          </div>
        }
      />
      {corpo}
    </div>
  );
}
