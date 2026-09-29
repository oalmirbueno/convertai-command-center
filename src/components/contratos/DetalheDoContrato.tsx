import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeft, Download, FileSignature, Send } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { CabecalhoDeSecao } from "@/components/sistema/Secao";
import Etapas from "@/components/sistema/Etapas";
import MenuMais from "@/components/sistema/MenuMais";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type PayloadDoContrato } from "@/lib/contratos/api";
import DocumentoDoContrato from "./DocumentoDoContrato";
import { ClausulasDoContrato, DadosDoContrato, JanelaDeAssinar, JanelaDeEnvio, TrilhaDoContrato, VersoesDoContrato } from "./PartesDoContrato";
import { mensagensProntas, nomeDoArquivoDoContrato, STATUS_DO_CONTRATO } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * O contrato de modelo aberto em /contratos?client=<id>&contrato=<id>
 * (frente CON, 30/09). Documento (prévia HTML ou o congelado com o código),
 * dados, cláusulas, versões e trilha. Ações: congelar e assinar pela agência,
 * enviar (mensagem pronta, a pessoa envia), nova versão (o link anterior
 * deixa de valer), cancelar (arquivar) e baixar o PDF.
 */

const PARTES = [
  { valor: "documento", rotulo: "Documento" },
  { valor: "dados", rotulo: "Dados" },
  { valor: "clausulas", rotulo: "Cláusulas" },
  { valor: "versoes", rotulo: "Versões" },
  { valor: "trilha", rotulo: "Trilha" },
];

const COR_DO_STATUS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-warning/15 text-warning",
  completed: "bg-success/15 text-success",
  cancelled: "bg-muted text-muted-foreground",
  substituido: "bg-muted text-muted-foreground",
};

