import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CalendarClock, CheckCircle2, Pencil, Plus, Receipt } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AjudaRecolhida, botao, campo, CampoDeBusca, CampoDeFormulario, campoTexto, Carregando, EstadoDeErro, EstadoVazio, etiqueta, GrupoDeCampos, juntar, Painel, RegiaoRolavel, SeletorCompacto, texto,
} from "@/components/sistema";
import { useFreelaContatos, useFreelaParcelas, useFreelaProjetos } from "./dadosFreela";
import {
  dataBR, fmtMoeda, hojeISO, normalizar, ROTULO_STATUS_PARCELA, ROTULO_STATUS_PROJETO,
  somarMeses, statusVisualDaParcela,
} from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Projeto = Tables<"freela_projetos">;
type Parcela = Tables<"freela_parcelas">;

const formVazio = {
  contato_id: "",
  titulo: "",
  valor_fechado: "",
  moeda: "BRL",
  status: "kickoff",
  prazo_date: "",
  escopo: "",
};

const corDoStatus: Record<string, string> = {
  kickoff: "bg-info/15 text-info",
  em_andamento: "bg-warning/15 text-warning",
  entrega: "bg-primary/10 text-primary",
  pago: "bg-success/15 text-success",
  arquivado: "bg-muted text-muted-foreground",
};

const corDaParcela: Record<string, string> = {
  aberta: "bg-warning/15 text-warning",
  atrasada: "bg-destructive/15 text-destructive",
  paga: "bg-success/15 text-success",
  cancelada: "bg-muted text-muted-foreground",
};

