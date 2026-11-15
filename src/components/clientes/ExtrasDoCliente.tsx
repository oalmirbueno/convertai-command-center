import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, MenuMais, Secao, SeletorCompacto, botao, campo, etiqueta, juntar, texto } from "@/components/sistema";
import {
  ATALHOS,
  CATEGORIAS,
  andamentoDoUnico,
  conferirExtra,
  montarParcelas,
  nomeDaCategoria,
  resumoDosExtras,
  somarMeses,
  type CobrancaDeExtra,
  type CobrancaDoExtra,
  type Extra,
} from "@/lib/extrasDoCliente";

/**
 * Extras do cliente (14/11/2026, pedido do dono): "qualquer cliente que entra, eu consigo colocar order
 * bumps: marco, coloco a data e o valor, digo se já pagou ou quando vai pagar, e já atualiza o
 * financeiro. Tudo especificado, sem duplicar."
 *
 * Fica na ficha do cliente, embaixo do plano. Três jeitos de cobrar:
 * - todo mês (suporte, CRM, e-mail, automação): começa numa data ou fica "aguardando a entrega";
 * - uma vez (sistema, implementação): entrada livre e o restante em parcelas;
 * - comissão: um percentual, e a cada mês o dono lança o resultado e a cobrança sai calculada.
 *
 * Toda cobrança nasce pelo banco (RPCs extra_*), ligada ao extra: é isso que evita duplicar.
 */

const dinheiro = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const dataCurta = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "");
const numero = (t: string) => Number(String(t).replace(/\./g, "").replace(",", ".")) || 0;

function mensagemDoErro(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : "";
  if (m.includes("PARCELAS_PASSAM_DO_TOTAL")) return "As parcelas passam do valor total.";
  if (m.includes("COMISSAO_JA_LANCADA")) return "A comissão deste mês já foi lançada.";
  if (m.includes("EXTRA_JA_INICIADO")) return "Este extra já está sendo cobrado.";
  if (m.includes("SO_ADMIN")) return "Só o administrador mexe nos extras.";
  return m || "Não foi possível salvar.";
}

const COBRANCAS: { valor: CobrancaDoExtra; rotulo: string }[] = [
  { valor: "mensal", rotulo: "Todo mês" },
  { valor: "unico", rotulo: "Uma vez" },
  { valor: "comissao", rotulo: "Variável" },
];
const O_QUE_E: Record<CobrancaDoExtra, string> = {
  mensal: "Valor fixo por mês. A cobrança de cada mês nasce sozinha.",
  unico: "Valor fechado, com entrada e parcelas.",
  comissao: "Comissão ou valor que muda. Você lança quando receber.",
};

