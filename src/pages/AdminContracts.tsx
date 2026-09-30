import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast as avisar } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { useToast } from "@/hooks/use-toast";
import { useLarguraMinima } from "@/hooks/useLarguraMinima";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { FileSignature, Upload, Send, CheckCircle2, Clock, ChevronRight, ExternalLink, Mail, Trash2, Plus, BookOpen } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  CampoDeBusca,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  MenuMais,
  Painel,
  SeletorCompacto,
  botao,
  campo,
  campoTexto,
  etiqueta,
  juntar,
  texto,
  toqueCompacto,
  useEstadoDaTela,
} from "@/components/sistema";
import {
  resolveFileUrl,
  storageRefFromFile,
  useResolvedFileUrl,
} from "@/lib/fileUrls";
import { textoDoErro } from "@/lib/mesa/api";
import { AO_VIVO_CALMO } from "@/lib/consultaAoVivo";
import { chamarContratos, CHAVES_DOS_CONTRATOS } from "@/lib/contratos/api";
import EsqueletoDoPainel from "@/components/contratos/EsqueletoDoPainel";

// Frente CON (30/09): contratos montados por modelo, com o agente de contratos ao lado.
const DetalheDoContrato = lazy(() => import("@/components/contratos/DetalheDoContrato"));
const NovoContrato = lazy(() => import("@/components/contratos/NovoContrato"));
const AgenteDeContratos = lazy(() => import("@/components/contratos/AgenteDeContratos"));
// Frente CON2 (30/09): painel (a vencer, pendentes, assinados no mês, recorrente) e editor de modelos.
const PainelDosContratos = lazy(() => import("@/components/contratos/PainelDosContratos"));
const EditorDeModelos = lazy(() => import("@/components/contratos/EditorDeModelos"));
// UXS (30/09): a janela de envio do PDF é a mesma do contrato de modelo (só carrega ao abrir).
const EnvioDoContratoDeArquivo = lazy(() => import("@/components/contratos/JanelaDeEnvio").then((m) => ({ default: m.EnvioDoContratoDeArquivo })));

/**
 * Só as colunas que a lista usa (UXS, 30/09): o select("*") trazia o texto
 * inteiro congelado, os valores e as cláusulas de cada contrato a cada
 * consulta. `string` de propósito: o parser de tipos do postgrest não entra.
 * O token de assinatura não vem aqui; a janela de envio do PDF lê na hora.
 */
const COLUNAS_DA_LISTA: string = "id,title,description,client_id,status,origem,numero,versao,sent_at,admin_signed_at,client_signed_at,created_at,original_file_url,original_file_name,arquivado_em,substituido_por";

type Contract = {
  id: string;
  title: string;
  description: string | null;
  client_id: string;
  status: string;
  original_file_url: string;
  original_file_name: string;
  admin_signed_at: string | null;
  client_signed_at: string | null;
  sent_at: string | null;
  created_at: string;
  /** Frente CON: 'modelo' é montado pelo modelo; sem a coluna (banco antigo), vale 'arquivo'. */
  origem?: string | null;
  numero?: string | null;
  versao?: number | null;
  arquivado_em?: string | null;
  substituido_por?: string | null;
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: "Rascunho", cls: "bg-muted text-muted-foreground" },
  sent: { label: "Aguardando cliente", cls: "bg-warning/15 text-warning" },
  signed: { label: "Em revisão", cls: "bg-primary/15 text-primary" },
  completed: { label: "Assinado", cls: "bg-success/15 text-success" },
  cancelled: { label: "Cancelado", cls: "bg-muted text-muted-foreground" },
  substituido: { label: "Substituído", cls: "bg-muted text-muted-foreground" },
};
const META_ARQUIVADO = { label: "Arquivado", cls: "bg-muted text-muted-foreground" };

// UXS (30/09): a lista abre como fila de trabalho ("Em andamento"); o histórico fica a um clique.
const FILTROS_DE_STATUS = [
  { valor: "andamento", rotulo: "Em andamento" },
  { valor: "encerrados", rotulo: "Encerrados" },
  { valor: "todos", rotulo: "Todos" },
  { valor: "draft", rotulo: "Rascunho" },
  { valor: "sent", rotulo: "Aguardando cliente" },
  { valor: "signed", rotulo: "Em revisão" },
  { valor: "completed", rotulo: "Assinado" },
  { valor: "cancelled", rotulo: "Cancelado" },
  { valor: "substituido", rotulo: "Substituído" },
];

/**
 * Em andamento: rascunho, aguardando cliente, em revisão e assinado, sem
 * arquivar e sem versão nova. Status desconhecido fica à vista (na dúvida,
 * mostra). Encerrados é o complemento exato.
 */