function baixar(bytes: Uint8Array, nome: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function DetalheDoContrato({ contratoId, aoVoltar, aoAbrir, nomeDoCliente }: { contratoId: string; aoVoltar: () => void; aoAbrir: (id: string) => void; nomeDoCliente: string }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [parte, setParte] = useEstadoDaTela<string>(`contratos:parte:${contratoId}`, "documento", { validar: (v) => typeof v === "string" && PARTES.some((p) => p.valor === v) });
  const [assinando, setAssinando] = useState(false);
  const [envio, setEnvio] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.um(contratoId), queryFn: () => chamarContratos("ler", { contract_id: contratoId }) });
  const p = consulta.data;

  const aplicar = (novo: PayloadDoContrato) => {
    qc.setQueryData(CHAVES_DOS_CONTRATOS.um(novo.contrato.id), novo);
    void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
    void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.diff(novo.contrato.id) });
  };

  if (consulta.isLoading) return <Carregando forma="aba" rotulo="Abrindo o contrato" />;
  if (consulta.isError || !p) {
    return (
      <EstadoDeErro
        titulo={textoDoErro(consulta.error, "Não foi possível abrir o contrato.")}
        acao={
          <button type="button" className={botao.secundario} onClick={() => consulta.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  }

  const c = p.contrato;
  const rascunho = c.status === "draft" && !c.congelado_em;
  const enviado = c.status === "sent";
  const assinado = c.status === "completed";
  const encerrado = c.status === "cancelled" || c.status === "substituido";
  const faltam = p.montado ? p.montado.faltando.length : 0;
  const numerosAlterados = p.montado ? p.montado.clausulas.filter((x) => x.alterada).map((x) => x.numero.replace(/\.$/, "")) : [];
  const link = c.sign_url || (enviado ? `${window.location.origin}/contrato/${c.sign_token}` : null);
  const mensagens = p.mensagens || (enviado && c.documento_hash && link ? mensagensProntas({ cliente: nomeDoCliente || "cliente", titulo: c.title, link, hash: c.documento_hash, agencia: "Aceleriq" }) : null);

  const baixarPrevia = async () => {
    if (!p.texto) return;
    try {
      const { gerarPdfDoContrato } = await import("../../../supabase/functions/_shared/pdf-contrato");
      baixar(gerarPdfDoContrato({ texto: p.texto, numero: c.numero || "", versao: c.versao }), nomeDoArquivoDoContrato(`${c.numero || ""}-previa`, nomeDoCliente, c.versao));
    } catch (e) {
      toast.error("A prévia não foi gerada", { description: textoDoErro(e) });
    }
  };
  const abrirPdf = async () => {
    try {
      const r = await chamarContratos<{ url: string }>("pdf_link", { contract_id: c.id });
      window.open(r.url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error("O PDF não abriu", { description: textoDoErro(e) });
    }
  };
  const novaVersao = async () => {
    setOcupado(true);
    try {
      const novo = await chamarContratos("nova_versao", { contract_id: c.id });
      aplicar(novo);
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
      toast.success(`Versão ${novo.contrato.versao} criada`, { description: enviado ? "O link da versão anterior deixou de valer." : undefined });
      aoAbrir(novo.contrato.id);
    } catch (e) {
      toast.error("A versão nova não foi criada", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  const cancelar = async () => {
    setCancelando(false);
    try {
      await chamarContratos<{ resultado: unknown }>("cancelar", { contract_id: c.id });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
      toast.success(assinado ? "Contrato arquivado" : "Contrato cancelado", { description: enviado ? "O link de assinatura deixou de valer." : undefined });
    } catch (e) {
      toast.error("Não foi possível", { description: textoDoErro(e) });
    }
  };

  const estado = [
    c.numero,
    `versão ${c.versao}`,
    STATUS_DO_CONTRATO[c.status] || c.status,
    rascunho && faltam ? `${faltam} ${faltam === 1 ? "campo falta" : "campos faltam"}` : null,
    c.documento_hash ? `código ${c.documento_hash.slice(0, 12)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="min-w-0 space-y-5" data-detalhe-do-contrato={c.id}>
      <div className="flex min-w-0 items-center">
        <button type="button" onClick={aoVoltar} className={juntar(botao.icone, "mr-1")} aria-label="Voltar para a lista">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <CabecalhoDeSecao
          className="min-w-0 flex-1"
          titulo={c.title}
          descricao={estado}
          ajuda={`Modelo ${p.revisao_juridica || "sem revisão registrada"}. Só a equipe vê esta marca; o cliente nunca. O rascunho muda à vontade; ao congelar, o texto ganha um código SHA-256 e qualquer mudança depois vira versão nova, com link novo.`}
          acao={
            <div className="flex min-w-0 items-center [&>*+*]:ml-1.5">
              <span className={juntar(etiqueta, "hidden sm:inline-flex", COR_DO_STATUS[c.status] || COR_DO_STATUS.draft)}>{STATUS_DO_CONTRATO[c.status] || c.status}</span>
              {rascunho && (
                <button type="button" className={botao.primario} disabled={!p.pode_congelar.pode || !p.agencia.completa} title={p.pode_congelar.motivo || undefined} onClick={() => setAssinando(true)}>
                  <FileSignature className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Congelar e assinar</span>
                </button>
              )}
              {enviado && (
                <button type="button" className={botao.primario} onClick={() => setEnvio(true)}>
                  <Send className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{c.sent_at ? "Reenviar" : "Enviar"}</span>
                </button>
              )}
              {(enviado || assinado) && (
                <button type="button" className={botao.secundario} onClick={() => void abrirPdf()} aria-label="Abrir o PDF">
                  <Download className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
                  <span className="hidden sm:inline">{assinado ? "PDF assinado" : "PDF"}</span>
                </button>
              )}
              <MenuMais
                itens={[
                  rascunho && { rotulo: "Baixar prévia em PDF", aoEscolher: () => void baixarPrevia() },
                  (enviado || assinado) && { rotulo: assinado ? "Versão nova (aditivo)" : "Versão nova", aoEscolher: () => void novaVersao(), desativado: ocupado },
                  !!c.substituido_por && { rotulo: "Abrir a versão nova", aoEscolher: () => aoAbrir(String(c.substituido_por)) },
                  !encerrado && !c.arquivado_em && { rotulo: assinado ? "Arquivar" : "Cancelar contrato", aoEscolher: () => setCancelando(true), perigo: true, separadorAntes: true },
                ]}
              />
            </div>
          }
        />
      </div>

      {!p.agencia.completa && rascunho && (
        <p className={juntar(texto.corpo, "flex min-w-0 items-start text-warning")} role="alert" data-agencia-incompleta="">
          <AlertTriangle className="mr-1.5 mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            Sem os dados da agência o contrato não é gerado. Falta: {p.agencia.faltando.join(", ")}.{" "}
            <Link to="/config" className="underline">
              Preencher
            </Link>
          </span>
        </p>
      )}
      {c.status === "substituido" && <p className={juntar(texto.auxiliar, "text-warning")}>Esta versão foi substituída; o link dela não vale mais.</p>}

      <Etapas
        rotulo="Partes do contrato"
        itens={PARTES.map((x) => ({ ...x, contador: x.valor === "dados" && rascunho ? faltam || null : null }))}
        valor={parte}
        onEscolher={setParte}
      />

      {parte === "documento" && (p.texto ? <DocumentoDoContrato texto={p.texto} hash={c.documento_hash} alteradas={numerosAlterados} /> : <EstadoDeErro titulo="Contrato de arquivo: abra o PDF pela lista." />)}
      {parte === "dados" && <DadosDoContrato p={p} editavel={rascunho} aoMudar={aplicar} />}
      {parte === "clausulas" && <ClausulasDoContrato p={p} editavel={rascunho} aoMudar={aplicar} />}
      {parte === "versoes" && <VersoesDoContrato p={p} aoAbrir={aoAbrir} />}
      {parte === "trilha" && <TrilhaDoContrato p={p} />}

      <JanelaDeAssinar
        aberta={assinando}
        aoFechar={() => setAssinando(false)}
        p={p}
        nomeInicial={profile?.full_name || ""}
        aoAssinar={(novo) => {
          aplicar(novo);
          setAssinando(false);
          setEnvio(true);
          toast.success("Contrato congelado e assinado pela agência", { description: "Agora escolha como enviar ao cliente." });
        }}
      />
      <JanelaDeEnvio
        aberta={envio}
        aoFechar={() => setEnvio(false)}
        p={p}
        mensagens={mensagens}
        link={link}
        aoEnviado={() => {
          void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.um(c.id) });
          void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
        }}
      />
      <ConfirmModal
        open={cancelando}
        onCancel={() => setCancelando(false)}
        title={assinado ? "Arquivar o contrato?" : "Cancelar o contrato?"}
        description={enviado ? "O link de assinatura deixa de valer. O contrato fica arquivado." : "O contrato fica arquivado."}
        confirmLabel={assinado ? "Arquivar" : "Cancelar contrato"}
        onConfirm={() => void cancelar()}
      />
    </div>
  );
}