export default function ExtrasDoCliente({ clientId, nomeDoCliente, mensalidade }: { clientId: string; nomeDoCliente?: string; mensalidade?: number }) {
  const qc = useQueryClient();
  const [adicionando, setAdicionando] = useState(false);
  const [acao, setAcao] = useState<{ tipo: "iniciar" | "encerrar" | "editar" | "cobrancas"; id: string; nova?: boolean } | null>(null);

  const dados = useQuery({
    queryKey: ["extras-do-cliente", clientId],
    queryFn: async () => {
      const [extras, cobrancas] = await Promise.all([
        (supabase as any).from("client_extras").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
        (supabase as any).from("billing").select("id, extra_id, amount, paid_amount, status, due_date, paid_date, description, competencia").eq("client_id", clientId).not("extra_id", "is", null).order("due_date", { ascending: true }),
      ]);
      if (extras.error) throw extras.error;
      return { extras: (extras.data ?? []) as Extra[], cobrancas: (cobrancas.data ?? []) as CobrancaDeExtra[] };
    },
  });
  const extras = dados.data?.extras ?? [];
  const cobrancas = dados.data?.cobrancas ?? [];
  const resumo = useMemo(() => resumoDosExtras(extras), [extras]);
  const base = Number(mensalidade) || 0;

  const atualizar = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["extras-do-cliente", clientId] }),
      qc.invalidateQueries({ queryKey: ["billing"] }),
      qc.invalidateQueries({ queryKey: ["crescimento-recebimentos"] }),
      qc.invalidateQueries({ queryKey: ["extras-mensais-ativos"] }),
    ]);
  };

  return (
    <Secao
      titulo="Extras e produtos"
      data-extras-do-cliente=""
      descricao={
        dados.isLoading ? "Carregando…" : extras.length === 0
          ? "Nada além da mensalidade"
          : <span className="tabular-nums">{base > 0 && <>mensalidade {dinheiro(base)} + </>}extras {dinheiro(resumo.porMes)} por mês{resumo.aguardando > 0 ? ` · ${dinheiro(resumo.aguardando)} aguardando a entrega` : ""}</span>
      }
      ajuda="O que o cliente comprou além da mensalidade: suporte, sistema, automação, CRM, e-mail, comissão. Cada extra cria as próprias cobranças no Financeiro; o mensal gera a do mês sozinho."
      acao={
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setAdicionando(true)} data-adicionar-extra="">
          <PackagePlus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />Adicionar
        </button>
      }
    >
      {dados.isError && <p className="text-[13px] text-destructive">Não foi possível ler os extras deste cliente.</p>}
      {extras.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {extras.map((e) => {
            const doExtra = cobrancas.filter((c) => c.extra_id === e.id);
            const unico = andamentoDoUnico(doExtra, Number(e.valor) || 0);
            const encerrado = e.status === "encerrado";
            return (
              <li key={e.id} className={juntar("min-w-0 py-2.5", encerrado && "opacity-60")} data-extra={e.id}>
                <div className="flex min-w-0 flex-wrap items-baseline">
                  <span className="mr-2 min-w-0 text-[14px] font-medium text-foreground">{e.nome}</span>
                  <span className={juntar(etiqueta, "mr-2 bg-secondary text-muted-foreground")}>{nomeDaCategoria(e.categoria)}</span>
                  {e.status === "aguardando" && <span className={juntar(etiqueta, "mr-2 bg-warning-soft text-warning")}>aguardando a entrega</span>}
                  {encerrado && <span className={juntar(etiqueta, "mr-2 bg-secondary text-muted-foreground")}>encerrado em {dataCurta(e.encerrado_em)}</span>}
                  <span className="ml-auto shrink-0 text-[14px] font-semibold tabular-nums text-foreground">
                    {e.cobranca === "mensal" ? `${dinheiro(e.valor)} por mês` : e.cobranca === "unico" ? dinheiro(e.valor) : e.percentual ? `${String(e.percentual).replace(".", ",")}%` : "variável"}
                  </span>
                </div>
                <p className={juntar(texto.auxiliar, "mt-0.5")}>
                  {e.cobranca === "mensal" && (e.inicio ? `Cobra desde ${dataCurta(e.inicio)}, todo dia ${e.dia_vencimento ?? Number(e.inicio.slice(8, 10))}.` : "Ainda não começou a cobrar: defina a data quando entregar.")}
                  {e.cobranca === "unico" && `Recebido ${dinheiro(unico.pago)} ${unico.aberto > 0 ? ` · a receber ${dinheiro(unico.aberto)}${unico.proxima ? ` (próxima em ${dataCurta(unico.proxima)})` : ""}` : ""}${unico.aLancar > 0 ? ` · falta lançar ${dinheiro(unico.aLancar)}` : ""}.`}
                  {e.cobranca === "comissao" && `${e.base_da_comissao ? `Sobre ${e.base_da_comissao}. ` : ""}${doExtra.length ? `Recebido ${dinheiro(unico.pago)} em ${doExtra.length} ${doExtra.length === 1 ? "lançamento" : "lançamentos"}${unico.aberto > 0 ? ` · a receber ${dinheiro(unico.aberto)}` : ""}.` : "Nada lançado ainda."}`}
                  {e.observacao ? ` ${e.observacao}` : ""}
                </p>
                <div className="-m-1 mt-1 flex flex-wrap items-center [&>*]:m-1">
                  {!encerrado && e.cobranca === "comissao" && <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setAcao({ tipo: "cobrancas", id: e.id, nova: true })} data-lancar-recebimento="">Lançar recebimento</button>}
                  {!encerrado && e.cobranca === "unico" && unico.aLancar > 0 && <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setAcao({ tipo: "cobrancas", id: e.id, nova: true })}>Adicionar parcela</button>}
                  <button type="button" className={juntar(botao.secundario, "h-8")} aria-expanded={acao?.id === e.id && acao.tipo === "cobrancas"} onClick={() => setAcao(acao?.id === e.id && acao.tipo === "cobrancas" ? null : { tipo: "cobrancas", id: e.id })} data-ver-cobrancas="">
                    {e.cobranca === "comissao" ? "Lançamentos" : "Cobranças"} ({doExtra.length})
                  </button>
                  {!encerrado && (<>
                    {e.status === "aguardando" && <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => setAcao({ tipo: "iniciar", id: e.id })}>Começar a cobrar</button>}
                    <MenuMais rotulo={`Mais ações de ${e.nome}`} itens={[
                      { rotulo: "Editar", aoEscolher: () => setAcao({ tipo: "editar", id: e.id }) },
                      { rotulo: "Encerrar", perigo: true, aoEscolher: () => setAcao({ tipo: "encerrar", id: e.id }) },
                    ]} />
                  </>)}
                </div>
                {acao && acao.id === e.id && acao.tipo === "editar" && <EditarExtra extra={e} aoFechar={() => setAcao(null)} aoMudar={atualizar} />}
                {acao && acao.id === e.id && acao.tipo === "cobrancas" && <CobrancasDoExtra key={acao.nova ? "nova" : "lista"} extra={e} cobrancas={doExtra} sugestao={e.cobranca === "unico" ? unico.aLancar : 0} abrirNova={!!acao.nova} aoMudar={atualizar} />}
                {acao && acao.id === e.id && (acao.tipo === "iniciar" || acao.tipo === "encerrar") && <AcaoDoExtra extra={e} tipo={acao.tipo} aoFechar={() => setAcao(null)} aoMudar={atualizar} />}
              </li>
            );
          })}
        </ul>
      )}
      {adicionando && <JanelaDoExtra clientId={clientId} nomeDoCliente={nomeDoCliente} aoFechar={() => setAdicionando(false)} aoSalvar={atualizar} />}
    </Secao>
  );
}

