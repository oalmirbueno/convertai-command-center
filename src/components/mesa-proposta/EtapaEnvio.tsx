import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, Copy, ExternalLink, Mail, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useConfirm } from "@/components/shared/confirmDialog";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { assuntoDoEmail, dataCurta, mensagemDoWhatsApp, textoDoEmail, textoDoTotal } from "../../../supabase/functions/_shared/proposta-modelo";
import { aplicarNaLista, chamarProposta, linkPublico, useContatoDaProposta, type Proposta } from "./propostaApi";
import SeloDaProposta from "./SeloDaProposta";
import AvisoDaAgencia from "./AvisoDaAgencia";
import { useIrParaEtapa, useResolverPendencia } from "./navegacaoDaProposta";
import ProximoPasso from "./ProximoPasso";

/**
 * Etapa 4, Envio: o Confirmar gera o link público (token), congela o texto
 * enviado (hash) e marca enviada; nada vai ao cliente sozinho. Daí: copiar o
 * link, abrir o WhatsApp com a mensagem pronta (quem manda é a pessoa) e o
 * e-mail pelo Resend (outro Confirmar). Embaixo, o rastreio: aberturas,
 * tempo de leitura, aceite (nome, e-mail, data) e a linha do tempo.
 *
 * Frente UXS (30/09): o contato do cliente (nome, WhatsApp e e-mail) vem da
 * função a qualquer momento, não só logo depois do Confirmar: gerar o link
 * hoje e mandar amanhã já sai com o número e o nome. A mensagem do WhatsApp
 * dá para editar. Cada bloqueio tem "Resolver". "Salvar como modelo" mora
 * no menu desta seção. O rastreio não mostra número falso enquanto lê.
 *
 * Frente PRS (30/09): esta etapa ficou só com o envio (gerar o link e mandar
 * pelo WhatsApp ou por e-mail). O que vem depois (aberturas, follow-up,
 * aceite, contrato e a linha do tempo) mora no Acompanhar
 * (EtapaAcompanhar.tsx); Duplicar, Salvar como modelo, Arquivar, Voltar para
 * rascunho e Marcar recusada, no "..." da proposta na casca.
 */

async function copiar(t: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(t);
    toast.success(`${rotulo} copiado.`);
  } catch {
    toast.error("Não deu para copiar. Selecione e copie à mão.");
  }
}

type Preparado = { whatsapp?: { texto: string; numero: string }; email?: { para: string; texto?: string } };

