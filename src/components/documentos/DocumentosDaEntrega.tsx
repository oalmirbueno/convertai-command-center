import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, ChevronDown, Eye, FilePlus2, Loader2, PenLine, Send } from "lucide-react";
import { toast } from "sonner";
import { useConfirm } from "@/components/shared/confirmDialog";
import Secao from "@/components/sistema/Secao";
import MenuMais from "@/components/sistema/MenuMais";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import {
  arquivarDocumento,
  lerDocumentosDaEntrega,
  liberarDocumento,
  pedidoDoDocumento,
  ROTULO_DO_STATUS_DO_DOCUMENTO,
  ROTULO_DO_TIPO_DE_ENTREGA,
  type DocumentoDaEntrega,
  type ResultadoDaGeracao,
} from "@/lib/documentos/registrarEntrega";
import BotaoDocumentoDaEntrega from "./BotaoDocumentoDaEntrega";
import EditorDoDocumento from "./EditorDoDocumento";
import NovoDocumento from "./NovoDocumento";
import EnvioDoDocumento from "./EnvioDoDocumento";
import AgendaDeDocumentos from "./AgendaDeDocumentos";

const dataCurta = (iso?: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const TOM: Record<DocumentoDaEntrega["status"], string> = {
  pendente: "bg-muted text-muted-foreground",
  gerado: "bg-muted text-foreground",
  em_aprovacao: "bg-warning/15 text-warning",
  no_portal: "bg-primary/15 text-primary",
};
/** Só na linha do celular (a pastilha longa fica do sm para cima e na janela). */
const STATUS_CURTO: Record<DocumentoDaEntrega["status"], { rotulo: string; cor: string }> = {
  pendente: { rotulo: "Pendente", cor: "text-muted-foreground" },
  gerado: { rotulo: "Gerado", cor: "text-foreground" },
  em_aprovacao: { rotulo: "Em aprovação", cor: "text-warning" },
  no_portal: { rotulo: "No portal", cor: "text-primary" },
};

type Conferir = { id: string; fileId: string | null; reserva: DocumentoDaEntrega | null };

/**
 * Documentos da entrega do cliente, em Arquivos (pasta Entregas): cada linha
 * tem a ação do estado (Pendente: Gerar; Gerado: Mandar; com o cliente: Ver),
 * e "Mandar" abre uma janela só para conferir o PDF e mandar (EnvioDoDocumento),
 * pelo fluxo de aprovação que já existe, sempre com Confirmar. Arquivar é na
 * hora, com Desfazer, e os arquivados ficam em "Arquivados (n)" com
 * Desarquivar. As janelas moram fora da seção: o aviso do rascunho mensal
 * (?documento=) abre o editor mesmo com a seção recolhida.
 */
export default function DocumentosDaEntrega({ clientId, className }: { clientId: string; className?: string }) {
  const confirmar = useConfirm();
  const queryClient = useQueryClient();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const chave = ["documentos-da-entrega", clientId];
  const consulta = useQuery({ queryKey: chave, queryFn: () => lerDocumentosDaEntrega(clientId), enabled: !!clientId, staleTime: 30_000 });
  const docs = consulta.data ? consulta.data.documentos : [];
  const quantosArquivados = consulta.data ? consulta.data.arquivados : null;
  // Arquivados: só lidos quando a pessoa abre a linha "Arquivados (n)".
  const [verArquivados, setVerArquivados] = useState(false);
  const arquivados = useQuery({
    queryKey: ["documentos-da-entrega", clientId, "arquivados"],
    queryFn: () => lerDocumentosDaEntrega(clientId, { arquivados: true }),
    enabled: !!clientId && verArquivados,
  });
  // A chave é prefixo da dos arquivados: recarregar a lista relê as duas.
  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chave });
  // Frente BRF2: rascunho editável, documento novo por modelo, envio com mensagem pronta e agenda mensal.
  const [params, setParams] = useSearchParams();
  const [editor, setEditor] = useState<Parameters<typeof EditorDoDocumento>[0]["alvo"]>(null);
  const [novo, setNovo] = useState(false);
  const [conferir, setConferir] = useState<Conferir | null>(null);
  const perfil = useQuery({
    queryKey: ["documentos-cliente", clientId],
    enabled: !!clientId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("company_name, full_name, phone").eq("id", clientId).maybeSingle();
      const p = data as { company_name?: string | null; full_name?: string | null; phone?: string | null } | null;
      return { nome: (p && (p.company_name || p.full_name)) || "", telefone: (p && p.phone) || null };
    },
  });
  // O aviso do rascunho mensal abre direto o documento (?documento=<id>).
  const documentoDaUrl = params.get("documento");
  useEffect(() => {
    if (!documentoDaUrl) return;
    setEditor({ documentoId: documentoDaUrl, clientId });
    const p = new URLSearchParams(params);
    p.delete("documento");
    setParams(p, { replace: true });
  }, [documentoDaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  const liberar = async (d: DocumentoDaEntrega, modo: "approval" | "client_shared", mensagem?: string): Promise<boolean> => {
    const ok = await confirmar({
      title: modo === "approval" ? "Enviar para a aprovação do cliente?" : "Disponibilizar no portal do cliente?",
      description: modo === "approval"
        ? `O cliente recebe o documento "${d.titulo || "da entrega"}" para aprovar no painel. Confira a prévia antes.`
        : `O documento "${d.titulo || "da entrega"}" aparece no portal do cliente, sem pedir aprovação. Confira a prévia antes.`,
      confirmLabel: "Confirmar",
    });
    if (!ok) return false;
    setOcupado(d.id);
    try {
      await liberarDocumento(d.id, modo, mensagem);
      toast.success(modo === "approval" ? "Enviado para a aprovação do cliente." : "Disponível no portal do cliente.");
      recarregar();
      return true;
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível mandar ao cliente."));
      return false;
    } finally {
      setOcupado(null);
    }
  };

  // Arquivar é na hora, com Desfazer no aviso (apagar = arquivar; o PDF fica em Arquivos).
  const arquivar = async (d: DocumentoDaEntrega, sim = true): Promise<void> => {
    setOcupado(d.id);
    try {
      await arquivarDocumento(d.id, sim);
      recarregar();
      if (sim) toast.success("Arquivado. O PDF continua em Arquivos.", { action: { label: "Desfazer", onClick: () => void arquivar(d, false) } });
      else toast.success("Documento de volta à lista.");
    } catch (e) {
      toast.error(textoDoErro(e, sim ? "Não foi possível arquivar." : "Não foi possível desarquivar."));
    } finally {
      setOcupado(null);
    }
  };

  // Depois de gerar (na linha, no editor ou na janela), a janela de conferir abre no documento gerado.
  const abrirConferir = (r: ResultadoDaGeracao) => {
    setConferir({ id: r.documento.id, fileId: r.file_id || null, reserva: { ...r.documento, file_id: r.file_id || r.documento.file_id } });
    recarregar();
  };
  const daLista = conferir ? docs.find((d) => d.id === conferir.id) || null : null;
  // A lista ainda não trouxe o PDF novo: a janela mostra "Carregando" no lugar do PDF, nunca "não está mais".
  const desatualizado = !!conferir && !!conferir.fileId && (!daLista || daLista.file_id !== conferir.fileId);
  const documentoDaJanela = conferir ? (desatualizado ? conferir.reserva : daLista || conferir.reserva) : null;
  const aguardandoPdf = !!conferir && (desatualizado ? consulta.isFetching : !!daLista && !!daLista.file_id && !daLista.arquivo && consulta.isFetching);
  // Ao fechar, a janela segue com o último documento até sair da tela (fecha suave e o foco volta a quem abriu).
  const ultimoDaJanela = useRef<DocumentoDaEntrega | null>(null);
  if (documentoDaJanela) ultimoDaJanela.current = documentoDaJanela;

  const linha = (d: DocumentoDaEntrega) => {
    const curto = STATUS_CURTO[d.status];
    // Ordem da linha de apoio: o que importa primeiro (status no celular, avisos); se cortar, sai o fim.
    const partes = [
      d.avisos && d.avisos.length ? `${d.avisos.length} ${d.avisos.length === 1 ? "aviso" : "avisos"}` : "",
      d.numero ? `Nº ${String(d.numero).padStart(4, "0")}` : "",
      d.titulo ? ROTULO_DO_TIPO_DE_ENTREGA[d.tipo] : "",
      dataCurta(d.gerado_em || d.criado_em),
    ].filter(Boolean);
    const nome = d.titulo || ROTULO_DO_TIPO_DE_ENTREGA[d.tipo];
    return (
      <li key={d.id} className={lista.linha} data-documento={d.id}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-foreground">{nome}</p>
          <p className={juntar(texto.auxiliar, "truncate")}>
            <span className={juntar("font-medium sm:hidden", curto.cor)}>
              {curto.rotulo}
              {partes.length ? " · " : ""}
            </span>
            {partes.join(" · ")}
          </p>
        </div>
        <span className={juntar(etiqueta, "ml-2 hidden rounded-full px-2 py-0.5 sm:inline-flex", TOM[d.status])}>{ROTULO_DO_STATUS_DO_DOCUMENTO[d.status]}</span>
        {d.status === "pendente" || !d.file_id ? (
          <BotaoDocumentoDaEntrega pedido={pedidoDoDocumento(d)} statusDoDocumento={d.status} rotulo="Gerar" variante="discreto" className="ml-1 h-8" onGerado={abrirConferir} />
        ) : d.status === "gerado" ? (
          <button type="button" className={juntar(botao.discreto, "ml-1 h-8 px-2 text-[12px]")} aria-label={`Mandar ${nome}`} onClick={() => setConferir({ id: d.id, fileId: null, reserva: d })}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Mandar
          </button>
        ) : (
          <button type="button" className={juntar(botao.discreto, "ml-1 h-8 px-2 text-[12px]")} aria-label={`Ver ${nome}`} onClick={() => setConferir({ id: d.id, fileId: null, reserva: d })}>
            <Eye className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Ver
          </button>
        )}
        <MenuMais
          className="ml-1"
          rotulo={`Mais ações de ${d.titulo || "documento"}`}
          itens={[
            { rotulo: d.tem_rascunho ? "Editar o rascunho" : "Abrir o rascunho", icone: <PenLine className="h-4 w-4" />, aoEscolher: () => setEditor({ documentoId: d.id, clientId: d.client_id }) },
            { rotulo: ocupado === d.id ? "Aguarde" : "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar(d), perigo: true, desativado: ocupado === d.id },
          ]}
        />
      </li>
    );
  };

  return (
    <>
      <Secao
        className={className}
        titulo="Documentos da entrega"
        descricao={consulta.isLoading ? "Carregando" : docs.length ? `${docs.length} ${docs.length === 1 ? "documento" : "documentos"}` : "Nenhum ainda"}
        ajuda="O registro de cada entrega grande (mês de pautas, projeto concluído): o que foi feito, com as provas e os números reais, montado só com o que está no painel. Edite o rascunho (modelo, texto por seção, provas na ordem, números com fonte) e gere o PDF: sem custo de IA, ele sai na hora. Mandar abre a janela para conferir o PDF e mandar: Enviar para aprovação pede Confirmar e, depois, a mensagem vai pelo WhatsApp. Gerar fica só para a equipe. Arquivar tem Desfazer, e os arquivados ficam em Arquivados."
        acao={
          <button type="button" onClick={() => setNovo(true)} className={botao.barra}>
            <FilePlus2 className="h-4 w-4" aria-hidden="true" />
            <span className="ml-1.5">Novo</span>
          </button>
        }
      >
        {consulta.isLoading ? (
          <Carregando forma="lista" linhas={2} rotulo="Carregando documentos" />
        ) : consulta.isError ? (
          <EstadoDeErro titulo="Não foi possível ler os documentos." descricao={textoDoErro(consulta.error)} acao={<button type="button" className={botao.secundario} onClick={recarregar}>Tentar de novo</button>} />
        ) : docs.length ? (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Documentos da entrega">
            {docs.map(linha)}
          </ul>
        ) : (
          <EstadoVazio
            compacto
            titulo="Nenhum documento ainda."
            descricao="Ou ligue o documento mensal automático abaixo."
            acao={
              <button type="button" onClick={() => setNovo(true)} className={juntar(botao.secundario, "h-8 text-[12px]")}>
                <FilePlus2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Novo documento
              </button>
            }
          />
        )}

        {/* Arquivados: a volta de quem foi arquivado. Aparece mesmo com a lista ativa vazia. */}
        {!!quantosArquivados && quantosArquivados > 0 && (
          <div className="mt-2 min-w-0">
            <button type="button" onClick={() => setVerArquivados((v) => !v)} aria-expanded={verArquivados} className={juntar(botao.discreto, "-ml-2 h-8 px-2 text-[12px]")}>
              <ChevronDown className={juntar("mr-1 h-4 w-4 transition-transform", verArquivados ? "" : "-rotate-90")} aria-hidden="true" />
              Arquivados ({quantosArquivados})
            </button>
            {verArquivados &&
              (arquivados.isLoading ? (
                <Carregando forma="lista" linhas={1} rotulo="Carregando arquivados" />
              ) : arquivados.isError ? (
                <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(arquivados.error, "Os arquivados não abriram.")}</p>
              ) : (
                <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Documentos arquivados">
                  {(arquivados.data ? arquivados.data.documentos : []).map((d) => (
                    <li key={d.id} className={lista.linha}>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-muted-foreground">{d.titulo || ROTULO_DO_TIPO_DE_ENTREGA[d.tipo]}</p>
                        <p className={juntar(texto.auxiliar, "truncate")}>{[d.numero ? `Nº ${String(d.numero).padStart(4, "0")}` : "", dataCurta(d.gerado_em || d.criado_em)].filter(Boolean).join(" · ")}</p>
                      </div>
                      <button type="button" onClick={() => void arquivar(d, false)} disabled={ocupado === d.id} className={juntar(botao.barra, "ml-2")} aria-label={`Desarquivar ${d.titulo || "documento"}`}>
                        {ocupado === d.id ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArchiveRestore className="h-4 w-4" aria-hidden="true" />}
                        <span className="ml-1.5 hidden sm:inline">Desarquivar</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        )}

        <AgendaDeDocumentos key={clientId} clientId={clientId} />
      </Secao>

      {/* Janelas fora da seção (todas em portal): abrem mesmo com a seção recolhida. */}
      <EnvioDoDocumento
        documento={documentoDaJanela || ultimoDaJanela.current}
        aberta={!!conferir}
        aguardandoPdf={aguardandoPdf}
        cliente={perfil.data ? perfil.data.nome : ""}
        telefone={perfil.data ? perfil.data.telefone : null}
        onFechar={() => setConferir(null)}
        onLiberar={liberar}
        onEditar={(d) => {
          setConferir(null);
          setEditor({ documentoId: d.id, clientId: d.client_id });
        }}
        onGerado={abrirConferir}
      />
      <NovoDocumento
        aberto={novo}
        onFechar={() => setNovo(false)}
        clientId={clientId}
        onComecar={(p) => {
          setNovo(false);
          setEditor(p);
        }}
      />
      <EditorDoDocumento
        aberto={!!editor}
        alvo={editor}
        onFechar={() => {
          setEditor(null);
          recarregar();
        }}
        onGerado={abrirConferir}
      />
    </>
  );
}
