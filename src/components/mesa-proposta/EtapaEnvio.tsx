import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Archive, Copy, CopyPlus, ExternalLink, FileSignature, LayoutTemplate, Mail, MessageCircle, Send, Undo2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useConfirm } from "@/components/shared/confirmDialog";
import Secao from "@/components/sistema/Secao";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import MenuMais from "@/components/sistema/MenuMais";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { assuntoDoEmail, dataCurta, mensagemDoWhatsApp, textoDoEmail, textoDoTotal } from "../../../supabase/functions/_shared/proposta-modelo";
import { aplicarNaLista, chamarProposta, gerarContratoDoAceite, linkPublico, resumoDoRastreio, tempoLegivel, useContatoDaProposta, useEventos, type Proposta } from "./propostaApi";
import SeloDaProposta from "./SeloDaProposta";
import AvisoDaAgencia from "./AvisoDaAgencia";
import DuplicarProposta from "./DuplicarProposta";
import FollowupDaProposta from "./FollowupDaProposta";
import SalvarComoModelo from "./SalvarComoModelo";
import { useResolverPendencia } from "./navegacaoDaProposta";
import { normalizarPagamento, ROTULO_DO_NIVEL, ROTULO_DO_PAGAMENTO, ehNivel } from "../../../supabase/functions/_shared/proposta-comercial";

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
 */

const NOME_DO_EVENTO: Record<string, string> = {
  criada: "Criada",
  gerada: "Escrita pelo estrategista",
  pesquisada: "Mercado pesquisado",
  editada: "Editada depois do envio",
  revisada: "Revisada",
  enviada: "Link gerado",
  email_enviado: "E-mail enviado",
  aberta: "Aberta pelo cliente",
  aceita: "Aceita",
  recusada: "Recusada",
  expirada: "Expirou",
  arquivada: "Arquivada",
  restaurada: "Versão restaurada",
  contrato_pedido: "Contrato pedido",
  contrato_pendente: "Contrato aguardando a mesa de contratos",
  duplicada: "Criada como cópia",
  followup: "Follow-up feito",
  pacotes_montados: "Pacotes montados",
  anexo: "Anexo",
  preenchida: "Prévia do preenchimento",
};

async function copiar(t: string, rotulo: string) {
  try {
    await navigator.clipboard.writeText(t);
    toast.success(`${rotulo} copiado.`);
  } catch {
    toast.error("Não deu para copiar. Selecione e copie à mão.");
  }
}

type Preparado = { whatsapp?: { texto: string; numero: string }; email?: { para: string; texto?: string } };