function emAndamento(c: Contract): boolean {
  return !c.arquivado_em && !c.substituido_por && c.status !== "cancelled" && c.status !== "substituido";
}

function noFiltro(c: Contract, filtro: string): boolean {
  if (filtro === "todos") return true;
  if (filtro === "andamento") return emAndamento(c);
  if (filtro === "encerrados") return !emAndamento(c);
  return c.status === filtro;
}

const UUID_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizar(v: string) {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

const nomeDe = (cl: any) => String((cl && (cl.company_name || cl.full_name)) || "");

export default function AdminContracts({ clientId: lockedClientId }: { clientId?: string } = {}) {
  const { user, profile } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { data: clients = [] } = useClients();
  const isAdminOrStaff = profile?.role === "admin" || ["design", "traffic", "manager"].includes(profile?.role || "");
  const canManageContracts =
    profile?.role === "admin" || profile?.role === "manager";
  const canDeleteContracts = profile?.role === "admin";

  // "Novo contrato" do agente Aceleriq chega com ?novo=1&client=<id>.
  // Frente CON: ?client=<id> filtra e abre o agente; ?contrato=<id> abre o contrato; ?proposta=<id> gera da proposta aceita.
  const [params, setParams] = useSearchParams();
  const [novoAberto, setNovoAberto] = useState(params.get("novo") === "1");
  const [uploadOpen, setUploadOpen] = useState(false);
  const clienteDoLink = params.get("client") || "";
  const contratoAberto = !lockedClientId && UUID_VALIDO.test(params.get("contrato") || "") ? String(params.get("contrato")) : null;
  const vistaModelos = !lockedClientId && params.get("vista") === "modelos";
  const clienteFiltro = lockedClientId || (UUID_VALIDO.test(clienteDoLink) ? clienteDoLink : "");
  const [signOpen, setSignOpen] = useState<Contract | null>(null);
  // UXS: Enviar/Reenviar do PDF abre a janela de envio (copiar, WhatsApp ou e-mail) em vez de mandar o e-mail num clique.
  const [envioAberto, setEnvioAberto] = useState<Contract | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Contract | null>(null);
  // Filtro e busca lembrados ao sair e voltar (por cliente quando a lista está travada num cliente).
  const escopo = lockedClientId || "todos";
  const [filtroStatus, setFiltroStatus] = useEstadoDaTela(`contratos:status:${escopo}`, "andamento", {
    validar: (v) => typeof v === "string" && FILTROS_DE_STATUS.some((f) => f.valor === v),
  });
  const [busca, setBusca] = useEstadoDaTela(`contratos:busca:${escopo}`, "", { validar: (v) => typeof v === "string" });

  const mudar = (mudancas: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.keys(mudancas).forEach((k) => {
      const v = mudancas[k];
      if (v) next.set(k, v);
      else next.delete(k);
    });
    setParams(next);
  };

  const { data: contracts = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["contracts", user?.id, lockedClientId || "all"],
    queryFn: async () => {
      let q = supabase.from("contracts").select(COLUNAS_DA_LISTA).order("created_at", { ascending: false });
      if (lockedClientId) q = q.eq("client_id", lockedClientId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as Contract[];
    },
    enabled: !!user,
    // 60 s e releitura ao voltar à aba: as ações da tela já invalidam a lista.
    ...AO_VIVO_CALMO,
  });

  // Um mapa em vez de procurar o cliente na lista a cada linha, a cada render.
  const clientesPorId = useMemo(() => new Map((clients as any[]).map((c) => [String(c.id), c] as [string, any])), [clients]);
  const clientById = (id: string) => clientesPorId.get(String(id));
  const listaDeClientes = useMemo(
    () => (clients as any[]).map((c) => ({ id: String(c.id), nome: String(c.company_name || c.full_name || "Cliente") })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")),
    [clients],
  );
  const aberto = contratoAberto ? contracts.find((c) => c.id === contratoAberto) || null : null;
  const clienteDoAgente = clienteFiltro || (aberto ? aberto.client_id : "");

  // Proposta aceita (frente PRO) vira rascunho: ?proposta=<id>. Uma vez por endereço.
  const propostaPedida = useRef<string | null>(null);
  useEffect(() => {
    const proposta = params.get("proposta") || "";
    if (!UUID_VALIDO.test(proposta) || propostaPedida.current === proposta || !canManageContracts) return;
    propostaPedida.current = proposta;
    chamarContratos("gerar_do_aceite", { proposta_id: proposta })
      .then((p: any) => {
        void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
        mudar({ proposta: null, client: p.contrato.client_id, contrato: p.contrato.id });
        avisar.success(p.ja_existia ? "Esta proposta já tinha contrato" : "Rascunho gerado da proposta aceita", { description: p.pergunta || undefined });
      })
      .catch((e) => avisar.error("O contrato não foi gerado da proposta", { description: textoDoErro(e) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, canManageContracts]);

  const handleDelete = async () => {
    if (!confirmDelete) return;
    if (
      !canDeleteContracts
      || confirmDelete.status !== "draft"
      || confirmDelete.admin_signed_at
      || confirmDelete.sent_at
      || confirmDelete.client_signed_at
    ) {
      toast({
        title: "Contrato protegido",
        description: "Somente rascunhos ainda não assinados podem ser excluídos.",
        variant: "destructive",
      });
      setConfirmDelete(null);
      return;
    }
    const storageRef = storageRefFromFile({
      fileUrl: confirmDelete.original_file_url,
    });
    const { error } = await supabase.from("contracts").delete().eq("id", confirmDelete.id);
    if (error) toast({ title: "Erro ao excluir", description: error.message, variant: "destructive" });
    else {
      let storageError: string | null = null;
      if (storageRef) {
        const { error: removeError } = await supabase.storage
          .from(storageRef.bucket)
          .remove([storageRef.path]);
        storageError = removeError?.message || null;
      }
      toast({
        title: storageError
          ? "Contrato removido; arquivo pendente de limpeza"
          : "Contrato removido",
        description: storageError || undefined,
        variant: storageError ? "destructive" : "default",
      });
      qc.invalidateQueries({ queryKey: ["contracts"] });
    }
    setConfirmDelete(null);
  };

  const abrirContrato = async (c: Contract) => {
    // Contrato de modelo abre por dentro (documento, dados, versões e trilha).
    if (c.origem === "modelo") {
      // Dentro de Arquivos do cliente: troca de tela sem recarregar o painel (o Voltar do navegador volta aos Arquivos).
      if (lockedClientId) navigate(`/contratos?client=${c.client_id}&contrato=${c.id}`);
      else mudar({ contrato: c.id });
      return;
    }
    try {
      const url = await resolveFileUrl({ fileUrl: c.original_file_url });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast({
        title: "Não foi possível abrir o contrato",
        description: error?.message,
        variant: "destructive",
      });
    }
  };

  if (!isAdminOrStaff) {
    return (
      <div className="min-w-0 space-y-4">
        <CabecalhoDePagina titulo="Contratos" descricao="Área restrita à equipe" />
      </div>
    );
  }

  const termo = normalizar(busca);
  const doCliente = clienteFiltro ? contracts.filter((c) => c.client_id === clienteFiltro) : contracts;
  const contagem: Record<string, number> = {};
  let andamento = 0;
  for (const c of doCliente) {
    contagem[c.status] = (contagem[c.status] || 0) + 1;
    if (emAndamento(c)) andamento += 1;
  }
  const encerrados = doCliente.length - andamento;
  const naBusca = (c: Contract) => {
    if (!termo) return true;
    const cl = clientById(c.client_id);
    return normalizar([c.title, c.description, c.numero, cl?.full_name, cl?.company_name, c.original_file_name].filter(Boolean).join(" ")).indexOf(termo) >= 0;
  };
  const filtrados = doCliente.filter((c) => noFiltro(c, filtroStatus) && naBusca(c));
  // A busca não esconde contrato: no padrão, os encerrados que batem com o termo ficam a um clique.
  const encerradosNaBusca = filtroStatus === "andamento" ? doCliente.filter((c) => !emAndamento(c) && naBusca(c)).length : 0;
  const aguardandoAssinatura = doCliente.filter((c) => !c.admin_signed_at && c.status === "draft").length;
  const filtrando = filtroStatus !== "andamento" || !!termo;
  const limparFiltros = () => {
    setBusca("");
    // Volta ao padrão; sem nada em andamento, mostra todos (nunca uma lista vazia de novo).
    setFiltroStatus(andamento > 0 ? "andamento" : "todos");
  };
  const verEncerrados = (qual: "encerrados" | "todos") => (
    <button type="button" onClick={() => setFiltroStatus(qual)} className={botao.discreto}>
      {qual === "encerrados" ? `Ver encerrados (${encerradosNaBusca})` : "Ver"}
    </button>
  );

  const lista: ReactNode = isError ? (
    <EstadoDeErro
      titulo="Não foi possível carregar os contratos."
      acao={
        <button type="button" onClick={() => refetch()} className={botao.secundario}>
          Tentar de novo
        </button>
      }
    />
  ) : isLoading && contracts.length === 0 ? (
    <Carregando rotulo="Carregando contratos" linhas={4} />
  ) : doCliente.length === 0 ? (
    <EstadoVazio
      icone={<FileSignature className="h-5 w-5" />}
      titulo="Nenhum contrato ainda"
      descricao="Monte o primeiro pelo modelo."
      acao={
        canManageContracts ? (
          <button type="button" onClick={() => setNovoAberto(true)} className={botao.secundario}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" /> Novo contrato
          </button>
        ) : undefined
      }
    />
  ) : filtrados.length === 0 && filtroStatus === "andamento" && encerradosNaBusca > 0 ? (
    <EstadoVazio compacto titulo={termo ? "Nenhum contrato em andamento com esse termo." : "Nenhum contrato em andamento."} acao={verEncerrados("encerrados")} />
  ) : filtrados.length === 0 ? (
    <EstadoVazio
      compacto
      titulo="Nenhum contrato nesse filtro."
      acao={
        <button type="button" onClick={limparFiltros} className={botao.discreto}>
          Limpar filtros
        </button>
      }
    />
  ) : (
    <div className="min-w-0 space-y-2">
      <Painel semEspaco>
        <ul className="divide-y divide-border">
          {filtrados.map((c) => {
            const client = clientById(c.client_id);
            const arquivado = c.status === "completed" && !!c.arquivado_em;
            const meta = arquivado ? META_ARQUIVADO : STATUS_META[c.status] || STATUS_META.draft;
            const modelo = c.origem === "modelo";
            const versao = Number(c.versao) || 1;
            const podeExcluir = !modelo && canDeleteContracts && c.status === "draft" && !c.admin_signed_at && !c.sent_at && !c.client_signed_at;
            const IconeDeAbrir = modelo ? ChevronRight : ExternalLink;
            return (
              <li key={c.id} className="flex min-w-0 items-center pr-3 sm:pr-4">
                {/* A linha inteira abre o contrato (UXS), com o mesmo recuo e altura de antes (o respiro da linha passou para o botão). Fora da ordem do Tab: o teclado usa o "Abrir" ao lado. */}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => void abrirContrato(c)}
                  className={juntar(toqueCompacto, "min-w-0 flex-1 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none sm:px-4")}
                  data-linha-do-contrato=""
                >
                  <span className="flex min-w-0 items-center">
                    <FileSignature className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    <span className="block min-w-0 truncate text-[13px] font-medium leading-5 text-foreground">{c.title}</span>
                    <span className={juntar(etiqueta, "ml-2 hidden sm:inline-flex", meta.cls)}>{meta.label}</span>
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-1 block truncate sm:pl-6")}>
                    <span className="sm:hidden">{meta.label} · </span>
                    {client?.full_name || "-"}
                    {client?.company_name ? ` · ${client.company_name}` : ""}
                    {modelo && c.numero ? ` · ${c.numero}${versao > 1 ? ` v${versao}` : ""}` : ""}
                    {` · ${new Date(c.created_at).toLocaleDateString("pt-BR")}`}
                  </span>
                  {!modelo && (
                    <span className="mt-1 flex min-w-0 flex-wrap items-center text-[12px] sm:pl-6 [&>*]:mr-3">
                      {c.admin_signed_at ? (
                        <span className="inline-flex items-center text-success">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Admin assinou
                        </span>
                      ) : (
                        <span className="inline-flex items-center text-muted-foreground">
                          <Clock className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Aguarda sua assinatura
                        </span>
                      )}
                      {c.client_signed_at ? (
                        <span className="inline-flex items-center text-success">
                          <CheckCircle2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Cliente assinou
                        </span>
                      ) : c.sent_at ? (
                        <span className="inline-flex items-center text-warning">
                          <Mail className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Enviado, aguardando cliente
                        </span>
                      ) : null}
                    </span>
                  )}
                </button>
                <div className="flex shrink-0 items-center [&>*+*]:ml-1.5 sm:[&>*+*]:ml-2">
                  <button type="button" onClick={() => void abrirContrato(c)} className={botao.secundario} aria-label={`Abrir ${c.title}`}>
                    <IconeDeAbrir className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                    <span className="hidden sm:inline">Abrir</span>
                  </button>
                  {!modelo && canManageContracts && !c.admin_signed_at && (
                    <button type="button" onClick={() => setSignOpen(c)} className={juntar(botao.secundario, "border-primary/50 text-primary hover:bg-primary/10")}>
                      <FileSignature className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                      <span className="hidden sm:inline">Assinar</span>
                      <span className="sr-only sm:hidden">Assinar {c.title}</span>
                    </button>
                  )}
                  {!modelo && canManageContracts && c.admin_signed_at && !c.client_signed_at && ["draft", "sent"].indexOf(c.status) >= 0 && (
                    <button type="button" onClick={() => setEnvioAberto(c)} className={botao.secundario}>
                      <Send className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                      <span className="hidden sm:inline">{c.sent_at ? "Reenviar" : "Enviar"}</span>
                      <span className="sr-only sm:hidden">{c.sent_at ? "Reenviar" : "Enviar"} {c.title}</span>
                    </button>
                  )}
                  {podeExcluir && (
                    <button type="button" onClick={() => setConfirmDelete(c)} className={juntar(botao.icone, "hover:text-destructive")} aria-label={`Excluir ${c.title}`}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Painel>
      {termo && encerradosNaBusca > 0 && (
        <p className={juntar(texto.auxiliar, "flex min-w-0 items-center")} data-encerrados-na-busca="">
          <span className="min-w-0 truncate">
            {encerradosNaBusca} {encerradosNaBusca === 1 ? "encerrado" : "encerrados"} com esse termo
          </span>
          <span className="ml-1 shrink-0">{verEncerrados("todos")}</span>
        </p>
      )}
    </div>
  );

  const principal: ReactNode = vistaModelos ? (
    <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo os modelos" />}>
      <EditorDeModelos aoVoltar={() => mudar({ vista: null })} />
    </Suspense>
  ) : contratoAberto ? (
    <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo o contrato" />}>
      <DetalheDoContrato
        key={contratoAberto}
        contratoId={contratoAberto}
        aoVoltar={() => mudar({ contrato: null })}
        aoAbrir={(id) => mudar({ contrato: id })}
        nomeDoCliente={aberto ? nomeDe(clientById(aberto.client_id)) : ""}
        emailDoCliente={(() => {
          const cl = aberto ? clientById(aberto.client_id) : null;
          return cl ? (cl.email ? String(cl.email) : null) : undefined;
        })()}
      />
    </Suspense>
  ) : (
    <div className="min-w-0 space-y-4">
      {/* Esqueleto no lugar do painel enquanto a lista e o painel chegam: a lista não pula para baixo. */}
      {!lockedClientId && isLoading && contracts.length === 0 && <EsqueletoDoPainel />}
      {!lockedClientId && contracts.length > 0 && (
        <Suspense fallback={<EsqueletoDoPainel />}>
          <PainelDosContratos
            clientId={clienteFiltro || null}
            nomeDoCliente={(id) => nomeDe(clientById(id))}
            aoAbrir={(id, cliente) => mudar({ contrato: id, client: cliente })}
          />
        </Suspense>
      )}
      {lista}
    </div>
  );

  // Lateral sem cliente: escolher ali mesmo (mesmo ?client do filtro do topo). Com contrato aberto ainda sem dono conhecido, esqueleto (nada de trocar de cliente com o contrato na tela).
  const lateralSemCliente: ReactNode = contratoAberto && (isLoading || isError) ? (
    <div aria-busy="true" aria-label="Abrindo o agente" className="h-full min-h-[320px] animate-pulse rounded-lg bg-muted" />
  ) : (
    <EstadoVazio
      compacto
      icone={<FileSignature className="h-5 w-5" />}
      titulo="Escolha um cliente"
      descricao="O agente monta o contrato dele."
      acao={
        !contratoAberto && listaDeClientes.length > 0 ? (
          <SeletorCompacto
            modo="lista"
            rotulo="Escolher cliente"
            valor=""
            opcoes={listaDeClientes.map((c) => ({ valor: c.id, rotulo: c.nome }))}
            onEscolher={(v) => mudar({ client: v })}
          />
        ) : undefined
      }
    />
  );

  const envioCliente = envioAberto ? clientById(envioAberto.client_id) : null;

  return (
    <div className="min-w-0 space-y-4">
      <CabecalhoDePagina
        titulo="Contratos"
        nivel={lockedClientId ? 2 : 1}
        descricao={
          doCliente.length === 0
            ? undefined
            : filtrando
              ? `${filtrados.length} de ${doCliente.length}`
              : [
                  `${andamento} em andamento`,
                  encerrados ? `${encerrados} ${encerrados === 1 ? "encerrado" : "encerrados"}` : null,
                  aguardandoAssinatura ? `${aguardandoAssinatura} em rascunho` : null,
                ].filter(Boolean).join(" · ")
        }
        ajuda="Monte o contrato pelo modelo (condições gerais e um anexo por serviço), confira em Dados o que falta, assine pela agência e envie o link. O agente ao lado monta pelo que você descrever. Contrato já pronto em PDF sobe pelo menu: depois de subir, a assinatura e o envio abrem em seguida. A lista mostra o que está em andamento; os encerrados ficam no filtro."
        acoes={
          canManageContracts ? (
            <div className="flex items-center [&>*+*]:ml-1.5">
              <button type="button" onClick={() => setNovoAberto(true)} className={botao.primario} aria-label="Novo contrato">
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span className="ml-1.5 hidden sm:inline">Novo contrato</span>
              </button>
              <MenuMais
                itens={[
                  { rotulo: "Subir PDF pronto", icone: <Upload className="h-4 w-4" />, aoEscolher: () => setUploadOpen(true) },
                  !lockedClientId && { rotulo: "Modelos e biblioteca", icone: <BookOpen className="h-4 w-4" />, aoEscolher: () => mudar({ vista: "modelos", contrato: null }) },
                ]}
              />
            </div>
          ) : undefined
        }
      />

      {contracts.length > 0 && !contratoAberto && !vistaModelos && (
        <div className="-m-1 flex flex-wrap items-center [&>*]:m-1">
          <CampoDeBusca
            valor={busca}
            onMudar={setBusca}
            placeholder="Buscar por título, número ou cliente"
            rotulo="Buscar contrato"
            className="flex-1 basis-full sm:basis-[240px]"
          />
          {!lockedClientId && (
            <SeletorCompacto
              rotulo="Cliente"
              opcoes={[{ valor: "todos", rotulo: "Todos os clientes" }].concat(listaDeClientes.map((c) => ({ valor: c.id, rotulo: c.nome })))}
              valor={clienteFiltro || "todos"}
              onEscolher={(v) => mudar({ client: v === "todos" ? null : v })}
              modo="lista"
            />
          )}
          <SeletorCompacto
            rotulo="Status do contrato"
            opcoes={FILTROS_DE_STATUS.map((f) => ({
              ...f,
              contador: f.valor === "todos" ? doCliente.length : f.valor === "andamento" ? andamento : f.valor === "encerrados" ? encerrados : contagem[f.valor] || 0,
            }))}
            valor={filtroStatus}
            onEscolher={setFiltroStatus}
          />
        </div>
      )}

      {lockedClientId ? (
        lista
      ) : (
        <AreaDeTrabalho
          memoria="contratos"
          memoriaDaRolagem={vistaModelos ? "contratos:modelos" : contratoAberto ? `contratos:${contratoAberto}` : "contratos:lista"}
          rotuloDoPrincipal={vistaModelos ? "Modelos de contrato" : contratoAberto ? "Contrato aberto" : "Lista de contratos"}
          rotuloDaLateral="Agente de contratos"
          iconeDaLateral={<FileSignature className="h-4 w-4" />}
          lateral={
            clienteDoAgente ? (
              <Suspense fallback={<div aria-busy="true" aria-label="Abrindo o agente" className="h-full min-h-[320px] animate-pulse rounded-lg bg-muted" />}>
                <AgenteDeContratos key={clienteDoAgente} clientId={clienteDoAgente} contratoId={contratoAberto} aoAbrirContrato={(id) => mudar({ contrato: id, client: clienteDoAgente })} />
              </Suspense>
            ) : (
              lateralSemCliente
            )
          }
        >
          {principal}
        </AreaDeTrabalho>
      )}

      {novoAberto && (
        <Suspense fallback={null}>
          <NovoContrato
            aberto={novoAberto}
            aoFechar={() => setNovoAberto(false)}
            clientes={lockedClientId ? listaDeClientes.filter((c) => c.id === lockedClientId) : listaDeClientes}
            clienteInicial={lockedClientId || clienteDoLink || null}
            aoCriar={(p) => {
              setNovoAberto(false);
              void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
              qc.setQueryData(CHAVES_DOS_CONTRATOS.um(p.contrato.id), p);
              if (lockedClientId) navigate(`/contratos?client=${p.contrato.client_id}&contrato=${p.contrato.id}`);
              else mudar({ client: p.contrato.client_id, contrato: p.contrato.id, novo: null });
            }}
          />
        </Suspense>
      )}

      {/* PDF pronto (UXS): subir, assinar e enviar num caminho só. Quem fechar no meio continua com Assinar e Enviar na linha. */}
      <UploadContractDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        clients={clients}
        lockedClientId={lockedClientId}
        clienteInicial={clienteFiltro}
        onCreated={(novo) => {
          void qc.invalidateQueries({ queryKey: ["contracts"] });
          setUploadOpen(false);
          setSignOpen(novo);
        }}
      />

      <AdminSignDialog
        contract={signOpen}
        onClose={() => setSignOpen(null)}
        onSigned={(assinado) => {
          void qc.invalidateQueries({ queryKey: ["contracts"] });
          setSignOpen(null);
          setEnvioAberto(assinado);
        }}
        adminName={profile?.full_name || ""}
      />

      {envioAberto && (
        <Suspense fallback={null}>
          <EnvioDoContratoDeArquivo
            contrato={envioAberto}
            nomeDoCliente={nomeDe(envioCliente)}
            emailDoCliente={envioCliente && envioCliente.email ? String(envioCliente.email) : null}
            aoFechar={() => setEnvioAberto(null)}
            aoEnviado={() => void qc.invalidateQueries({ queryKey: ["contracts"] })}
          />
        </Suspense>
      )}

      <ConfirmModal
        open={!!confirmDelete}
        onCancel={() => setConfirmDelete(null)}
        title="Excluir contrato?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function UploadContractDialog({
  open,
  onOpenChange,
  clients,
  onCreated,
  lockedClientId,
  clienteInicial,
}: {
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  clients: any[];
  onCreated: (novo: Contract) => void;
  lockedClientId?: string;
  /** O cliente do filtro (já conferido como id válido). Só entra se estiver na lista. */
  clienteInicial: string;
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [clientId, setClientId] = useState(lockedClientId || "");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const preenchido = useRef(false);
  const naLista = (id: string) => !!id && clients.some((c: any) => String(c.id) === id);

  // Ao abrir: tudo limpo e o cliente do contexto já escolhido.
  useEffect(() => {
    if (!open) return;
    setTitle("");
    setDescription("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
    const inicial = lockedClientId || (naLista(clienteInicial) ? clienteInicial : "");
    setClientId(inicial);
    preenchido.current = !!inicial;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  // A lista de clientes chegou depois de abrir: preenche uma vez só (não desfaz a escolha da pessoa).
  useEffect(() => {
    if (!open || preenchido.current || lockedClientId || !naLista(clienteInicial)) return;
    preenchido.current = true;
    setClientId((atual) => atual || clienteInicial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, clients, clienteInicial, lockedClientId]);

  const escolherArquivo = (f: File | null) => {
    setFile(f);
    // O nome do arquivo sugere o título, sem apagar o que a pessoa digitou.
    if (f && !title.trim()) setTitle(f.name.replace(/\.pdf$/i, "").trim());
  };

  const pronto = !!file && !!clientId && !!title.trim();

  const handleSubmit = async () => {
    if (!file || !clientId || !title.trim()) return;
    setUploading(true);
    try {
      const ext = file.name.split(".").pop();
      const path = `contracts/${clientId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("files").upload(path, file, {
        cacheControl: "3600", upsert: false,
      });
      if (upErr) throw upErr;
      const { data: novo, error: insErr } = await supabase
        .from("contracts")
        .insert({
          client_id: clientId,
          title: title.trim(),
          description: description || null,
          original_file_url: `files://${path}`,
          original_file_name: file.name,
          status: "draft",
          created_by: user?.id,
        })
        .select(COLUNAS_DA_LISTA)
        .single();
      if (insErr || !novo) {
        const { error: cleanupError } = await supabase.storage
          .from("files")
          .remove([path]);
        const motivo = insErr ? insErr.message : "O contrato não foi criado.";
        if (cleanupError) {
          throw new Error(
            `${motivo}. O arquivo enviado também ficou pendente de limpeza: ${cleanupError.message}`,
          );
        }
        throw insErr || new Error(motivo);
      }

      toast({ title: "Contrato criado" });
      onCreated(novo as unknown as Contract);
    } catch (e: any) {
      toast({ title: "Erro", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Subir contrato em PDF</DialogTitle>
          <DialogDescription>Suba o PDF e escolha o cliente.</DialogDescription>
        </DialogHeader>
        <GrupoDeCampos colunas={1}>
          <CampoDeFormulario
            rotulo="Arquivo PDF"
            obrigatorio
            apoio={file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB` : undefined}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".pdf"
              onChange={(e) => escolherArquivo(e.target.files?.[0] || null)}
              className="block w-full min-w-0 text-[13px] text-muted-foreground file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-muted file:px-3 file:text-[13px] file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Título" obrigatorio>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Contrato de prestação de serviços 2026" className={campo} />
          </CampoDeFormulario>
          {!lockedClientId && (
            <CampoDeFormulario rotulo="Cliente" obrigatorio>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} className={campo}>
                <option value="">Selecione o cliente</option>
                {clients.map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name} {c.company_name ? `· ${c.company_name}` : ""}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo="Descrição" apoio="Opcional.">
            <textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Resumo do escopo..." className={juntar(campoTexto, "min-h-[64px]")} />
          </CampoDeFormulario>
        </GrupoDeCampos>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={() => onOpenChange(false)}>Cancelar</button>
          <button
            type="button"
            className={botao.primario}
            onClick={handleSubmit}
            disabled={uploading || !pronto}
            title={pronto ? undefined : "Escolha o arquivo, o título e o cliente"}
          >
            {uploading ? "Enviando..." : "Criar contrato"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AdminSignDialog({ contract, onClose, onSigned, adminName }: { contract: Contract | null; onClose: () => void; onSigned: (assinado: Contract) => void; adminName: string }) {
  const { toast } = useToast();
  const [signName, setSignName] = useState(adminName);
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const id = contract ? contract.id : null;

  // A janela nunca desmonta: a cada contrato, o aceite volta a desmarcado e o nome ao do perfil.
  useEffect(() => {
    if (!id) return;
    setAccept(false);
    setSignName(adminName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  // O perfil chegou depois de abrir: o nome entra se o campo estiver vazio.
  useEffect(() => {
    if (id && adminName) setSignName((atual) => atual || adminName);
  }, [id, adminName]);

  if (!contract) return null;

  const handleSign = async () => {
    if (!signName.trim() || !accept) return;
    setLoading(true);
    const agora = new Date().toISOString();
    const { data, error } = await supabase
      .from("contracts")
      .update({
        admin_signature_name: signName.trim(),
        admin_signed_at: agora,
        admin_signature_ip: "portal",
        status: "sent",
      })
      .eq("id", contract.id)
      .select(COLUNAS_DA_LISTA)
      .maybeSingle();
    setLoading(false);
    if (error) toast({ title: "Erro", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Assinatura registrada" });
      onSigned(data ? (data as unknown as Contract) : { ...contract, admin_signed_at: agora, status: "sent" });
    }
  };

  return (
    <Dialog open={!!contract} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Assinar contrato</DialogTitle>
          <DialogDescription>Revise o documento e assine digitalmente.</DialogDescription>
        </DialogHeader>
        <div className="min-w-0 space-y-4">
          <PrivateContractFrame contract={contract} />
          <div className="space-y-3 border-t border-border pt-4">
            <CampoDeFormulario rotulo="Seu nome completo" obrigatorio apoio="Como deve aparecer na assinatura.">
              <input value={signName} onChange={(e) => setSignName(e.target.value)} className={campo} autoComplete="name" />
            </CampoDeFormulario>
            <div className="flex items-start">
              <Checkbox id="admin-accept" checked={accept} onCheckedChange={(v) => setAccept(!!v)} className={juntar(toqueCompacto, "mr-2 mt-0.5")} />
              <label htmlFor="admin-accept" className={juntar(texto.corpo, "cursor-pointer")}>
                Li o contrato na íntegra e, ao assinar digitalmente, declaro que estou ciente e de acordo com todos os termos descritos.
              </label>
            </div>
          </div>
        </div>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={onClose}>Cancelar</button>
          <button type="button" onClick={handleSign} disabled={loading || !accept || !signName.trim()} className={botao.primario}>
            <FileSignature className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {loading ? "Assinando..." : "Assinar contrato"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrivateContractFrame({ contract }: { contract: Contract }) {
  const { url, loading, error } = useResolvedFileUrl({
    fileUrl: contract.original_file_url,
    expiresIn: 15 * 60,
  });
  // Abaixo de 640 px o iframe não é montado (no iPhone mostra só a primeira página); o link abre o PDF inteiro.
  const pdfNaPagina = useLarguraMinima(640);

  if (loading) {
    return <div className={juntar("w-full animate-pulse rounded-md bg-muted", pdfNaPagina ? "h-[50vh] max-h-[400px]" : "h-9")} aria-busy="true" aria-label="Carregando contrato" />;
  }

  if (error || !url) {
    return <EstadoDeErro titulo="Não foi possível carregar o contrato." />;
  }

  return (
    <div className="min-w-0 space-y-3">
      <a href={url} target="_blank" rel="noopener noreferrer" className={botao.secundario}>
        <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir o contrato completo (PDF)
      </a>
      {pdfNaPagina && (
        <iframe
          src={`${url}#toolbar=1&view=FitH`}
          className="h-[50vh] max-h-[400px] w-full rounded-md border border-border bg-white"
          title={contract.title}
        />
      )}
    </div>
  );
}
