import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useConfirm } from "@/components/shared/confirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  CampoDeFormulario, Carregando, EstadoDeErro, EstadoVazio, GrupoDeCampos,
  botao, campo, campoTexto, juntar, texto,
} from "@/components/sistema";
import { useFreelaContatos, useFreelaProjetos, useFreelaPropostas } from "./dadosFreela";
import { fmtMoeda, hojeISO, MOTIVOS_DE_PERDA, normalizar, ROTULO_STATUS_PROPOSTA, somaPorMoeda, somarMeses, totalEmTexto } from "@/lib/freela/freelaLib";
import FunilDasPropostas from "./FunilDasPropostas";
import TransformarEmCliente from "./TransformarEmCliente";
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

/** Funil do freela: do rascunho aos Fechados (viram cliente) e aos Perdidos (guardam o motivo para retomar). */
export default function AbaPropostas() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const { data: propostas, isLoading, isError, refetch } = useFreelaPropostas();
  const { data: contatos } = useFreelaContatos();
  const { data: projetos } = useFreelaProjetos();
  const [busca, setBusca] = useState("");
  const [filtroContato, setFiltroContato] = useState("todos");
  const [dialogAberto, setDialogAberto] = useState(false);
  const [editando, setEditando] = useState<Proposta | null>(null);
  const [form, setForm] = useState(formVazio);
  const [salvando, setSalvando] = useState(false);
  const [transformando, setTransformando] = useState<Proposta | null>(null);
  const [perdendo, setPerdendo] = useState<Proposta | null>(null);
  const [perda, setPerda] = useState({ motivo: "", detalhe: "", retomar: "" });

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
      if (filtroContato !== "todos" && p.contato_id !== filtroContato) return false;
      if (!termo) return true;
      return normalizar(p.titulo).includes(termo) || normalizar(nomeDoContato(p.contato_id)).includes(termo);
    });
  }, [propostas, busca, filtroContato, nomeDoContato]);

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
      ...(editando ? {} : { status: form.status }),
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
      if (form.status !== editando.status) void moverPara(data[0] as Proposta, form.status);
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

  const gravarEtapa = async (p: Proposta, campos: Partial<Proposta>, aviso: string) => {
    const { data, error } = await supabase.from("freela_propostas").update(campos).eq("id", p.id).select();
    if (error) {
      toast.error(`Não consegui mover a proposta: ${error.message}`);
      return false;
    }
    await queryClient.invalidateQueries({ queryKey: ["freela"] });
    if (!data || data.length === 0) {
      toast.info("Essa proposta não está mais disponível. A lista foi atualizada.");
      return false;
    }
    toast.success(aviso);
    return true;
  };

  /** Sair de Perdidos guarda o motivo nas anotações: a história de por que perdeu não some. */
  const camposAoRetomar = (p: Proposta): Partial<Proposta> => ({
    motivo_perda: null,
    perdida_em: null,
    follow_up_em: null,
    notes: p.motivo_perda ? [p.notes, `Perdida antes: ${p.motivo_perda}`].filter(Boolean).join("\n") : p.notes,
  });

  const moverPara = async (p: Proposta, etapa: string) => {
    if (etapa === p.status) return;
    if (p.convertida_em) {
      toast.info("Essa proposta já virou cliente.");
      return;
    }
    if (etapa === "perdida") {
      setPerda({ motivo: "", detalhe: "", retomar: somarMeses(hojeISO(), 1) });
      setPerdendo(p);
      return;
    }
    const campos = { status: etapa, ...(p.status === "perdida" ? camposAoRetomar(p) : {}) };
    await gravarEtapa(p, campos, etapa === "aceita" ? "Fechada! Agora transforme em cliente." : `Movida para ${ROTULO_STATUS_PROPOSTA[etapa] || etapa}.`);
  };

  const retomar = (p: Proposta) => moverPara(p, "negociacao");

  const confirmarPerda = async () => {
    if (!perdendo) return;
    if (!perda.motivo) {
      toast.error("Escolha o motivo da perda.");
      return;
    }
    const detalhe = perda.detalhe.trim();
    const ok = await gravarEtapa(perdendo, {
      status: "perdida",
      motivo_perda: detalhe ? `${perda.motivo}: ${detalhe}` : perda.motivo,
      perdida_em: new Date().toISOString(),
      follow_up_em: perda.retomar || null,
    }, "Guardada em Perdidos.");
    if (ok) setPerdendo(null);
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

  const temFiltro = !!busca || filtroContato !== "todos";
  const emAberto = lista.filter((p) => ["rascunho", "enviada", "negociacao"].includes(p.status));

  return (
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1">
      <div className="mb-2 flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por título ou contato"
          aria-label="Buscar proposta"
          className={juntar(campo, "sm:max-w-xs")}
        />
        <select value={filtroContato} onChange={(e) => setFiltroContato(e.target.value)} className={juntar(campo, "w-auto")} aria-label="Filtrar por contato">
          <option value="todos">Todos os contatos</option>
          {(contatos || []).map((c) => (
            <option key={c.id} value={c.id}>{c.nome}</option>
          ))}
        </select>
        <p className={juntar(texto.auxiliar, "min-w-0 truncate tabular-nums")}>Em aberto: {totalEmTexto(somaPorMoeda(emAberto))}</p>
        <button type="button" onClick={abrirNovo} className={juntar(botao.primario, "ml-auto")}>
          <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="hidden sm:inline">Nova proposta</span>
        </button>
      </div>

      {(propostas || []).length === 0 ? (
        <EstadoVazio compacto titulo="Nenhuma proposta ainda" descricao="Cadastre a primeira proposta do freela." />
      ) : lista.length === 0 && temFiltro ? (
        <EstadoVazio compacto titulo="Nenhuma proposta encontrada" descricao="Tente outro termo ou contato." />
      ) : (
        <FunilDasPropostas
          propostas={lista}
          contatoDe={(id) => (contatos || []).find((c) => c.id === id)}
          propostasComProjeto={propostasComProjeto}
          onAbrir={abrirEdicao}
          onMover={(p, etapa) => void moverPara(p, etapa)}
          onTransformar={setTransformando}
          onVirarProjeto={(p) => void virarProjeto(p)}
          onRetomar={(p) => void retomar(p)}
        />
      )}

      <TransformarEmCliente
        proposta={transformando}
        contato={transformando ? (contatos || []).find((c) => c.id === transformando.contato_id) || null : null}
        onFechar={() => setTransformando(null)}
      />

      <Dialog open={!!perdendo} onOpenChange={(aberto) => { if (!aberto) setPerdendo(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Por que perdeu?</DialogTitle>
            <DialogDescription>{perdendo?.titulo}. Fica na lista de Perdidos para tentar recuperar depois.</DialogDescription>
          </DialogHeader>
          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Motivo" obrigatorio>
              <select value={perda.motivo} onChange={(e) => setPerda({ ...perda, motivo: e.target.value })} className={campo}>
                <option value="">Escolha o motivo</option>
                {MOTIVOS_DE_PERDA.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="O que aconteceu">
              <textarea value={perda.detalhe} onChange={(e) => setPerda({ ...perda, detalhe: e.target.value })} className={campoTexto} placeholder="O que ele disse, o que faria voltar a conversa" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Retomar em">
              <input type="date" value={perda.retomar} onChange={(e) => setPerda({ ...perda, retomar: e.target.value })} className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setPerdendo(null)} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={() => void confirmarPerda()} className={botao.primario}>Marcar como perdida</button>
          </div>
        </DialogContent>
      </Dialog>

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
            <CampoDeFormulario rotulo="Etapa">
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={campo}>
                {/* Proposta nova não nasce perdida: perder pede o motivo, e o motivo é pedido ao mover. */}
                {Object.entries(ROTULO_STATUS_PROPOSTA).filter(([valor]) => editando || valor !== "perdida").map(([valor, rotulo]) => (
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