/** Começar a cobrar, lançar a comissão do mês ou encerrar: um formulário curto na própria linha. */
function AcaoDoExtra({ extra, tipo, aoFechar, aoMudar }: { extra: Extra; tipo: "iniciar" | "encerrar"; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const [data, setData] = useState(hoje());
  const [paga, setPaga] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  const confirmar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const chamada = tipo === "iniciar"
        ? (supabase as any).rpc("extra_iniciar", { _id: extra.id, _inicio: data, _primeira_paga: paga, _paga_em: paga ? data : null })
        : (supabase as any).rpc("extra_encerrar", { _id: extra.id, _em: data });
      const { error } = await chamada;
      if (error) throw error;
      toast.success(tipo === "iniciar" ? `${extra.nome} começou a cobrar.` : `${extra.nome} encerrado. O que já foi pago continua no histórico.`);
      await aoMudar();
      aoFechar();
    } catch (e) {
      toast.error(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="mt-2 rounded-md bg-secondary/60 px-3 py-3" data-acao-do-extra={tipo}>
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo={tipo === "iniciar" ? "Começa a cobrar em" : "Encerra em"}>
          <input className={campo} type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </CampoDeFormulario>
        {tipo !== "encerrar" && (
          <CampoDeFormulario rotulo="Pagamento">
            <SeletorCompacto rotulo="Pagamento" modo="segmentado" larguraTotal opcoes={[{ valor: "nao", rotulo: "Vai pagar" }, { valor: "sim", rotulo: "Já pagou" }]} valor={paga ? "sim" : "nao"} onEscolher={(v) => setPaga(v === "sim")} />
          </CampoDeFormulario>
        )}
      </GrupoDeCampos>
      {tipo === "encerrar" && <p className={juntar(texto.auxiliar, "mt-2")}>O que já foi pago fica no histórico. As cobranças que ainda não venceram saem.</p>}
      <div className="-m-1 mt-2 flex flex-wrap [&>*]:m-1">
        <button type="button" className={juntar(tipo === "encerrar" ? botao.perigo : botao.primario, "h-8")} disabled={ocupado || !data} onClick={() => void confirmar()}>
          {ocupado ? "Salvando…" : tipo === "iniciar" ? "Começar a cobrar" : "Encerrar extra"}
        </button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={aoFechar}>Cancelar</button>
      </div>
    </div>
  );
}

/** Editar o extra: nome, tipo, valor, dia do vencimento, percentual e observação. O que ainda não foi pago acompanha. */
function EditarExtra({ extra, aoFechar, aoMudar }: { extra: Extra; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const paraCampo = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));
  const [nome, setNome] = useState(extra.nome);
  const [categoria, setCategoria] = useState(extra.categoria);
  const [valor, setValor] = useState(paraCampo(extra.valor));
  const [percentual, setPercentual] = useState(paraCampo(extra.percentual));
  const [baseDaComissao, setBaseDaComissao] = useState(extra.base_da_comissao ?? "");
  const [dia, setDia] = useState(extra.dia_vencimento ? String(extra.dia_vencimento) : "");
  const [observacao, setObservacao] = useState(extra.observacao ?? "");
  const [ocupado, setOcupado] = useState(false);
  const comissao = extra.cobranca === "comissao";
  const falta = nome.trim().length < 2 ? "Escreva o nome." : comissao ? (numero(percentual) <= 100 ? null : "O percentual vai até 100.") : numero(valor) > 0 ? null : "Diga o valor.";

  const salvar = async () => {
    if (ocupado || falta) return;
    setOcupado(true);
    try {
      const { error } = await (supabase as any).rpc("extra_editar", {
        _id: extra.id,
        _dados: { nome: nome.trim(), categoria, valor: comissao ? null : numero(valor), percentual: comissao && numero(percentual) > 0 ? numero(percentual) : null, base_da_comissao: baseDaComissao, dia_vencimento: extra.cobranca === "mensal" && Number(dia) >= 1 ? Number(dia) : null, observacao },
      });
      if (error) throw error;
      toast.success(`${nome.trim()} atualizado. O Financeiro já acompanha.`);
      await aoMudar();
      aoFechar();
    } catch (e) {
      toast.error(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <div className="mt-2 rounded-md bg-secondary/60 px-3 py-3" data-editar-extra-form="">
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo="Nome" largo>
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Tipo">
          <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
          </select>
        </CampoDeFormulario>
        {comissao ? (
          <>
            <CampoDeFormulario rotulo="Percentual (%)">
              <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Sobre o quê" largo>
              <input className={campo} value={baseDaComissao} maxLength={160} onChange={(e) => setBaseDaComissao(e.target.value)} />
            </CampoDeFormulario>
          </>
        ) : (
          <CampoDeFormulario rotulo={extra.cobranca === "mensal" ? "Valor por mês (R$)" : "Valor total (R$)"} apoio={extra.cobranca === "mensal" ? "Vale para o que ainda não foi pago." : "As parcelas você ajusta em Cobranças."}>
            <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} data-editar-valor="" />
          </CampoDeFormulario>
        )}
        {extra.cobranca === "mensal" && (
          <CampoDeFormulario rotulo="Dia do vencimento">
            <input className={juntar(campo, "tabular-nums")} type="number" min={1} max={31} value={dia} onChange={(e) => setDia(e.target.value)} />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Observação" largo>
          <input className={campo} value={observacao} maxLength={200} onChange={(e) => setObservacao(e.target.value)} />
        </CampoDeFormulario>
      </GrupoDeCampos>
      <div className="-m-1 mt-2 flex flex-wrap items-center [&>*]:m-1">
        <button type="button" className={juntar(botao.primario, "h-8")} disabled={ocupado || !!falta} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar"}</button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={aoFechar}>Cancelar</button>
        {falta && <span className={juntar(texto.auxiliar, "text-warning")}>{falta}</span>}
      </div>
    </div>
  );
}

/** As cobranças do extra, uma por linha, todas editáveis: valor, vencimento, pago ou não. E adicionar mais uma. */
function CobrancasDoExtra({ extra, cobrancas, sugestao, abrirNova, aoMudar }: { extra: Extra; cobrancas: CobrancaDeExtra[]; sugestao: number; abrirNova?: boolean; aoMudar: () => Promise<void> }) {
  const [aberta, setAberta] = useState<string | null>(abrirNova ? "nova" : null);
  const variavel = extra.cobranca === "comissao";
  const encerrado = extra.status === "encerrado";
  return (
    <div className="mt-2 rounded-md bg-secondary/60 px-3 py-2" data-cobrancas-do-extra="">
      {cobrancas.length === 0 && aberta !== "nova" && <p className={texto.auxiliar}>Nada lançado ainda.</p>}
      <ul className="min-w-0 text-[13px]">
        {cobrancas.map((c) => (
          <li key={c.id} className="min-w-0 py-1" data-cobranca={c.id}>
            <div className="flex min-w-0 items-baseline">
              <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{dataCurta(c.due_date)}</span>
              <span className="mr-2 min-w-0 truncate text-foreground">{(c.description ?? "").replace(`${extra.nome} · `, "") || "cobrança"}</span>
              <span className="ml-auto shrink-0 tabular-nums text-foreground">{dinheiro(c.amount)}</span>
              <span className={juntar("ml-2 w-28 shrink-0 text-right", c.status === "paid" ? "text-success" : "text-muted-foreground")}>{c.status === "paid" ? `pago ${dataCurta(c.paid_date).slice(0, 5)}` : "a receber"}</span>
              <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[13px]")} onClick={() => setAberta(aberta === c.id ? null : c.id)}>Editar</button>
            </div>
            {aberta === c.id && <FormDaCobranca extra={extra} cobranca={c} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />}
          </li>
        ))}
      </ul>
      {!encerrado && (
        aberta === "nova"
          ? <FormDaCobranca extra={extra} valorInicial={sugestao} aoFechar={() => setAberta(null)} aoMudar={aoMudar} />
          : <button type="button" className={juntar(botao.secundario, "mt-1 h-8")} onClick={() => setAberta("nova")} data-nova-cobranca="">{variavel ? "Lançar recebimento" : extra.cobranca === "unico" ? "Adicionar parcela" : "Adicionar cobrança"}</button>
      )}
    </div>
  );
}

function FormDaCobranca({ extra, cobranca, valorInicial, aoFechar, aoMudar }: { extra: Extra; cobranca?: CobrancaDeExtra; valorInicial?: number; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const [valor, setValor] = useState(cobranca ? String(cobranca.amount).replace(".", ",") : valorInicial && valorInicial > 0 ? String(valorInicial).replace(".", ",") : "");
  // No variável, o normal é lançar o que acabou de entrar: hoje e já pago.
  const variavel = extra.cobranca === "comissao";
  const pct = Number(extra.percentual) || 0;
  const [resultado, setResultado] = useState("");
  const [vence, setVence] = useState(cobranca?.due_date ?? (variavel ? hoje() : somarMeses(hoje(), 1)));
  const [paga, setPaga] = useState(cobranca ? cobranca.status === "paid" : variavel);
  const [pagaEm, setPagaEm] = useState(cobranca?.paid_date ?? hoje());
  const [ocupado, setOcupado] = useState(false);
  // A mensalidade de um mês não se apaga por aqui: a rotina do mês criaria de novo. Para parar, encerre o extra.
  const podeApagar = !!cobranca && !(extra.cobranca === "mensal" && cobranca.competencia);

  const rodar = async (chamada: PromiseLike<{ error: unknown }>, aviso: string) => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const { error } = await chamada;
      if (error) throw error;
      toast.success(aviso);
      await aoMudar();
      aoFechar();
    } catch (e) {
      toast.error(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  };
  const salvar = () => rodar(
    (supabase as any).rpc("extra_cobranca_salvar", { _dados: { id: cobranca?.id ?? null, extra_id: extra.id, valor: numero(valor), vencimento: vence, paga, paga_em: paga ? (variavel ? vence : pagaEm) : null, rotulo: variavel ? `${vence.slice(5, 7)}/${vence.slice(0, 4)}` : null } }),
    cobranca ? "Atualizado." : variavel ? `${dinheiro(numero(valor))} lançado. O Financeiro já foi atualizado.` : "Cobrança adicionada. O Financeiro já foi atualizado.",
  );

  return (
    <div className="mt-1 border-l-2 border-border py-1 pl-3" data-form-da-cobranca="">
      <GrupoDeCampos colunas={3}>
        {variavel && !cobranca && pct > 0 && (
          <CampoDeFormulario rotulo="Resultado (R$)" apoio={`Opcional: calcula ${String(pct).replace(".", ",")}% para você.`}>
            <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={resultado} placeholder="0,00" onChange={(e) => { setResultado(e.target.value); const r = numero(e.target.value); if (r > 0) setValor(String(Math.round(r * pct) / 100).replace(".", ",")); }} />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo={variavel ? "Valor recebido (R$)" : "Valor (R$)"}>
          <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" data-valor-da-cobranca="" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo={variavel ? "Data" : "Vence em"}>
          <input className={campo} type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Pagamento">
          <SeletorCompacto rotulo="Pagamento" modo="segmentado" larguraTotal opcoes={[{ valor: "nao", rotulo: "Vai pagar" }, { valor: "sim", rotulo: "Já pagou" }]} valor={paga ? "sim" : "nao"} onEscolher={(v) => setPaga(v === "sim")} />
        </CampoDeFormulario>
        {paga && !variavel && (
          <CampoDeFormulario rotulo="Pago em">
            <input className={campo} type="date" value={pagaEm} onChange={(e) => setPagaEm(e.target.value)} />
          </CampoDeFormulario>
        )}
      </GrupoDeCampos>
      <div className="-m-1 mt-2 flex flex-wrap [&>*]:m-1">
        <button type="button" className={juntar(botao.primario, "h-8")} disabled={ocupado || !(numero(valor) > 0) || !vence || (paga && !variavel && !pagaEm)} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Salvar"}</button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={aoFechar}>Cancelar</button>
        {podeApagar && <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[13px] text-destructive")} disabled={ocupado} onClick={() => void rodar((supabase as any).rpc("extra_cobranca_apagar", { _id: cobranca!.id }), "Cobrança apagada.")}>Apagar</button>}
      </div>
    </div>
  );
}

function JanelaDoExtra({ clientId, nomeDoCliente, aoFechar, aoSalvar }: { clientId: string; nomeDoCliente?: string; aoFechar: () => void; aoSalvar: () => Promise<void> }) {
  const [nome, setNome] = useState("");
  const [categoria, setCategoria] = useState("outro");
  const [cobranca, setCobranca] = useState<CobrancaDoExtra>("mensal");
  const [valor, setValor] = useState("");
  const [percentual, setPercentual] = useState("");
  const [baseDaComissao, setBaseDaComissao] = useState("");
  const [comecaAgora, setComecaAgora] = useState(true);
  const [inicio, setInicio] = useState(hoje());
  const [primeiraPaga, setPrimeiraPaga] = useState(false);
  const [entrada, setEntrada] = useState("");
  const [entradaPaga, setEntradaPaga] = useState(true);
  const [entradaEm, setEntradaEm] = useState(hoje());
  const [parcelas, setParcelas] = useState("1");
  const [restanteDepois, setRestanteDepois] = useState(false);
  const [primeiraEm, setPrimeiraEm] = useState(() => somarMeses(hoje(), 1));
  const [observacao, setObservacao] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const total = numero(valor);
  const lista = useMemo(
    () => (cobranca === "unico" && total > 0 ? montarParcelas({ total, entrada: numero(entrada), entradaPaga, entradaEm, parcelas: Number(parcelas) || 1, primeiraEm, restanteDepois }) : []),
    [cobranca, total, entrada, entradaPaga, entradaEm, parcelas, primeiraEm, restanteDepois],
  );
  const falta = conferirExtra({ nome, cobranca, valor: total, percentual: numero(percentual), comecaAgora, inicio, parcelas: lista });

  const usarAtalho = (id: string) => {
    const a = ATALHOS.find((x) => x.id === id);
    if (!a) return;
    setNome(a.nome);
    setCategoria(a.categoria);
    setCobranca(a.cobranca);
  };

  const salvar = async () => {
    if (ocupado || falta) return;
    setOcupado(true);
    try {
      const { error } = await (supabase as any).rpc("extra_salvar", {
        _dados: {
          client_id: clientId,
          nome: nome.trim(),
          categoria,
          cobranca,
          valor: cobranca === "comissao" ? 0 : total,
          percentual: cobranca === "comissao" && numero(percentual) > 0 ? numero(percentual) : null,
          base_da_comissao: cobranca === "comissao" ? baseDaComissao : null,
          inicio: cobranca === "mensal" && comecaAgora ? inicio : null,
          primeira_paga: cobranca === "mensal" && comecaAgora && primeiraPaga,
          primeira_paga_em: cobranca === "mensal" && comecaAgora && primeiraPaga ? inicio : null,
          parcelas: cobranca === "unico" ? lista : null,
          observacao,
        },
      });
      if (error) throw error;
      toast.success(`${nome.trim()} adicionado${nomeDoCliente ? ` a ${nomeDoCliente}` : ""}. O Financeiro já foi atualizado.`);
      await aoSalvar();
      aoFechar();
    } catch (e) {
      toast.error(mensagemDoErro(e));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <JanelaCentral
      aberta
      onFechar={aoFechar}
      titulo="Adicionar extra ou produto"
      icone={<PackagePlus className="h-4 w-4" aria-hidden="true" />}
      descricao={nomeDoCliente}
      ajuda="Todo mês cria a cobrança de cada mês sozinho a partir da data. Uma vez aceita entrada de qualquer valor e o restante em parcelas. Variável é a comissão ou o valor que muda: você lança o que recebeu, quando receber."
      largura="md"
      data-janela-do-extra=""
      rodape={
        <div className="flex w-full min-w-0 flex-wrap items-center">
          <span className={juntar(texto.auxiliar, "mr-auto min-w-0 pr-2", falta ? "text-warning" : "")} role="status">{falta || "Pronto para salvar."}</span>
          <button type="button" className={botao.secundario} onClick={aoFechar}>Cancelar</button>
          <button type="button" className={juntar(botao.primario, "ml-2")} disabled={ocupado || !!falta} onClick={() => void salvar()}>{ocupado ? "Salvando…" : "Adicionar"}</button>
        </div>
      }
    >
      <div className="-m-1 mb-3 flex flex-wrap [&>*]:m-1" role="group" aria-label="Atalhos">
        {ATALHOS.map((a) => (
          <button key={a.id} type="button" aria-pressed={nome === a.nome} onClick={() => usarAtalho(a.id)} className={juntar(botao.secundario, "h-8 px-2.5 text-[13px]", nome === a.nome && "border-primary text-primary")}>
            {a.rotulo}
          </button>
        ))}
      </div>
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo="O que ele está comprando" obrigatorio largo>
          <input className={campo} value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Suporte e manutenção do sistema" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Como cobra" largo apoio={O_QUE_E[cobranca]}>
          <SeletorCompacto rotulo="Como cobra" modo="segmentado" larguraTotal opcoes={COBRANCAS} valor={cobranca} onEscolher={(v) => setCobranca(v as CobrancaDoExtra)} />
        </CampoDeFormulario>

        {cobranca !== "comissao" && (
          <CampoDeFormulario rotulo={cobranca === "mensal" ? "Valor por mês (R$)" : "Valor total (R$)"} obrigatorio>
            <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" data-valor-do-extra="" />
          </CampoDeFormulario>
        )}

        {cobranca === "mensal" && (
          <>
            <CampoDeFormulario rotulo="Quando começa a cobrar">
              <SeletorCompacto rotulo="Quando começa a cobrar" modo="segmentado" larguraTotal opcoes={[{ valor: "data", rotulo: "Numa data" }, { valor: "depois", rotulo: "Depois da entrega" }]} valor={comecaAgora ? "data" : "depois"} onEscolher={(v) => setComecaAgora(v === "data")} />
            </CampoDeFormulario>
            {comecaAgora ? (
              <>
                <CampoDeFormulario rotulo="Primeira cobrança em" apoio="As próximas saem todo mês neste dia.">
                  <input className={campo} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="A primeira">
                  <SeletorCompacto rotulo="A primeira" modo="segmentado" larguraTotal opcoes={[{ valor: "nao", rotulo: "Vai pagar" }, { valor: "sim", rotulo: "Já pagou" }]} valor={primeiraPaga ? "sim" : "nao"} onEscolher={(v) => setPrimeiraPaga(v === "sim")} />
                </CampoDeFormulario>
              </>
            ) : (
              <p className={juntar(texto.auxiliar, "sm:col-span-full")}>Fica guardado sem cobrar nada. Quando entregar, use "Começar a cobrar" e escolha a data.</p>
            )}
          </>
        )}

        {cobranca === "unico" && (
          <>
            <CampoDeFormulario rotulo="Entrada (R$)" apoio="Vazio = sem entrada.">
              <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" data-entrada-do-extra="" />
            </CampoDeFormulario>
            {numero(entrada) > 0 && (
              <>
                <CampoDeFormulario rotulo="Data da entrada">
                  <input className={campo} type="date" value={entradaEm} onChange={(e) => setEntradaEm(e.target.value)} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="A entrada">
                  <SeletorCompacto rotulo="A entrada" modo="segmentado" larguraTotal opcoes={[{ valor: "sim", rotulo: "Já pagou" }, { valor: "nao", rotulo: "Vai pagar" }]} valor={entradaPaga ? "sim" : "nao"} onEscolher={(v) => setEntradaPaga(v === "sim")} />
                </CampoDeFormulario>
              </>
            )}
            {total > numero(entrada) && (
              <CampoDeFormulario rotulo="O restante" largo apoio={restanteDepois ? "Fica como falta lançar. Você adiciona as parcelas depois, em Cobranças." : undefined}>
                <SeletorCompacto rotulo="O restante" modo="segmentado" larguraTotal opcoes={[{ valor: "agora", rotulo: "Parcelar agora" }, { valor: "depois", rotulo: "Lanço depois" }]} valor={restanteDepois ? "depois" : "agora"} onEscolher={(v) => setRestanteDepois(v === "depois")} />
              </CampoDeFormulario>
            )}
            {total > numero(entrada) && !restanteDepois && (
              <>
                <CampoDeFormulario rotulo="Restante em quantas vezes">
                  <input className={juntar(campo, "tabular-nums")} type="number" min={1} max={36} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Primeira parcela em">
                  <input className={campo} type="date" value={primeiraEm} onChange={(e) => setPrimeiraEm(e.target.value)} />
                </CampoDeFormulario>
              </>
            )}
            {lista.length > 0 && (
              <ul className="min-w-0 text-[13px] sm:col-span-full" data-previa-das-parcelas="">
                {lista.map((p, i) => (
                  <li key={i} className="flex items-baseline py-0.5">
                    <span className="w-24 shrink-0 tabular-nums text-muted-foreground">{dataCurta(p.vencimento)}</span>
                    <span className="mr-2 text-foreground">{p.rotulo}</span>
                    <span className="ml-auto tabular-nums text-foreground">{dinheiro(p.valor)}</span>
                    <span className={juntar("ml-2 w-16 shrink-0 text-right", p.paga ? "text-success" : "text-muted-foreground")}>{p.paga ? "pago" : "a receber"}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {cobranca === "comissao" && (
          <>
            <CampoDeFormulario rotulo="Percentual (%)" apoio="Opcional. Sem ele, você lança direto o valor.">
              <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="Ex.: 2,5" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Sobre o quê" apoio="Opcional.">
              <input className={campo} value={baseDaComissao} maxLength={160} onChange={(e) => setBaseDaComissao(e.target.value)} placeholder="Ex.: valor de consórcio vendido pelo tráfego" />
            </CampoDeFormulario>
          </>
        )}

        <CampoDeFormulario rotulo="Observação" largo>
          <input className={campo} value={observacao} maxLength={200} onChange={(e) => setObservacao(e.target.value)} placeholder="Opcional" />
        </CampoDeFormulario>
      </GrupoDeCampos>
    </JanelaCentral>
  );
}