/** Projetos do freela: o trabalho fechado e as parcelas que alimentam o caixa. */
export default function AbaProjetos() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: projetos, isLoading, isError, refetch } = useFreelaProjetos();
  const { data: contatos } = useFreelaContatos();
  const { data: parcelas } = useFreelaParcelas();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Projeto | null>(null);
  const [form, setForm] = useState(formVazio);
  const [salvando, setSalvando] = useState(false);
  const [parcelasDoProjeto, setParcelasDoProjeto] = useState<Projeto | null>(null);
  const [gerarN, setGerarN] = useState("2");
  const [gerarPrimeiro, setGerarPrimeiro] = useState(hojeISO());
  const [novaParcela, setNovaParcela] = useState({ valor: "", vencimento: hojeISO() });
  const [gravandoParcela, setGravandoParcela] = useState(false);

  const nomeDoContato = useMemo(() => {
    const mapa = new Map<string, string>();
    (contatos || []).forEach((c) => mapa.set(c.id, c.empresa ? `${c.nome} (${c.empresa})` : c.nome));
    return (id: string) => mapa.get(id) || "Contato removido";
  }, [contatos]);

  const parcelasPorProjeto = useMemo(() => {
    const mapa = new Map<string, Parcela[]>();
    (parcelas || []).forEach((p) => {
      const arr = mapa.get(p.projeto_id) || [];
      arr.push(p);
      mapa.set(p.projeto_id, arr);
    });
    return mapa;
  }, [parcelas]);

  const lista = useMemo(() => {
    const termo = normalizar(busca);
    return (projetos || []).filter((p) => {
      if (filtroStatus !== "todos" && p.status !== filtroStatus) return false;
      if (!termo) return true;
      return normalizar(p.titulo).includes(termo) || normalizar(nomeDoContato(p.contato_id)).includes(termo);
    });
  }, [projetos, busca, filtroStatus, nomeDoContato]);

  const contatosAtivos = (contatos || []).filter((c) => !c.archived_at);
  // O banco aceitaria trocar a moeda do projeto, e as parcelas ficariam na moeda antiga.
  const temParcelas = !!editando && (parcelasPorProjeto.get(editando.id) || []).length > 0;

  const abrirNovo = () => {
    setEditando(null);
    setForm(formVazio);
    setDialogAberto(true);
  };

  const abrirEdicao = (p: Projeto) => {
    setEditando(p);
    setForm({
      contato_id: p.contato_id,
      titulo: p.titulo || "",
      valor_fechado: String(p.valor_fechado ?? ""),
      moeda: p.moeda === "USD" ? "USD" : "BRL",
      status: p.status || "kickoff",
      prazo_date: p.prazo_date || "",
      escopo: typeof p.escopo === "string" ? p.escopo : p.escopo ? JSON.stringify(p.escopo) : "",
    });
    setDialogAberto(true);
  };

  const salvar = async () => {
    const titulo = form.titulo.trim();
    const valor = Number(String(form.valor_fechado).replace(",", "."));
    if (!form.contato_id) {
      toast.error("Escolha o contato do projeto.");
      return;
    }
    if (!titulo) {
      toast.error("O título do projeto é obrigatório.");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor fechado maior que zero.");
      return;
    }
    if (temParcelas && editando && form.moeda !== editando.moeda) {
      toast.error("Este projeto já tem parcelas: a moeda não muda mais.");
      return;
    }
    setSalvando(true);
    const registro = {
      contato_id: form.contato_id,
      titulo,
      valor_fechado: valor,
      moeda: form.moeda,
      status: form.status,
      prazo_date: form.prazo_date || null,
      escopo: form.escopo.trim() || null,
    };
    if (editando) {
      const { data, error } = await supabase.from("freela_projetos").update(registro).eq("id", editando.id).select();
      setSalvando(false);
      if (error) {
        toast.error(`Não consegui salvar o projeto: ${error.message}`);
        return;
      }
      if (!data || data.length === 0) {
        await queryClient.invalidateQueries({ queryKey: ["freela"] });
        toast.info("Esse projeto não está mais disponível para edição. A lista foi atualizada.");
        return;
      }
      toast.success("Projeto atualizado.");
    } else {
      const { data, error } = await supabase.from("freela_projetos").insert(registro).select();
      setSalvando(false);
      if (error || !data || data.length === 0) {
        toast.error(`Não consegui criar o projeto${error ? `: ${error.message}` : "."}`);
        return;
      }
      toast.success("Projeto criado. Agora gere as parcelas.");
    }
    setDialogAberto(false);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const mudarStatus = async (p: Projeto, status: string) => {
    if (status === p.status) return;
    const { data, error } = await supabase.from("freela_projetos").update({ status }).eq("id", p.id).select();
    if (error) {
      toast.error(`Não consegui mudar o status: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["freela"] });
      toast.info("Esse projeto não está mais disponível. A lista foi atualizada.");
      return;
    }
    toast.success(`Projeto marcado como ${ROTULO_STATUS_PROJETO[status] || status}.`);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  /* ---------------- Parcelas ---------------- */

  const abrirParcelas = (p: Projeto) => {
    setParcelasDoProjeto(p);
    setGerarN("2");
    setGerarPrimeiro(hojeISO());
    setNovaParcela({ valor: "", vencimento: hojeISO() });
  };

  const gerarParcelas = async () => {
    if (!parcelasDoProjeto) return;
    const n = Math.floor(Number(gerarN));
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      toast.error("Informe uma quantidade de parcelas entre 1 e 60.");
      return;
    }
    if (!gerarPrimeiro) {
      toast.error("Informe o primeiro vencimento.");
      return;
    }
    const existentes = parcelasPorProjeto.get(parcelasDoProjeto.id) || [];
    if (existentes.length > 0 && !(await confirm({
      title: "Gerar parcelas?",
      description: `Este projeto já tem ${existentes.length} ${existentes.length === 1 ? "parcela" : "parcelas"}. As novas entram depois da última numeração.`,
      confirmLabel: "Gerar assim mesmo",
    }))) return;
    const total = Number(parcelasDoProjeto.valor_fechado);
    const base = Math.floor((total / n) * 100) / 100;
    const inicio = existentes.reduce((m, p) => Math.max(m, p.numero), 0);
    const linhas = Array.from({ length: n }, (_, i) => ({
      projeto_id: parcelasDoProjeto.id,
      numero: inicio + i + 1,
      valor: i === n - 1 ? Math.round((total - base * (n - 1)) * 100) / 100 : base,
      moeda: parcelasDoProjeto.moeda,
      vencimento: somarMeses(gerarPrimeiro, i),
    }));
    setGravandoParcela(true);
    const { data, error } = await supabase.from("freela_parcelas").insert(linhas).select();
    setGravandoParcela(false);
    if (error || !data || data.length !== linhas.length) {
      toast.error(`Não consegui gerar as parcelas${error ? `: ${error.message}` : ". Confira a numeração."}`);
      return;
    }
    toast.success(`${n} ${n === 1 ? "parcela gerada" : "parcelas geradas"} de ${fmtMoeda(total, parcelasDoProjeto.moeda)}.`);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const adicionarParcela = async () => {
    if (!parcelasDoProjeto) return;
    const valor = Number(String(novaParcela.valor).replace(",", "."));
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    if (!novaParcela.vencimento) {
      toast.error("Informe o vencimento.");
      return;
    }
    const existentes = parcelasPorProjeto.get(parcelasDoProjeto.id) || [];
    const numero = existentes.reduce((m, p) => Math.max(m, p.numero), 0) + 1;
    setGravandoParcela(true);
    const { data, error } = await supabase
      .from("freela_parcelas")
      .insert({
        projeto_id: parcelasDoProjeto.id,
        numero,
        valor,
        moeda: parcelasDoProjeto.moeda,
        vencimento: novaParcela.vencimento,
      })
      .select();
    setGravandoParcela(false);
    if (error || !data || data.length === 0) {
      toast.error(`Não consegui adicionar a parcela${error ? `: ${error.message}` : "."}`);
      return;
    }
    toast.success(`Parcela ${numero} adicionada.`);
    setNovaParcela({ valor: "", vencimento: hojeISO() });
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const marcarPaga = async (parcela: Parcela) => {
    const hoje = hojeISO();
    const { data, error } = await supabase
      .from("freela_parcelas")
      .update({ status: "paga", pago_em: hoje })
      .eq("id", parcela.id)
      .in("status", ["aberta", "atrasada"])
      .select();
    if (error) {
      toast.error(`Não consegui registrar o pagamento: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["freela"] });
      toast.info("Essa parcela não está mais em aberto. A lista foi atualizada.");
      return;
    }
    toast.success(`Parcela ${parcela.numero} marcada como paga.`);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
    // O gatilho do banco espelha a parcela no billing do financeiro.
    await queryClient.invalidateQueries({ queryKey: ["billing"] });
  };

  const cancelarParcela = async (parcela: Parcela) => {
    if (!(await confirm({
      title: `Cancelar a parcela ${parcela.numero}?`,
      description: "Ela sai do caixa previsto, mas fica no histórico do projeto.",
      confirmLabel: "Cancelar parcela",
      destructive: true,
    }))) return;
    const { data, error } = await supabase
      .from("freela_parcelas")
      .update({ status: "cancelada" })
      .eq("id", parcela.id)
      .in("status", ["aberta", "atrasada"])
      .select();
    if (error) {
      toast.error(`Não consegui cancelar: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["freela"] });
      toast.info("Essa parcela não está mais em aberto. A lista foi atualizada.");
      return;
    }
    toast.success("Parcela cancelada.");
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
    await queryClient.invalidateQueries({ queryKey: ["billing"] });
  };

  if (isLoading) return <Carregando forma="lista" linhas={4} rotulo="Carregando projetos" />;
  if (isError) {
    return (
      <EstadoDeErro
        titulo="Não foi possível carregar os projetos."
        acao={<button type="button" onClick={() => void refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  const parcelasAbertas = parcelasDoProjeto
    ? (parcelasPorProjeto.get(parcelasDoProjeto.id) || []).slice().sort((a, b) => a.numero - b.numero)
    : [];

  return (
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar por título ou contato" rotulo="Buscar projeto" className="min-w-[180px] flex-1 sm:max-w-[420px]" />
        <SeletorCompacto
          opcoes={[
            { valor: "todos", rotulo: "Todos" },
            ...Object.entries(ROTULO_STATUS_PROJETO).map(([valor, rotulo]) => ({ valor, rotulo })),
          ]}
          valor={filtroStatus}
          onEscolher={setFiltroStatus}
          rotulo="Status do projeto"
          listaQuandoNaoCabe
        />
        <p className={juntar(texto.auxiliar, "min-w-0 truncate tabular-nums")}>{lista.length} {lista.length === 1 ? "projeto" : "projetos"}</p>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <AjudaRecolhida rotulo="Sobre os projetos">Cada projeto tem as suas parcelas, sempre na moeda fechada. Marcar paga aqui atualiza o caixa do freela e o financeiro.</AjudaRecolhida>
          <button type="button" onClick={abrirNovo} className={botao.primario}>
            <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Novo projeto</span>
          </button>
        </div>
      </div>

      <RegiaoRolavel rotulo="Lista de projetos" memoria="freela:projetos" className="min-w-0 lg:pb-12 lg:pr-1">
        {lista.length === 0 ? (
          <EstadoVazio
            compacto
            titulo={busca || filtroStatus !== "todos" ? "Nenhum projeto encontrado" : "Nenhum projeto ainda"}
            descricao="Aceite uma proposta e vire projeto, ou crie direto aqui."
          />
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((p) => {
              const doProjeto = parcelasPorProjeto.get(p.id) || [];
              const pagas = doProjeto.filter((x) => x.status === "paga").length;
              return (
                <li key={p.id} className="flex min-w-0 items-center gap-2 px-1 py-2.5">
                  <div className="mr-1 min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <p className={juntar(texto.corpo, "truncate font-medium")}>{p.titulo}</p>
                      <span className={juntar(etiqueta, corDoStatus[p.status] || "bg-muted text-muted-foreground")}>
                        {ROTULO_STATUS_PROJETO[p.status] || p.status}
                      </span>
                    </div>
                    <p className={juntar(texto.auxiliar, "truncate")}>
                      {nomeDoContato(p.contato_id)}
                      {" · "}<span className="tabular-nums text-foreground">{fmtMoeda(p.valor_fechado, p.moeda)}</span>
                      {p.prazo_date && <> · prazo {dataBR(p.prazo_date)}</>}
                      {doProjeto.length > 0 && <> · {pagas}/{doProjeto.length} parcelas pagas</>}
                    </p>
                  </div>
                  <select
                    value={p.status}
                    onChange={(e) => void mudarStatus(p, e.target.value)}
                    className={juntar(campo, "h-8 w-auto shrink-0 text-[12px]")}
                    aria-label={`Status de ${p.titulo}`}
                  >
                    {Object.entries(ROTULO_STATUS_PROJETO).map(([valor, rotulo]) => (
                      <option key={valor} value={valor}>{rotulo}</option>
                    ))}
                  </select>
                  <button type="button" onClick={() => abrirParcelas(p)} className={botao.barra} aria-label={`Parcelas de ${p.titulo}`}>
                    <Receipt className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                    <span className="hidden sm:inline">Parcelas</span>
                  </button>
                  <button type="button" onClick={() => abrirEdicao(p)} className={botao.barra} aria-label={`Editar ${p.titulo}`}>
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </RegiaoRolavel>

      {/* Projeto: cadastro */}
      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar projeto" : "Novo projeto"}</DialogTitle>
            <DialogDescription>Contato, título e valor fechado são obrigatórios.</DialogDescription>
          </DialogHeader>
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Contato" obrigatorio largo>
              <select value={form.contato_id} onChange={(e) => setForm({ ...form, contato_id: e.target.value })} className={campo}>
                <option value="">Escolha o contato</option>
                {contatosAtivos.map((c) => (
                  <option key={c.id} value={c.id}>{c.empresa ? `${c.nome} (${c.empresa})` : c.nome}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Título" obrigatorio largo>
              <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Valor fechado" obrigatorio>
              <input inputMode="decimal" value={form.valor_fechado} onChange={(e) => setForm({ ...form, valor_fechado: e.target.value })} className={campo} placeholder="3000" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Moeda" obrigatorio apoio={temParcelas ? "Já tem parcelas: a moeda não muda mais." : "As parcelas seguem esta moeda."}>
              <select value={form.moeda} disabled={temParcelas} onChange={(e) => setForm({ ...form, moeda: e.target.value })} className={campo}>
                <option value="BRL">Real (R$)</option>
                <option value="USD">Dólar (US$)</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={campo}>
                {Object.entries(ROTULO_STATUS_PROJETO).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>{rotulo}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Prazo de entrega">
              <input type="date" value={form.prazo_date} onChange={(e) => setForm({ ...form, prazo_date: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Escopo" largo>
              <textarea value={form.escopo} onChange={(e) => setForm({ ...form, escopo: e.target.value })} className={campoTexto} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <DialogFooter className="-mb-2 gap-2 py-2 sm:space-x-0">
            <button type="button" onClick={() => setDialogAberto(false)} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>
              {salvando ? "Salvando..." : editando ? "Salvar" : "Criar projeto"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Projeto: parcelas */}
      <Dialog open={!!parcelasDoProjeto} onOpenChange={(aberto) => !aberto && setParcelasDoProjeto(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Parcelas · {parcelasDoProjeto?.titulo}</DialogTitle>
            <DialogDescription>
              {parcelasDoProjeto && `Valor fechado: ${fmtMoeda(parcelasDoProjeto.valor_fechado, parcelasDoProjeto.moeda)}. O banco espelha cada parcela no financeiro.`}
            </DialogDescription>
          </DialogHeader>

          {parcelasDoProjeto && (
            <div className="space-y-4">
              {parcelasAbertas.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhuma parcela ainda" descricao="Gere parcelas iguais ou adicione uma a uma." />
              ) : (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {parcelasAbertas.map((parcela) => {
                    const visual = statusVisualDaParcela(parcela);
                    return (
                      <li key={parcela.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
                        <div className="mr-1 min-w-0 flex-1">
                          <p className={juntar(texto.corpo, "truncate")}>
                            Parcela {parcela.numero} · <span className="tabular-nums">{fmtMoeda(parcela.valor, parcela.moeda)}</span>
                          </p>
                          <p className={juntar(texto.auxiliar, "truncate")}>
                            vence {dataBR(parcela.vencimento)}
                            {parcela.status === "paga" && parcela.pago_em && <> · paga em {dataBR(parcela.pago_em)}</>}
                          </p>
                        </div>
                        <span className={juntar(etiqueta, corDaParcela[visual] || "bg-muted text-muted-foreground")}>
                          {ROTULO_STATUS_PARCELA[visual] || visual}
                        </span>
                        {visual !== "paga" && visual !== "cancelada" && (
                          <>
                            <button
                              type="button"
                              onClick={() => void marcarPaga(parcela)}
                              className={juntar(botao.barra, "text-success")}
                              aria-label={`Marcar parcela ${parcela.numero} como paga`}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                              <span className="hidden sm:inline">Marcar paga</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void cancelarParcela(parcela)}
                              className={juntar(botao.barra, "text-destructive")}
                              aria-label={`Cancelar parcela ${parcela.numero}`}
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <Painel titulo="Gerar parcelas iguais" ajuda="Divide o valor fechado; a última recebe o arredondamento." className="text-[13px]">
                <div className="flex min-w-0 flex-wrap items-end gap-2">
                  <CampoDeFormulario rotulo="Quantidade">
                    <input inputMode="numeric" value={gerarN} onChange={(e) => setGerarN(e.target.value)} className={juntar(campo, "w-24")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="1º vencimento">
                    <input type="date" value={gerarPrimeiro} onChange={(e) => setGerarPrimeiro(e.target.value)} className={juntar(campo, "w-auto")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Intervalo" apoio="Mensal">
                    <div className={juntar(campo, "flex w-24 items-center text-muted-foreground")}>
                      <CalendarClock className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> mensal
                    </div>
                  </CampoDeFormulario>
                  <button type="button" onClick={() => void gerarParcelas()} disabled={gravandoParcela} className={botao.primario}>
                    Gerar
                  </button>
                </div>
              </Painel>

              <Painel titulo="Adicionar uma parcela" className="text-[13px]">
                <div className="flex min-w-0 flex-wrap items-end gap-2">
                  <CampoDeFormulario rotulo={`Valor (${parcelasDoProjeto.moeda === "USD" ? "US$" : "R$"})`}>
                    <input inputMode="decimal" value={novaParcela.valor} onChange={(e) => setNovaParcela({ ...novaParcela, valor: e.target.value })} className={juntar(campo, "w-32")} />
                  </CampoDeFormulario>
                  <CampoDeFormulario rotulo="Vencimento">
                    <input type="date" value={novaParcela.vencimento} onChange={(e) => setNovaParcela({ ...novaParcela, vencimento: e.target.value })} className={juntar(campo, "w-auto")} />
                  </CampoDeFormulario>
                  <button type="button" onClick={() => void adicionarParcela()} disabled={gravandoParcela} className={botao.secundario}>
                    Adicionar
                  </button>
                </div>
              </Painel>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
