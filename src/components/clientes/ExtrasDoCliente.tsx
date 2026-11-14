import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { CampoDeFormulario, GrupoDeCampos, JanelaCentral, Secao, SeletorCompacto, botao, campo, etiqueta, juntar, texto } from "@/components/sistema";
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
  if (m.includes("PARCELAS_NAO_FECHAM")) return "As parcelas não somam o valor total.";
  if (m.includes("COMISSAO_JA_LANCADA")) return "A comissão deste mês já foi lançada.";
  if (m.includes("EXTRA_JA_INICIADO")) return "Este extra já está sendo cobrado.";
  if (m.includes("SO_ADMIN")) return "Só o administrador mexe nos extras.";
  return m || "Não foi possível salvar.";
}

const COBRANCAS: { valor: CobrancaDoExtra; rotulo: string }[] = [
  { valor: "mensal", rotulo: "Todo mês" },
  { valor: "unico", rotulo: "Uma vez" },
  { valor: "comissao", rotulo: "Comissão" },
];

export default function ExtrasDoCliente({ clientId, nomeDoCliente, mensalidade }: { clientId: string; nomeDoCliente?: string; mensalidade?: number }) {
  const qc = useQueryClient();
  const [adicionando, setAdicionando] = useState(false);
  const [acao, setAcao] = useState<{ tipo: "iniciar" | "comissao" | "encerrar"; id: string } | null>(null);

  const dados = useQuery({
    queryKey: ["extras-do-cliente", clientId],
    queryFn: async () => {
      const [extras, cobrancas] = await Promise.all([
        (supabase as any).from("client_extras").select("*").eq("client_id", clientId).order("created_at", { ascending: true }),
        (supabase as any).from("billing").select("id, extra_id, amount, paid_amount, status, due_date, paid_date, description").eq("client_id", clientId).not("extra_id", "is", null).order("due_date", { ascending: true }),
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
            const unico = andamentoDoUnico(doExtra);
            const encerrado = e.status === "encerrado";
            return (
              <li key={e.id} className={juntar("min-w-0 py-2.5", encerrado && "opacity-60")} data-extra={e.id}>
                <div className="flex min-w-0 flex-wrap items-baseline">
                  <span className="mr-2 min-w-0 text-[14px] font-medium text-foreground">{e.nome}</span>
                  <span className={juntar(etiqueta, "mr-2 bg-secondary text-muted-foreground")}>{nomeDaCategoria(e.categoria)}</span>
                  {e.status === "aguardando" && <span className={juntar(etiqueta, "mr-2 bg-warning/15 text-warning")}>aguardando a entrega</span>}
                  {encerrado && <span className={juntar(etiqueta, "mr-2 bg-secondary text-muted-foreground")}>encerrado em {dataCurta(e.encerrado_em)}</span>}
                  <span className="ml-auto shrink-0 text-[14px] font-semibold tabular-nums text-foreground">
                    {e.cobranca === "mensal" ? `${dinheiro(e.valor)} por mês` : e.cobranca === "unico" ? dinheiro(e.valor) : `${String(e.percentual).replace(".", ",")}%`}
                  </span>
                </div>
                <p className={juntar(texto.auxiliar, "mt-0.5")}>
                  {e.cobranca === "mensal" && (e.inicio ? `Cobra desde ${dataCurta(e.inicio)}, todo dia ${e.dia_vencimento ?? Number(e.inicio.slice(8, 10))}.` : "Ainda não começou a cobrar: defina a data quando entregar.")}
                  {e.cobranca === "unico" && `Recebido ${dinheiro(unico.pago)} · falta ${dinheiro(unico.aberto)}${unico.proxima ? ` · próxima em ${dataCurta(unico.proxima)}` : ""}.`}
                  {e.cobranca === "comissao" && `Sobre ${e.base_da_comissao || "o resultado do mês"}. ${doExtra.length ? `${doExtra.length} ${doExtra.length === 1 ? "mês lançado" : "meses lançados"}.` : "Nenhum mês lançado ainda."}`}
                  {e.observacao ? ` ${e.observacao}` : ""}
                </p>
                {!encerrado && (
                  <div className="-m-1 mt-1 flex flex-wrap [&>*]:m-1">
                    {e.status === "aguardando" && <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setAcao({ tipo: "iniciar", id: e.id })}>Começar a cobrar</button>}
                    {e.cobranca === "comissao" && <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => setAcao({ tipo: "comissao", id: e.id })}>Lançar comissão do mês</button>}
                    <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[13px]")} onClick={() => setAcao({ tipo: "encerrar", id: e.id })}>Encerrar</button>
                  </div>
                )}
                {acao && acao.id === e.id && <AcaoDoExtra extra={e} tipo={acao.tipo} aoFechar={() => setAcao(null)} aoMudar={atualizar} />}
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
function AcaoDoExtra({ extra, tipo, aoFechar, aoMudar }: { extra: Extra; tipo: "iniciar" | "comissao" | "encerrar"; aoFechar: () => void; aoMudar: () => Promise<void> }) {
  const [data, setData] = useState(hoje());
  const [base, setBase] = useState("");
  const [paga, setPaga] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const valorDaComissao = Math.round(numero(base) * (extra.percentual ?? 0)) / 100;

  const confirmar = async () => {
    if (ocupado) return;
    setOcupado(true);
    try {
      const chamada = tipo === "iniciar"
        ? (supabase as any).rpc("extra_iniciar", { _id: extra.id, _inicio: data, _primeira_paga: paga, _paga_em: paga ? data : null })
        : tipo === "comissao"
          ? (supabase as any).rpc("extra_lancar_comissao", { _id: extra.id, _base: numero(base), _mes: data, _vencimento: data, _paga: paga, _paga_em: paga ? data : null })
          : (supabase as any).rpc("extra_encerrar", { _id: extra.id, _em: data });
      const { error } = await chamada;
      if (error) throw error;
      toast.success(tipo === "iniciar" ? `${extra.nome} começou a cobrar.` : tipo === "comissao" ? `Comissão de ${dinheiro(valorDaComissao)} lançada.` : `${extra.nome} encerrado. O que já foi pago continua no histórico.`);
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
      <GrupoDeCampos colunas={tipo === "comissao" ? 3 : 2}>
        {tipo === "comissao" && (
          <CampoDeFormulario rotulo="Resultado do mês (R$)" apoio={numero(base) > 0 ? `Comissão: ${dinheiro(valorDaComissao)}` : `${String(extra.percentual).replace(".", ",")}% sobre este valor`}>
            <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={base} onChange={(e) => setBase(e.target.value)} placeholder="0,00" />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo={tipo === "iniciar" ? "Começa a cobrar em" : tipo === "comissao" ? "Vence em" : "Encerra em"}>
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
        <button type="button" className={juntar(tipo === "encerrar" ? botao.perigo : botao.primario, "h-8")} disabled={ocupado || !data || (tipo === "comissao" && !(numero(base) > 0))} onClick={() => void confirmar()}>
          {ocupado ? "Salvando…" : tipo === "iniciar" ? "Começar a cobrar" : tipo === "comissao" ? "Lançar" : "Encerrar extra"}
        </button>
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={aoFechar}>Cancelar</button>
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
  const [primeiraEm, setPrimeiraEm] = useState(() => somarMeses(hoje(), 1));
  const [observacao, setObservacao] = useState("");
  const [ocupado, setOcupado] = useState(false);

  const total = numero(valor);
  const lista = useMemo(
    () => (cobranca === "unico" && total > 0 ? montarParcelas({ total, entrada: numero(entrada), entradaPaga, entradaEm, parcelas: Number(parcelas) || 1, primeiraEm }) : []),
    [cobranca, total, entrada, entradaPaga, entradaEm, parcelas, primeiraEm],
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
          percentual: cobranca === "comissao" ? numero(percentual) : null,
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
      ajuda="Todo mês cria a cobrança de cada mês sozinho a partir da data. Uma vez aceita entrada de qualquer valor e o restante em parcelas. Comissão guarda o percentual; a cada mês você lança o resultado e a cobrança sai calculada."
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
        <CampoDeFormulario rotulo="Como cobra">
          <SeletorCompacto rotulo="Como cobra" modo="segmentado" larguraTotal opcoes={COBRANCAS} valor={cobranca} onEscolher={(v) => setCobranca(v as CobrancaDoExtra)} />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Tipo">
          <select className={campo} value={categoria} onChange={(e) => setCategoria(e.target.value)}>
            {CATEGORIAS.map((c) => <option key={c.valor} value={c.valor}>{c.rotulo}</option>)}
          </select>
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
            <CampoDeFormulario rotulo="Percentual (%)" obrigatorio>
              <input className={juntar(campo, "tabular-nums")} inputMode="decimal" value={percentual} onChange={(e) => setPercentual(e.target.value)} placeholder="Ex.: 2,5" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Sobre o quê" largo apoio="A cada mês você lança o resultado e a cobrança sai calculada.">
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
