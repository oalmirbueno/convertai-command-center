import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, PenLine, Send, Share2, Users } from "lucide-react";
import { toast } from "sonner";
import FilePreviewContent from "@/components/shared/FilePreviewContent";
import { Carregando, JanelaCentral, botao, campoTexto, juntar, superficie, texto } from "@/components/sistema";
import { appPublicUrl } from "@/lib/publicUrl";
import { type DocumentoDaEntrega, type ResultadoDaGeracao, pedidoDoDocumento, ROTULO_DO_STATUS_DO_DOCUMENTO } from "@/lib/documentos/registrarEntrega";
import { copiarTexto } from "@/components/briefing/GerarLinkDoBriefing";
import BotaoDocumentoDaEntrega from "./BotaoDocumentoDaEntrega";
import { linkDoWhatsApp } from "../../../supabase/functions/_shared/briefing-modelos";
import { mensagemDoDocumento } from "../../../supabase/functions/_shared/documento-modelos";

/**
 * "Conferir e mandar" o documento de entrega (frente BRF2, 30/09/2026; uma
 * janela só na frente UXS): o PDF, os avisos da conferência, a mensagem pronta
 * (editável) e o envio pelo fluxo de aprovação que já existe, sempre com
 * Confirmar. Antes eram três lugares (prévia, "Mandar com mensagem" e o "...")
 * com pedaços da mesma tarefa.
 *
 * A ordem certa fica no caminho: primeiro liberar ao cliente (Enviar para
 * aprovação ou Disponibilizar no portal, com o Confirmar de sempre); a janela
 * não fecha e vira "Liberado. Agora mande a mensagem", com o WhatsApp e o
 * Copiar com a mensagem que foi registrada. Aberta de um documento que já
 * está com o cliente, é só para ver e reenviar a mensagem. O painel não manda
 * a mensagem: a equipe manda.
 */

type Modo = "approval" | "client_shared";

