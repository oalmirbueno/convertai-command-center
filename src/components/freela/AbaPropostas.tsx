import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, ExternalLink, Pencil, Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Secao, SeletorCompacto,
  botao, campo, campoTexto, etiqueta, juntar, texto,
} from "@/components/sistema";
import { useFreelaContatos, useFreelaProjetos, useFreelaPropostas } from "./dadosFreela";
import { dataBR, fmtMoeda, normalizar, ROTULO_STATUS_PROPOSTA } from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Proposta = Tables<"freela_propostas">;

const formVazio = {
  contato_id: "",
  titulo: "",
  valor: "",
  moeda: "BRL",
  status: "rascunho",
  link_externo: "",
  validade_ate: "",
  escopo: "",
  notes: "",
};

const corDoStatus: Record<string, string> = {
  rascunho: "bg-muted text-muted-foreground",
  enviada: "bg-info/15 text-info",
  negociacao: "bg-warning/15 text-warning",
  aceita: "bg-success/15 text-success",
  perdida: "bg-destructive/15 text-destructive",
};

/** Propostas do freela: do rascunho ao aceite. Aceita vira projeto com um clique. */
export default function AbaPropostas() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: propostas, isLoading, isError, refetch } = useFreelaPropostas();
  const { data: contatos } = useFreelaContatos();
  const { data: projetos } = useFreelaProjetos();
  const [busca, setBusca] = useState("");
  const [filtroStatus, setFiltroStatus] = useState("todas");
  const [filtroContato, setFiltroContato] = useState("todos");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Proposta | null>(null);
  const [form, setForm] = useState(formVazio);
  const [salvando, setSalvando] = useState(false);

  const nomeDoContato = useMemo(() => {
    const mapa = new Map<string, string>();
    (contatos || []).forEach((c) => mapa.set(c.id, c.empresa ? `${c.nome} (${c.empresa})` : c.nome));
    return (id: string) => mapa.get(id) || "Contato removido";
  }, [contatos]);

  const propostasComProjeto = useMemo(
    () => new Set((projetos || []).map((p) => p.proposta_id).filter(Boolean)),
    [projetos],
  );

  const lista = useMemo(() => {
    const termo = normalizar(busca);
    return (propostas || []).filter((p) => {
      if (filtroStatus !== "todas" && p.status !== filtroStatus) return false;
      if (filtroContato !== "todos" && p.contato_id !== filtroContato) return false;
      if (!termo) return true;
      return normalizar(p.titulo).includes(termo) || normalizar(nomeDoContato(p.contato_id)).includes(termo);
    });
  }, [propostas, busca, filtroStatus, filtroContato, nomeDoContato]);

  const contatosAtivos = (contatos || []).filter((c) => !c.archived_at);

  const abrirNovo = () => {
    setEditando(null);
    setForm({ ...formVazio, moeda: contatosAtivos[0]?.moeda_preferida === "USD" ? "USD" : "BRL" });
    setDialogAberto(true);
  };

  const abrirEdicao = (p: Proposta) => {
    setEditando(p);
    setForm({
      contato_id: p.contato_id,
      titulo: p.titulo || "",
      valor: String(p.valor ?? ""),
      moeda: p.moeda === "USD" ? "USD" : "BRL",
      status: p.status || "rascunho",
      link_externo: p.link_externo || "",
      validade_ate: p.validade_ate || "",
      escopo: typeof p.escopo === "string" ? p.escopo : p.escopo ? JSON.stringify(p.escopo) : "",
      notes: p.notes || "",
    });
    setDialogAberto(true);
  };

  const salvar = async () => {
    const titulo = form.titulo.trim();
    const valor = Number(String(form.valor).replace(",", "."));
    if (!form.contato_id) {
      toast.error("Escolha o contato da proposta.");
      return;
    }
    if (!titulo) {
      toast.error("O título da proposta é obrigatório.");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor maior que zero.");
      return;
    }
    setSalvando(true);
    const registro = {
      contato_id: form.contato_id,
      titulo,
      valor,
      moeda: form.moeda,
      status: form.status,
      link_externo: form.link_externo.trim() || null,
      validade_ate: form.validade_ate || null,
      escopo: form.escopo.trim() || null,
      notes: form.notes.trim() || null,
    };
    if (editando) {
      const { data, error } = await supabase.from("freela_propostas").update(registro).eq("id", editando.id).select();
      setSalvando(false);
      if (error) {
        toast.error(`Não consegui salvar a proposta: ${error.message}`);
        return;
      }
      if (!data || data.length === 0) {
        await queryClient.invalidateQueries({ queryKey: ["freela"] });
        toast.info("Essa proposta não está mais disponível para edição. A lista foi atualizada.");
        return;
      }
      toast.success("Proposta atualizada.");
    } else {
      const { data, error } = await supabase.from("freela_propostas").insert(registro).select();
      setSalvando(false);
      if (error || !data || data.length === 0) {
        toast.error(`Não consegui criar a proposta${error ? `: ${error.message}` : "."}`);
        return;
      }
      toast.success("Proposta criada.");
    }
    setDialogAberto(false);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const mudarStatus = async (p: Proposta, status: string) => {
    if (status === p.status) return;
    const { data, error } = await supabase.from("freela_propostas").update({ status }).eq("id", p.id).select();
    if (error) {
      toast.error(`Não consegui mudar o status: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["freela"] });
      toast.info("Essa proposta não está mais disponível. A lista foi atualizada.");
      return;
    }
    toast.success(`Proposta marcada como ${ROTULO_STATUS_PROPOSTA[status] || status}.`);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const virarProjeto = async (p: Proposta) => {
    if (propostasComProjeto.has(p.id)) {
      toast.info("Essa proposta já virou projeto.");
      return;
    }
    if (!(await confirm({
      title: "Virar projeto?",
      description: `Cria o projeto "${p.titulo}" com o valor fechado de ${fmtMoeda(p.valor, p.moeda)}. Depois você gera as parcelas na aba Projetos.`,
      confirmLabel: "Criar projeto",
    }))) return;
    const { data, error } = await supabase
      .from("freela_projetos")
      .insert({
        proposta_id: p.id,
        contato_id: p.contato_id,
        titulo: p.titulo,
        escopo: p.escopo,
        valor_fechado: p.valor,
        moeda: p.moeda,
      })
      .select();
    if (error || !data || data.length === 0) {
      toast.error(`Não consegui criar o projeto${error ? `: ${error.message}` : "."}`);
      return;
    }
    toast.success("Projeto criado. Agora gere as parcelas.");
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
    navigate("/freela/projetos");
  };

  if (isLoading) return <Carregando forma="lista" linhas={4} rotulo="Carregando propostas" />;
  if (isError) {
    return (
      <EstadoDeErro
        titulo="Não foi possível carregar as propostas."
        acao={<button type="button" onClick={() => void refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <Secao
        titulo="Propostas"
        descricao={`${lista.length} ${lista.length === 1 ? "proposta" : "propostas"}`}
        ajuda="Proposta aceita vira projeto com as parcelas. O valor fica sempre na moeda da proposta: real e dólar nunca se misturam."
        acao={
          <button type="button" onClick={abrirNovo} className={botao.primario}>
            <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Nova proposta</span>
          </button>
        }
        divisoria
      >
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por título ou contato"
            aria-label="Buscar proposta"
            className={juntar(campo, "sm:max-w-xs")}
          />
          <SeletorCompacto
            opcoes={[
              { valor: "todas", rotulo: "Todas" },
              ...Object.entries(ROTULO_STATUS_PROPOSTA).map(([valor, rotulo]) => ({ valor, rotulo })),
            ]}
            valor={filtroStatus}
            onEscolher={setFiltroStatus}
            rotulo="Status da proposta"
            listaQuandoNaoCabe
          />
          <select value={filtroContato} onChange={(e) => setFiltroContato(e.target.value)} className={juntar(campo, "w-auto")} aria-label="Filtrar por contato">
            <option value="todos">Todos os contatos</option>
            {(contatos || []).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        </div>

        {lista.length === 0 ? (
          <EstadoVazio
            compacto
            titulo={busca || filtroStatus !== "todas" || filtroContato !== "todos" ? "Nenhuma proposta encontrada" : "Nenhuma proposta ainda"}
            descricao="Cadastre a primeira proposta do freela."
          />
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((p) => (
              <li key={p.id} className="flex min-w-0 items-center gap-2 px-1 py-2.5">
                <div className="mr-1 min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>{p.titulo}</p>
                    <span className={juntar(etiqueta, corDoStatus[p.status] || "bg-muted text-muted-foreground")}>
                      {ROTULO_STATUS_PROPOSTA[p.status] || p.status}
                    </span>
                    {propostasComProjeto.has(p.id) && <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>Virou projeto</span>}
                  </div>
                  <p className={juntar(texto.auxiliar, "truncate")}>
                    {nomeDoContato(p.contato_id)}
                    {" · "}<span className="tabular-nums text-foreground">{fmtMoeda(p.valor, p.moeda)}</span>
                    {p.validade_ate && <> · válida até {dataBR(p.validade_ate)}</>}
                    {p.link_externo && (
                      <>
                        {" · "}
                        <a href={p.link_externo} target="_blank" rel="noopener noreferrer" className="inline-flex items-center text-primary hover:underline">
                          link <ExternalLink className="ml-0.5 h-3 w-3" aria-hidden="true" />
                        </a>
                      </>
                    )}
                  </p>
                </div>
                <select
                  value={p.status}
                  onChange={(e) => void mudarStatus(p, e.target.value)}
                  className={juntar(campo, "h-8 w-auto shrink-0 text-[12px]")}
                  aria-label={`Status de ${p.titulo}`}
                >
                  {Object.entries(ROTULO_STATUS_PROPOSTA).map(([valor, rotulo]) => (
                    <option key={valor} value={valor}>{rotulo}</option>
                  ))}
                </select>
                {p.status === "aceita" && !propostasComProjeto.has(p.id) && (
                  <button type="button" onClick={() => void virarProjeto(p)} className={botao.barra} aria-label={`Virar projeto: ${p.titulo}`}>
                    <ArrowRight className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                    <span className="hidden sm:inline">Virar projeto</span>
                  </button>
                )}
                <button type="button" onClick={() => abrirEdicao(p)} className={botao.barra} aria-label={`Editar ${p.titulo}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar proposta" : "Nova proposta"}</DialogTitle>
            <DialogDescription>Contato, título e valor são obrigatórios.</DialogDescription>
          </DialogHeader>
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Contato" obrigatorio largo>
              <select
                value={form.contato_id}
                onChange={(e) => {
                  const contato = contatosAtivos.find((c) => c.id === e.target.value);
                  setForm({ ...form, contato_id: e.target.value, moeda: contato?.moeda_preferida === "USD" ? "USD" : form.moeda });
                }}
                className={campo}
              >
                <option value="">Escolha o contato</option>
                {contatosAtivos.map((c) => (
                  <option key={c.id} value={c.id}>{c.empresa ? `${c.nome} (${c.empresa})` : c.nome}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Título" obrigatorio largo>
              <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} className={campo} placeholder="Site institucional, identidade visual..." />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Valor" obrigatorio>
              <input inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} className={campo} placeholder="1500" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Moeda" obrigatorio>
              <select value={form.moeda} onChange={(e) => setForm({ ...form, moeda: e.target.value })} className={campo}>
                <option value="BRL">Real (R$)</option>
                <option value="USD">Dólar (US$)</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Status">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={campo}>
                {Object.entries(ROTULO_STATUS_PROPOSTA).map(([valor, rotulo]) => (
                  <option key={valor} value={valor}>{rotulo}</option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Válida até">
              <input type="date" value={form.validade_ate} onChange={(e) => setForm({ ...form, validade_ate: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Link externo" largo>
              <input type="url" value={form.link_externo} onChange={(e) => setForm({ ...form, link_externo: e.target.value })} className={campo} placeholder="https://..." />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Escopo" largo>
              <textarea value={form.escopo} onChange={(e) => setForm({ ...form, escopo: e.target.value })} className={campoTexto} placeholder="O que está incluído nesta proposta" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Anotações" largo>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={campoTexto} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialogAberto(false)} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>
              {salvando ? "Salvando..." : editando ? "Salvar" : "Criar proposta"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