export default function EtapaEnvio({ proposta }: { proposta: Proposta | null }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmar = useConfirm();
  const resolver = useResolverPendencia(proposta);
  const irPara = useIrParaEtapa();
  // Com link (fora de rascunho), o contato vem da função: a mesma regra do enviar (lead, depois a ficha).
  const contato = useContatoDaProposta(proposta ? proposta.id : null, !!proposta && proposta.status !== "rascunho");
  const [enviando, setEnviando] = useState(false);
  const [preparado, setPreparado] = useState<Preparado | null>(null);
  const [para, setPara] = useState("");
  // A mensagem editada vale enquanto a base (proposta, link e contato) for a mesma.
  const [editada, setEditada] = useState<{ origem: string; texto: string } | null>(null);
  const [mandandoEmail, setMandandoEmail] = useState(false);

  if (!proposta) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma pelo seletor da proposta." />;
  const bloqueios = proposta.pendencias.filter((p) => p.bloqueia);
  const link = linkPublico(proposta.status !== "rascunho" ? proposta.token : null);
  // Ordem: a resposta do enviar, depois o contato lido, depois vazio (nunca inventa nome nem número).
  const doBanco = contato.data || null;
  const nomeDoContato = doBanco ? doBanco.nome : "";
  const mensagemBase = link ? (preparado && preparado.whatsapp ? preparado.whatsapp.texto : mensagemDoWhatsApp({ contato: nomeDoContato, titulo: proposta.titulo, link, validade: proposta.validade_ate })) : "";
  const mensagem = editada && editada.origem === mensagemBase ? editada.texto : mensagemBase;
  const numeroDoWhats = (preparado && preparado.whatsapp && preparado.whatsapp.numero) || (doBanco ? doBanco.numero : "") || "";
  const emailPara = para || (preparado && preparado.email && preparado.email.para) || (doBanco ? doBanco.email : "") || "";
  const textoDoEmailPronto = link ? (preparado && preparado.email && preparado.email.texto) || textoDoEmail({ contato: nomeDoContato, titulo: proposta.titulo, link, validade: proposta.validade_ate }) : "";

  const enviar = async () => {
    const ok = await confirmar({
      title: proposta.status === "rascunho" ? "Gerar o link e marcar como enviada?" : "Atualizar o envio?",
      description: `Proposta ${proposta.numero}, ${textoDoTotal(proposta.totais)}, válida até ${dataCurta(proposta.validade_ate)}. Nada vai ao cliente sem você mandar o link.`,
      confirmLabel: "Confirmar envio",
    });
    if (!ok) return;
    setEnviando(true);
    try {
      const d = await chamarProposta<any>("enviar", { proposta_id: proposta.id });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      setPreparado({ whatsapp: d && d.whatsapp, email: d && d.email });
      if (d && d.email && d.email.para && !para) setPara(String(d.email.para));
      toast.success("Link pronto. Mande pelo WhatsApp ou por e-mail.", { action: { label: "Acompanhar", onClick: () => irPara("acompanhar") } });
    } catch (e) {
      avisarErro(e, "O envio não foi preparado");
    } finally {
      setEnviando(false);
    }
  };

  const mandarEmail = async () => {
    const ok = await confirmar({ title: `Mandar a proposta para ${emailPara}?`, description: "O e-mail sai agora, pelo endereço de propostas da Aceleriq.", confirmLabel: "Mandar e-mail" });
    if (!ok) return;
    setMandandoEmail(true);
    try {
      await chamarProposta("enviar_email", { proposta_id: proposta.id, para: emailPara });
      void qc.invalidateQueries({ queryKey: ["mesa-proposta", "eventos", proposta.id] });
      toast.success("E-mail enviado.");
    } catch (e) {
      avisarErro(e, "O e-mail não saiu");
    } finally {
      setMandandoEmail(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="envio">
      <Secao
        titulo="Enviar"
        recolher={false}
        descricao={
          <span className="inline-flex items-center">
            <SeloDaProposta status={proposta.status_efetivo} />
            <span className="ml-2">
              {textoDoTotal(proposta.totais)} · até {dataCurta(proposta.validade_ate) || "sem data"}
            </span>
          </span>
        }
        ajuda="Enviar gera o link público (com Confirmar antes) e congela o texto enviado. Nada vai ao cliente sozinho: você manda o link pelo WhatsApp ou pelo e-mail daqui. Mudar a proposta depois volta para rascunho: o link antigo para de aceitar e é preciso enviar de novo. Duplicar, Salvar como modelo e Arquivar ficam no ... ao lado do seletor da proposta."
        acao={
          proposta.status === "aceita" ? (
            <button type="button" className={botao.secundario} onClick={() => irPara("acompanhar")}>
              Ver o aceite
              <ArrowRight className="ml-1.5 h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || bloqueios.length > 0 || !!proposta.arquivada_em}>
              <Send className="mr-1.5 h-4 w-4" />
              {enviando ? "Preparando..." : proposta.status === "rascunho" ? "Enviar" : "Enviar de novo"}
            </button>
          )
        }
      >
        <AvisoDaAgencia />
        {bloqueios.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="O que falta para enviar">
            {bloqueios.map((b) => (
              <li key={b.chave} className={lista.linha}>
                <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{b.texto}</span>
                {resolver && (
                  <button type="button" className={juntar(botao.discreto, "ml-2 h-8 px-2 text-[12px]")} onClick={() => resolver(b.chave)} aria-label={`Resolver: ${b.texto}`}>
                    Resolver
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {proposta.status === "aceita" && (
          <p className={juntar(texto.corpo, "mb-3 flex items-center")}>
            <CheckCircle2 className="mr-2 h-4 w-4 text-success" aria-hidden="true" /> Aceita. O contrato e o aceite estão em Acompanhar.
          </p>
        )}
        {link ? (
          <div className="min-w-0 space-y-4">
            <div className="flex min-w-0 items-center">
              <input readOnly value={link} className={juntar(campo, "mr-2")} aria-label="Link da proposta" onFocus={(e) => e.currentTarget.select()} />
              <button type="button" className={botao.icone} aria-label="Copiar o link" onClick={() => void copiar(link, "Link")}>
                <Copy className="h-4 w-4" />
              </button>
              <a href={link} target="_blank" rel="noopener noreferrer" className={botao.icone} aria-label="Abrir a página da proposta (dá para baixar o PDF lá)">
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <CampoDeFormulario rotulo="Mensagem do WhatsApp">
                <textarea value={mensagem} onChange={(e) => setEditada({ origem: mensagemBase, texto: e.target.value })} className={juntar(campoTexto, "min-h-[120px]")} maxLength={2000} />
              </CampoDeFormulario>
              <div className="min-w-0 space-y-3">
                <CampoDeFormulario rotulo="E-mail do cliente">
                  <input type="email" value={emailPara} onChange={(e) => setPara(e.target.value)} className={campo} placeholder="cliente@empresa.com" />
                </CampoDeFormulario>
                <p className={juntar(texto.auxiliar, "truncate")}>Assunto: {assuntoDoEmail(proposta)}</p>
              </div>
            </div>
            <div className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
              <button type="button" className={botao.secundario} onClick={() => void copiar(mensagem, "Mensagem")}>
                <Copy className="mr-1.5 h-4 w-4" /> Copiar mensagem
              </button>
              <a className={botao.secundario} href={`https://wa.me/${numeroDoWhats}?text=${encodeURIComponent(mensagem)}`} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="mr-1.5 h-4 w-4" /> Abrir no WhatsApp
              </a>
              <button type="button" className={botao.secundario} onClick={() => void copiar(textoDoEmailPronto, "Texto do e-mail")}>
                <Copy className="mr-1.5 h-4 w-4" /> Copiar e-mail
              </button>
              <button type="button" className={botao.secundario} onClick={() => void mandarEmail()} disabled={mandandoEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(emailPara)}>
                <Mail className="mr-1.5 h-4 w-4" /> {mandandoEmail ? "Mandando..." : "Mandar e-mail"}
              </button>
            </div>
          </div>
        ) : (
          !bloqueios.length && <p className={texto.auxiliar}>Confirme o envio para gerar o link.</p>
        )}
      </Secao>

      {link && <ProximoPasso etapa="envio" estado="Depois de mandar, acompanhe as aberturas e o aceite" />}
    </div>
  );
}