export default function EtapaEnvio({ proposta, onAbrir }: { proposta: Proposta | null; onAbrir?: (id: string) => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const confirmar = useConfirm();
  const resolver = useResolverPendencia(proposta);
  const eventos = useEventos(proposta ? proposta.id : null);
  // Com link (fora de rascunho), o contato vem da função: a mesma regra do enviar (lead, depois a ficha).
  const contato = useContatoDaProposta(proposta ? proposta.id : null, !!proposta && proposta.status !== "rascunho");
  const [enviando, setEnviando] = useState(false);
  const [preparado, setPreparado] = useState<Preparado | null>(null);
  const [para, setPara] = useState("");
  // A mensagem editada vale enquanto a base (proposta, link e contato) for a mesma.
  const [editada, setEditada] = useState<{ origem: string; texto: string } | null>(null);
  const [mandandoEmail, setMandandoEmail] = useState(false);
  const [gerandoContrato, setGerandoContrato] = useState(false);
  const [duplicando, setDuplicando] = useState(false);
  const [modelo, setModelo] = useState(false);

  if (!proposta) return <EstadoVazio titulo="Nenhuma proposta aberta." descricao="Crie ou abra uma no Contexto." />;
  const bloqueios = proposta.pendencias.filter((p) => p.bloqueia);
  const link = linkPublico(proposta.status !== "rascunho" ? proposta.token : null);
  const lendoEventos = eventos.isLoading;
  const erroNosEventos = eventos.isError && !eventos.data;
  const r = resumoDoRastreio(eventos.data || []);
  const opcaoAceita = proposta.pagamento_aceito ? normalizarPagamento(proposta.pagamento).opcoes.find((o) => o.id === proposta.pagamento_aceito) : null;
  const formaAceita = opcaoAceita ? ROTULO_DO_PAGAMENTO[opcaoAceita.tipo] : null;
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
      toast.success("Link pronto. Mande pelo WhatsApp ou por e-mail.");
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

  const mudarStatus = async (status: "recusada" | "rascunho") => {
    const ok = await confirmar(
      status === "recusada"
        ? { title: "Marcar como recusada?", description: "O link deixa de aceitar. Fica registrado no lead.", confirmLabel: "Marcar recusada", destructive: true }
        : { title: "Voltar para rascunho?", description: "O link atual deixa de valer. Para o cliente ver de novo, confirme um novo envio.", confirmLabel: "Voltar para rascunho" },
    );
    if (!ok) return;
    try {
      const d = await chamarProposta<any>("status_mudar", { proposta_id: proposta.id, status });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    } catch (e) {
      avisarErro(e, "O status não mudou");
    }
  };

  const gerarContrato = async () => {
    const ok = await confirmar({ title: "Gerar o contrato desta proposta?", description: "O contrato nasce em rascunho na mesa de contratos, com os valores e os itens aceitos. Nada vai ao cliente sem você.", confirmLabel: "Gerar contrato" });
    if (!ok) return;
    setGerandoContrato(true);
    try {
      const r = await gerarContratoDoAceite(proposta.id);
      void qc.invalidateQueries({ queryKey: ["mesa-proposta", "eventos", proposta.id] });
      toast.success(r.jaExistia ? "O contrato desta proposta já existia." : "Contrato em rascunho. Abra em Contratos.", { description: r.pergunta || undefined });
    } catch (e) {
      avisarErro(e, "O contrato não foi gerado");
    } finally {
      setGerandoContrato(false);
    }
  };

  const arquivar = async () => {
    try {
      const d = await chamarProposta<any>("arquivar", { proposta_id: proposta.id, arquivar: !proposta.arquivada_em });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
    } catch (e) {
      avisarErro(e, "Não foi possível arquivar");
    }
  };

  const aceite = {
    rotulo: "Aceite",
    valor: proposta.aceite && proposta.aceite.nome ? (ehNivel(proposta.pacote_aceito) ? proposta.pacotes.nomes[proposta.pacote_aceito] || ROTULO_DO_NIVEL[proposta.pacote_aceito] : "Aceita") : "Não",
    apoio: proposta.aceite && proposta.aceite.nome ? `${proposta.aceite.nome}${proposta.aceita_em ? `, ${dataCurta(proposta.aceita_em.slice(0, 10))}` : ""}${formaAceita ? `, ${formaAceita}` : ""}` : undefined,
  };

  return (
    <div className="min-w-0 space-y-6" data-etapa-proposta="envio">
      <Secao
        titulo="Envio"
        recolher={false}
        descricao={
          <span className="inline-flex items-center">
            <SeloDaProposta status={proposta.status_efetivo} />
            <span className="ml-2">
              {textoDoTotal(proposta.totais)} · até {dataCurta(proposta.validade_ate) || "sem data"}
            </span>
          </span>
        }
        ajuda="Confirmar gera o link público e congela o texto enviado. Mudar a proposta depois volta para rascunho: o link antigo para de aceitar e é preciso confirmar de novo. O menu tem Duplicar, Salvar como modelo e Arquivar."
        acao={
          <>
            <MenuMais
              itens={[
                proposta.status !== "rascunho" && proposta.status !== "aceita" ? { rotulo: "Voltar para rascunho", icone: <Undo2 className="h-4 w-4" />, aoEscolher: () => void mudarStatus("rascunho") } : null,
                { rotulo: "Duplicar", icone: <CopyPlus className="h-4 w-4" />, aoEscolher: () => setDuplicando(true) },
                { rotulo: "Salvar como modelo", icone: <LayoutTemplate className="h-4 w-4" />, aoEscolher: () => setModelo(true) },
                { rotulo: proposta.arquivada_em ? "Desarquivar" : "Arquivar", icone: <Archive className="h-4 w-4" />, aoEscolher: () => void arquivar() },
                proposta.status !== "aceita" && proposta.status !== "recusada" ? { rotulo: "Marcar recusada", icone: <XCircle className="h-4 w-4" />, perigo: true, aoEscolher: () => void mudarStatus("recusada") } : null,
              ]}
            />
            {proposta.status === "aceita" ? (
              <button type="button" className={botao.primario} onClick={() => void gerarContrato()} disabled={gerandoContrato}>
                <FileSignature className="mr-1.5 h-4 w-4" />
                {gerandoContrato ? "Gerando..." : "Gerar contrato"}
              </button>
            ) : (
              <button type="button" className={botao.primario} onClick={() => void enviar()} disabled={enviando || bloqueios.length > 0 || !!proposta.arquivada_em}>
                <Send className="mr-1.5 h-4 w-4" />
                {enviando ? "Preparando..." : proposta.status === "rascunho" ? "Enviar" : "Enviar de novo"}
              </button>
            )}
          </>
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

      <FollowupDaProposta proposta={proposta} />

      {/* Rastreio: nada de número falso enquanto lê; o aceite vem da proposta (já lida) e fica sempre à vista. */}
      <Secao titulo="Rastreio" divisoria descricao={lendoEventos || erroNosEventos ? undefined : r.ultima ? `Última abertura ${dataCurta(r.ultima.slice(0, 10))}` : "Ainda não aberta"}>
        <FaixaDeNumeros
          colunas={erroNosEventos ? 1 : 3}
          semMoldura
          itens={
            erroNosEventos
              ? [aceite]
              : [
                  { rotulo: "Aberturas", valor: lendoEventos ? "..." : String(r.aberturas) },
                  { rotulo: "Tempo de leitura", valor: lendoEventos ? "..." : tempoLegivel(r.segundos), apoio: !lendoEventos && r.maior ? `maior: ${tempoLegivel(r.maior)}` : undefined },
                  aceite,
                ]
          }
        />
        {lendoEventos ? (
          <Carregando forma="lista" linhas={3} rotulo="Lendo o rastreio" className="mt-4" />
        ) : erroNosEventos ? (
          <EstadoDeErro
            className="mt-4"
            titulo="O rastreio não foi lido agora."
            acao={
              <button type="button" className={botao.secundario} onClick={() => void eventos.refetch()}>
                Tentar de novo
              </button>
            }
          />
        ) : (
          (eventos.data || []).length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria, "mt-4")} aria-label="Linha do tempo da proposta">
              {(eventos.data || []).slice(0, 30).map((e) => (
                <li key={e.id} className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                    {NOME_DO_EVENTO[e.tipo] || e.tipo}
                    {e.tipo === "aberta" && e.segundos ? ` · ${tempoLegivel(e.segundos)}` : ""}
                  </span>
                  <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{new Date(e.criado_em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                </li>
              ))}
            </ul>
          )
        )}
      </Secao>
      {duplicando && <DuplicarProposta proposta={proposta} aberta={duplicando} onAberta={setDuplicando} onAbrir={onAbrir} />}
      {modelo && <SalvarComoModelo proposta={proposta} aberta={modelo} onAberta={setModelo} />}
    </div>
  );
}