export default function EnvioDoDocumento({
  documento,
  aberta,
  aguardandoPdf = false,
  cliente,
  telefone,
  onFechar,
  onLiberar,
  onEditar,
  onGerado,
}: {
  documento: DocumentoDaEntrega | null;
  aberta: boolean;
  /** O PDF acabou de ser gerado e a lista ainda não trouxe o arquivo. */
  aguardandoPdf?: boolean;
  cliente: string;
  telefone?: string | null;
  onFechar: () => void;
  /** O fluxo de liberação da lista (Confirmar e aprovação que já existem). */
  onLiberar: (d: DocumentoDaEntrega, modo: Modo, mensagem: string) => Promise<boolean>;
  onEditar: (d: DocumentoDaEntrega) => void;
  /** Gerar de novo deu certo (a janela segue aberta no documento novo). */
  onGerado: (r: ResultadoDaGeracao) => void;
}) {
  const [aprovar, setAprovar] = useState(true);
  const [grupo, setGrupo] = useState(false);
  const [editada, setEditada] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [liberando, setLiberando] = useState(false);
  // Liberado nesta janela. Não sai do status: o objeto da lista pode demorar a voltar como "em aprovação".
  const [liberadoComo, setLiberadoComo] = useState<Modo | null>(null);
  const id = documento ? documento.id : null;
  // Outro documento ou janela fechada: tudo volta ao começo.
  useEffect(() => {
    setAprovar(true);
    setGrupo(false);
    setEditada(null);
    setCopiado(false);
    setLiberadoComo(null);
  }, [id, aberta]);

  if (!documento) return null;
  const status = documento.status;
  const jaComCliente: Modo | null = liberadoComo || (status === "em_aprovacao" ? "approval" : status === "no_portal" ? "client_shared" : null);
  const podeLiberar = !jaComCliente && status === "gerado" && !!documento.file_id;
  const pedeAprovacao = jaComCliente ? jaComCliente === "approval" : aprovar;
  const pronta = mensagemDoDocumento({
    cliente,
    titulo: documento.titulo || "Registro da entrega",
    numero: documento.numero,
    itens: 0,
    provas: 0,
    url: appPublicUrl("/documentos"),
    grupo,
    aprovar: pedeAprovacao,
  });
  // Reenvio: a mensagem registrada no envio (quando não é o texto do grupo).
  const registrada = !liberadoComo && jaComCliente && !grupo && documento.mensagem_envio ? documento.mensagem_envio : null;
  const mensagem = editada ?? registrada ?? pronta;
  const arquivo = documento.arquivo || null;
  const rotuloDoStatus = liberadoComo ? ROTULO_DO_STATUS_DO_DOCUMENTO[liberadoComo === "approval" ? "em_aprovacao" : "no_portal"] : ROTULO_DO_STATUS_DO_DOCUMENTO[status];

  const copiar = () =>
    void copiarTexto(mensagem).then((ok) => {
      if (!ok) return void toast.error("Não foi possível copiar.");
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    });
  const liberar = async () => {
    const modo: Modo = aprovar ? "approval" : "client_shared";
    setLiberando(true);
    try {
      // O Confirmar continua no liberar() da lista, sempre.
      if (await onLiberar(documento, modo, mensagem)) setLiberadoComo(modo);
    } finally {
      setLiberando(false);
    }
  };

  const botaoCopiar = (variante: keyof typeof botao) => (
    <button type="button" className={botao[variante]} onClick={copiar}>
      {copiado ? <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> : grupo ? <Users className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" />}
      {copiado ? "Copiado" : "Copiar"}
    </button>
  );
  const botaoWhatsApp = (
    <a href={linkDoWhatsApp(mensagem, telefone)} target="_blank" rel="noopener noreferrer" className={botao.primario}>
      <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" />
      WhatsApp
    </a>
  );
  // Um primário: liberar antes; depois, o WhatsApp (ou o Copiar no texto do grupo, que não tem WhatsApp).
  const rodape = podeLiberar ? (
    <>
      {botaoCopiar("discreto")}
      <button type="button" className={botao.primario} disabled={liberando} onClick={() => void liberar()}>
        {aprovar ? <Send className="mr-1.5 h-4 w-4" aria-hidden="true" /> : <Share2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
        {aprovar ? "Enviar para aprovação" : "Disponibilizar no portal"}
      </button>
    </>
  ) : jaComCliente ? (
    grupo ? (
      botaoCopiar("primario")
    ) : (
      <>
        {botaoCopiar("secundario")}
        {botaoWhatsApp}
      </>
    )
  ) : null;

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      titulo={documento.titulo || "Documento da entrega"}
      descricao={`${rotuloDoStatus}${documento.codigo ? ` · código ${documento.codigo}` : ""}`}
      ajuda="Confira o PDF e os avisos (só a equipe vê). Enviar para aprovação, ou Disponibilizar no portal sem pedir aprovação, pede Confirmar e só então o documento vai ao cliente. Depois, mande a mensagem pronta pelo WhatsApp ou copie o texto do grupo: ela pede ao cliente que veja no painel. Editar o rascunho e Gerar de novo ficam logo abaixo do PDF."
      largura="lg"
      corpo="rola"
      rodape={rodape}
      data-conferir-e-mandar=""
    >
      <div className="min-w-0 space-y-5">
        {aguardandoPdf ? (
          <Carregando linhas={3} rotulo="Carregando o PDF" />
        ) : arquivo ? (
          <FilePreviewContent
            fileName={arquivo.file_name}
            fileUrl={arquivo.file_url}
            fileId={arquivo.id}
            storageBucket={arquivo.storage_bucket}
            storagePath={arquivo.storage_path}
            mimeType={arquivo.mime_type}
            extension={arquivo.extension}
          />
        ) : (
          <p className={texto.auxiliar}>O PDF não está mais em Arquivos. Gere de novo.</p>
        )}

        {documento.avisos && documento.avisos.length > 0 && (
          <div className="min-w-0">
            <p className={texto.rotulo}>Avisos da conferência (só a equipe vê)</p>
            <ul className="mt-1 list-disc pl-5">
              {documento.avisos.map((a, i) => <li key={i} className="text-[12px] leading-5 text-muted-foreground">{a}</li>)}
            </ul>
          </div>
        )}

        <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
          <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={() => onEditar(documento)}>
            <PenLine className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {documento.tem_rascunho ? "Editar o rascunho" : "Abrir o rascunho"}
          </button>
          {status === "gerado" && !liberadoComo && (
            <BotaoDocumentoDaEntrega pedido={pedidoDoDocumento(documento)} statusDoDocumento={status} rotulo="Gerar de novo" variante="discreto" className="h-8 px-2 text-[12px]" onGerado={onGerado} />
          )}
        </div>

        {(podeLiberar || jaComCliente) && (
          <div className="min-w-0 border-t border-border pt-4">
            {jaComCliente && (
              <p className={juntar(superficie.poco, texto.corpo, "mb-3 flex items-center px-3 py-2")} role="status">
                <Check className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                {liberadoComo ? "Liberado. Agora mande a mensagem." : "Já está com o cliente. A mensagem pode ser mandada de novo."}
              </p>
            )}
            <div className="-m-1 mb-2 flex flex-wrap">
              {/* Depois de liberado, "Pedir aprovação" some: mexer nela trocaria o texto e ele não bateria com o que foi ao cliente. */}
              {podeLiberar && (
                <label className="m-1 inline-flex items-center text-[13px] text-foreground">
                  <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={aprovar} onChange={(e) => { setAprovar(e.target.checked); setEditada(null); }} />
                  Pedir aprovação
                </label>
              )}
              <label className="m-1 inline-flex items-center text-[13px] text-foreground">
                <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={grupo} onChange={(e) => { setGrupo(e.target.checked); setEditada(null); }} />
                Texto para o grupo
              </label>
            </div>
            <textarea className={juntar(campoTexto, "min-h-[160px]")} value={mensagem} onChange={(e) => setEditada(e.target.value)} aria-label="Mensagem para o cliente" data-mensagem-do-documento="" />
          </div>
        )}
      </div>
    </JanelaCentral>
  );
}
