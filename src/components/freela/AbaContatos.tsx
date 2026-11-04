import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, KanbanSquare, Pencil, Plus, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos, Secao, SeletorCompacto,
  botao, campo, campoTexto, etiqueta, juntar, texto,
} from "@/components/sistema";
import { useFreelaContatos, useFreelaPropostas } from "./dadosFreela";
import { normalizar, somaPorMoeda, totalEmTexto } from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Contato = Tables<"freela_contatos">;

const formVazio = {
  nome: "",
  empresa: "",
  email: "",
  whatsapp: "",
  pais: "",
  moeda_preferida: "BRL",
  notes: "",
};

/** Contatos do freela: a entrada do funil. Arquivar guarda o histórico (nada de apagar). */
export default function AbaContatos() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const { data: contatos, isLoading, isError, refetch } = useFreelaContatos();
  const { data: propostas } = useFreelaPropostas();
  const [busca, setBusca] = useState("");
  const [mostrarArquivados, setMostrarArquivados] = useState("ativos");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Contato | null>(null);
  const [form, setForm] = useState(formVazio);
  const [salvando, setSalvando] = useState(false);

  const lista = useMemo(() => {
    const termo = normalizar(busca);
    return (contatos || []).filter((c) => {
      const arquivado = !!c.archived_at;
      if (mostrarArquivados === "ativos" && arquivado) return false;
      if (mostrarArquivados === "arquivados" && !arquivado) return false;
      if (!termo) return true;
      return [c.nome, c.empresa, c.email, c.whatsapp].some((campoTextoLivre) => normalizar(campoTextoLivre).includes(termo));
    });
  }, [contatos, busca, mostrarArquivados]);

  const abrirNovo = () => {
    setEditando(null);
    setForm(formVazio);
    setDialogAberto(true);
  };

  const abrirEdicao = (c: Contato) => {
    setEditando(c);
    setForm({
      nome: c.nome || "",
      empresa: c.empresa || "",
      email: c.email || "",
      whatsapp: c.whatsapp || "",
      pais: c.pais || "",
      moeda_preferida: c.moeda_preferida === "USD" ? "USD" : "BRL",
      notes: c.notes || "",
    });
    setDialogAberto(true);
  };

  const salvar = async () => {
    const nome = form.nome.trim();
    if (!nome) {
      toast.error("O nome do contato é obrigatório.");
      return;
    }
    setSalvando(true);
    const registro = {
      nome,
      empresa: form.empresa.trim() || null,
      email: form.email.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
      pais: form.pais.trim() || null,
      moeda_preferida: form.moeda_preferida,
      notes: form.notes.trim() || null,
    };
    if (editando) {
      const { data, error } = await supabase.from("freela_contatos").update(registro).eq("id", editando.id).select();
      setSalvando(false);
      if (error) {
        toast.error(`Não consegui salvar o contato: ${error.message}`);
        return;
      }
      if (!data || data.length === 0) {
        await queryClient.invalidateQueries({ queryKey: ["freela"] });
        toast.info("Esse contato não está mais disponível para edição. A lista foi atualizada.");
        return;
      }
      toast.success("Contato atualizado.");
    } else {
      const { data, error } = await supabase.from("freela_contatos").insert(registro).select();
      setSalvando(false);
      if (error || !data || data.length === 0) {
        toast.error(`Não consegui criar o contato${error ? `: ${error.message}` : "."}`);
        return;
      }
      toast.success("Contato criado.");
    }
    setDialogAberto(false);
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const alternarArquivo = async (c: Contato) => {
    const arquivar = !c.archived_at;
    if (arquivar && !(await confirm({
      title: `Arquivar ${c.nome}?`,
      description: "O contato sai da lista ativa, mas o histórico de propostas e projetos continua. Dá para desarquivar depois.",
      confirmLabel: "Arquivar",
    }))) return;
    const { data, error } = await supabase
      .from("freela_contatos")
      .update({ archived_at: arquivar ? new Date().toISOString() : null })
      .eq("id", c.id)
      .select();
    if (error) {
      toast.error(`Não consegui ${arquivar ? "arquivar" : "desarquivar"}: ${error.message}`);
      return;
    }
    if (!data || data.length === 0) {
      await queryClient.invalidateQueries({ queryKey: ["freela"] });
      toast.info("Esse contato não está mais disponível. A lista foi atualizada.");
      return;
    }
    toast.success(arquivar ? "Contato arquivado." : "Contato de volta à lista ativa.");
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
  };

  const promover = async (c: Contato) => {
    if (!(await confirm({
      title: `Promover ${c.nome} a cliente?`,
      description: "Cria o cadastro dele como cliente da agência e liga este contato a esse cadastro. Essa ligação não pode ser desfeita.",
      confirmLabel: "Promover a cliente",
    }))) return;
    const { data, error } = await supabase.rpc("freela_promover_a_cliente", { p_contato_id: c.id, p_criar_org: false });
    if (error || !data) {
      toast.error(`Não consegui promover o contato${error ? `: ${error.message}` : "."}`);
      return;
    }
    toast.success("Contato promovido a cliente da agência.");
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
    await queryClient.invalidateQueries({ queryKey: ["clients"] });
  };

  const resumoDasPropostas = (contatoId: string) => {
    const doContato = (propostas || []).filter((p) => p.contato_id === contatoId);
    if (doContato.length === 0) return "Sem proposta ainda";
    const abertas = doContato.filter((p) => ["rascunho", "enviada", "negociacao"].includes(p.status));
    const fechadas = doContato.filter((p) => p.status === "aceita");
    return [
      abertas.length ? `${abertas.length} em aberto: ${totalEmTexto(somaPorMoeda(abertas))}` : null,
      fechadas.length ? `${fechadas.length} fechada${fechadas.length > 1 ? "s" : ""}: ${totalEmTexto(somaPorMoeda(fechadas))}` : null,
    ].filter(Boolean).join(" · ") || `${doContato.length} perdida${doContato.length > 1 ? "s" : ""}`;
  };

  if (isLoading) return <Carregando forma="lista" linhas={4} rotulo="Carregando contatos" />;
  if (isError) {
    return (
      <EstadoDeErro
        titulo="Não foi possível carregar os contatos do freela."
        acao={<button type="button" onClick={() => void refetch()} className={botao.secundario}>Tentar de novo</button>}
      />
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <Secao
        titulo="Contatos"
        descricao={`${lista.length} ${lista.length === 1 ? "contato" : "contatos"}`}
        ajuda="Pessoas e empresas atendidas por fora da agência. Daqui nascem as propostas; quando vira recorrente, promova a cliente."
        acao={
          <button type="button" onClick={abrirNovo} className={botao.primario}>
            <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Novo contato</span>
          </button>
        }
        divisoria
      >
        <div className="mb-3 flex min-w-0 flex-wrap items-center gap-2">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, empresa, e-mail ou WhatsApp"
            aria-label="Buscar contato"
            className={juntar(campo, "sm:max-w-xs")}
          />
          <SeletorCompacto
            opcoes={[
              { valor: "ativos", rotulo: "Ativos" },
              { valor: "arquivados", rotulo: "Arquivados" },
              { valor: "todos", rotulo: "Todos" },
            ]}
            valor={mostrarArquivados}
            onEscolher={setMostrarArquivados}
            rotulo="Mostrar"
          />
        </div>

        {lista.length === 0 ? (
          <EstadoVazio
            compacto
            icone={<UserPlus className="h-5 w-5" />}
            titulo={busca ? "Nenhum contato encontrado" : "Nenhum contato ainda"}
            descricao={busca ? "Tente outro termo de busca." : "Cadastre o primeiro contato do freela."}
          />
        ) : (
          <ul className="divide-y divide-border">
            {lista.map((c) => (
              <li key={c.id} className="flex min-w-0 items-center gap-2 px-1 py-2.5">
                <div className="mr-1 min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className={juntar(texto.corpo, "truncate font-medium")}>{c.nome}</p>
                    {!!c.archived_at && <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>Arquivado</span>}
                    {c.promoted_client_id && <span className={juntar(etiqueta, "bg-success/15 text-success")} title={c.promoted_client_id}>Cliente da agência · {c.promoted_client_id.slice(0, 8)}</span>}
                  </div>
                  <p className={juntar(texto.auxiliar, "truncate")}>
                    {[c.empresa, c.email, c.whatsapp, c.pais].filter(Boolean).join(" · ") || "Sem dados de contato"}
                  </p>
                  <p className={juntar(texto.auxiliar, "truncate tabular-nums")}>{resumoDasPropostas(c.id)}</p>
                </div>
                {!c.archived_at && (
                  <Link to="/freela/propostas" className={juntar(botao.barra, "inline-flex items-center")} aria-label={`Ver o funil de ${c.nome}`}>
                    <KanbanSquare className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                    <span className="hidden sm:inline">Funil</span>
                  </Link>
                )}
                {!c.promoted_client_id && !c.archived_at && (
                  <button type="button" onClick={() => void promover(c)} className={botao.barra} aria-label={`Promover ${c.nome} a cliente`} title="Promover a cliente">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
                <button type="button" onClick={() => abrirEdicao(c)} className={botao.barra} aria-label={`Editar ${c.nome}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => void alternarArquivo(c)}
                  className={botao.barra}
                  aria-label={c.archived_at ? `Desarquivar ${c.nome}` : `Arquivar ${c.nome}`}
                >
                  {c.archived_at ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" /> : <Archive className="h-3.5 w-3.5" aria-hidden="true" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      <Dialog open={dialogAberto} onOpenChange={setDialogAberto}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar contato" : "Novo contato"}</DialogTitle>
            <DialogDescription>Só o nome é obrigatório; o resto ajuda na proposta.</DialogDescription>
          </DialogHeader>
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Nome" obrigatorio largo>
              <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className={campo} autoFocus />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Empresa">
              <input value={form.empresa} onChange={(e) => setForm({ ...form, empresa: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="País">
              <input value={form.pais} onChange={(e) => setForm({ ...form, pais: e.target.value })} className={campo} placeholder="Brasil, EUA..." />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="E-mail">
              <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="WhatsApp">
              <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} className={campo} placeholder="+55 11 9..." />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Moeda preferida" apoio="Sugerida nas propostas deste contato.">
              <select value={form.moeda_preferida} onChange={(e) => setForm({ ...form, moeda_preferida: e.target.value })} className={campo}>
                <option value="BRL">Real (R$)</option>
                <option value="USD">Dólar (US$)</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Anotações" largo>
              <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={campoTexto} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setDialogAberto(false)} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={() => void salvar()} disabled={salvando} className={botao.primario}>
              {salvando ? "Salvando..." : editando ? "Salvar" : "Criar contato"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
