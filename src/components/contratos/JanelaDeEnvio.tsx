import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Copy, Loader2, Mail, MessageCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { EstadoDeErro } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, juntar, rolagem, texto } from "@/components/sistema/estilos";
import { supabase } from "@/integrations/supabase/client";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, copiarTexto, enviarContratoPorEmail, type EventoDoContrato, type Mensagens, type SignatarioNaTela } from "@/lib/contratos/api";
import { mensagensProntas } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Janela de envio do contrato (frente CON; UXS, 30/09): mensagem pronta, a
 * pessoa envia. Serve o contrato de modelo (DetalheDoContrato) e o de PDF
 * (lista de /contratos), com o mesmo desenho:
 * - Copiar mensagem: copia o texto pronto e registra o envio (canal
 *   "copiado"; uma vez por abertura da janela);
 * - Copiar link: só copia (pode ser só para conferir a página);
 * - Abrir no WhatsApp: abre o wa.me e registra o envio;
 * - Enviar por e-mail: a função send-contract-email manda o link ao cliente;
 *   o resultado ("enviado para x") aparece aqui mesmo.
 * Nada sai sem o clique da pessoa.
 */

export type ContratoParaEnvio = { id: string; title: string; sent_at: string | null; documento_hash: string | null };

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Canal do primeiro envio, só quando o evento real está na trilha (sem adivinhar). */
function canalDoPrimeiroEnvio(eventos: EventoDoContrato[] | undefined): string | null {
  const envios = (eventos || []).filter((e) => e.tipo === "mensagem_copiada" || e.tipo === "enviado_email");
  if (!envios.length) return null;
  const primeiro = envios.slice().sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : 0))[0];
  if (primeiro.tipo === "enviado_email") return "email";
  const canal = primeiro.detalhe && typeof primeiro.detalhe.canal === "string" ? primeiro.detalhe.canal : "";
  return canal === "whatsapp" || canal === "copiado" || canal === "email" ? canal : null;
}

/** Estado curto da janela (até 60 caracteres). */
function estadoDoEnvio(enviadoEm: string | null, canal: string | null): string {
  if (!enviadoEm) return "Escolha o canal. Nada sai sem o seu clique.";
  const dia = dataCurta(enviadoEm);
  if (canal === "copiado") return `Mensagem copiada em ${dia}. Nada sai sem o seu clique.`;
  if (canal === "whatsapp") return `Enviado em ${dia} por WhatsApp. Nada sai sem o seu clique.`;
  if (canal === "email") return `Enviado em ${dia} por e-mail. Nada sai sem o seu clique.`;
  return `Enviado em ${dia}. Nada sai sem o seu clique.`;
}

export function JanelaDeEnvio({
  aberta,
  aoFechar,
  contrato,
  mensagens,
  link,
  signatarios,
  eventos,
  emailDoCliente,
  carregandoLink = false,
  erroDoLink = null,
  aoEnviado,
}: {
  aberta: boolean;
  aoFechar: () => void;
  contrato: ContratoParaEnvio;
  mensagens: Mensagens | null;
  link: string | null;
  /** Outras pessoas que assinam (contrato de modelo): cada uma com o link dela. */
  signatarios?: SignatarioNaTela[];
  /** A trilha, para dizer o canal do primeiro envio. */
  eventos?: EventoDoContrato[];
  /** Para quem vai o e-mail. `null`: o cliente não tem e-mail (o botão fica desativado). `undefined`: não se sabe aqui. */
  emailDoCliente?: string | null;
  carregandoLink?: boolean;
  erroDoLink?: string | null;
  aoEnviado: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  // Resultado do e-mail nesta abertura (para quem foi, quando se sabe).
  const [emailEnviado, setEmailEnviado] = useState<{ para: string | null } | null>(null);
  const [envioLocal, setEnvioLocal] = useState<{ em: string; canal: string } | null>(null);
  // Copiar mensagem registra no máximo uma vez por abertura (a trilha não ganha um evento a cada clique).
  const copiouNestaAbertura = useRef(false);
  useEffect(() => {
    copiouNestaAbertura.current = false;
    if (aberta) setEmailEnviado(null);
  }, [aberta]);

  const semEmail = emailDoCliente === null;
  const enviadoEm = contrato.sent_at || (envioLocal ? envioLocal.em : null);
  const canal = contrato.sent_at ? canalDoPrimeiroEnvio(eventos) : envioLocal ? envioLocal.canal : null;
  const marcar = (c: string) => {
    if (!contrato.sent_at && !envioLocal) setEnvioLocal({ em: new Date().toISOString(), canal: c });
    aoEnviado();
  };

  const copiarLink = async () => {
    if (!link) return;
    if (await copiarTexto(link)) toast.success("Link copiado");
    else toast.error("Não deu para copiar; selecione e copie.");
  };
  const copiarMensagem = async () => {
    if (!mensagens) return;
    if (!(await copiarTexto(mensagens.whatsapp))) {
      toast.error("Não deu para copiar; selecione e copie.");
      return;
    }
    toast.success("Mensagem copiada");
    if (copiouNestaAbertura.current) return;
    copiouNestaAbertura.current = true;
    try {
      await chamarContratos("marcar_enviado", { contract_id: contrato.id, canal: "copiado" });
      marcar("copiado");
    } catch (e) {
      copiouNestaAbertura.current = false;
      toast.error("O envio não ficou registrado", { description: textoDoErro(e) });
    }
  };
  const porWhatsapp = async () => {
    if (!mensagens) return;
    window.open(mensagens.wa_me, "_blank", "noopener,noreferrer");
    try {
      await chamarContratos("marcar_enviado", { contract_id: contrato.id, canal: "whatsapp" });
      marcar("whatsapp");
    } catch (e) {
      toast.error("O envio não ficou registrado", { description: textoDoErro(e) });
    }
  };
  const porEmail = async () => {
    setEnviando(true);
    try {
      await enviarContratoPorEmail(contrato.id);
      setEmailEnviado({ para: emailDoCliente || null });
      toast.success(emailDoCliente ? `E-mail enviado para ${emailDoCliente}` : "E-mail enviado ao cliente");
      marcar("email");
    } catch (e) {
      toast.error("O e-mail não foi enviado", { description: textoDoErro(e) });
    } finally {
      setEnviando(false);
    }
  };
  const copiarDoSignatario = async (t: string) => {
    if (await copiarTexto(t)) toast.success("Link copiado");
    else toast.error("Não deu para copiar; selecione e copie.");
  };

  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar para o cliente</DialogTitle>
          <DialogDescription>{estadoDoEnvio(enviadoEm, canal)}</DialogDescription>
        </DialogHeader>
        <div className={juntar("min-w-0 space-y-3", rolagem.janela)} data-janela-de-envio="">
          {carregandoLink && !link && <div className="h-9 w-full animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Carregando o link" />}
          {erroDoLink && !link && <EstadoDeErro titulo={erroDoLink} />}
          {link && (
            <CampoDeFormulario rotulo="Link de assinatura">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={juntar(campo, "font-mono text-[12px]")} />
            </CampoDeFormulario>
          )}
          {mensagens && (
            <CampoDeFormulario rotulo="Mensagem para o WhatsApp">
              <textarea readOnly value={mensagens.whatsapp} rows={4} className={campoTexto} />
            </CampoDeFormulario>
          )}
          {(mensagens || link) && (
            <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
              {mensagens && (
                <button type="button" className={botao.discreto} onClick={() => void copiarMensagem()}>
                  <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar mensagem
                </button>
              )}
              {link && (
                <button type="button" className={botao.discreto} onClick={() => void copiarLink()}>
                  <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar link
                </button>
              )}
            </div>
          )}
          {/* Frente CON2: as outras pessoas que assinam recebem o link delas (a pessoa envia). */}
          {(signatarios || []).filter((s) => !s.principal && s.link && !s.assinado_em).map((s) => {
            const m = mensagensProntas({ cliente: s.nome, titulo: contrato.title, link: String(s.link), hash: String(contrato.documento_hash || ""), agencia: "Aceleriq" });
            return (
              <div key={s.id} className="flex min-w-0 items-center border-t border-border pt-2">
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {s.nome}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{s.papel === "testemunha" ? "testemunha" : "contratante"}</span>
                </span>
                <button type="button" className={botao.barra} onClick={() => void copiarDoSignatario(String(s.link))} aria-label={`Copiar o link de ${s.nome}`}>
                  <Copy className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Link
                </button>
                <button type="button" className={botao.barra} onClick={() => window.open(m.wa_me, "_blank", "noopener,noreferrer")} aria-label={`WhatsApp para ${s.nome}`}>
                  <MessageCircle className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> WhatsApp
                </button>
              </div>
            );
          })}
          {emailEnviado ? (
            <p className={juntar(texto.corpo, "flex min-w-0 items-center text-success")} role="status" data-resultado-do-email="">
              <CheckCircle2 className="mr-1.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 truncate">{emailEnviado.para ? `E-mail enviado para ${emailEnviado.para}.` : "E-mail enviado ao cliente."}</span>
            </p>
          ) : emailDoCliente !== undefined ? (
            <p className={texto.auxiliar} data-email-do-envio="">
              {semEmail ? "O cliente não tem e-mail cadastrado. Use o link ou o WhatsApp." : `O e-mail vai para ${emailDoCliente}.`}
            </p>
          ) : null}
        </div>
        <DialogFooter className="flex-wrap [&>*]:mt-1">
          {mensagens && (
            <button type="button" className={botao.secundario} onClick={() => void porWhatsapp()}>
              <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> Abrir no WhatsApp
            </button>
          )}
          <button type="button" className={botao.primario} onClick={() => void porEmail()} disabled={enviando || semEmail} title={semEmail ? "O cliente não tem e-mail cadastrado" : undefined}>
            {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" />}
            Enviar por e-mail
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Envio do contrato de PDF (a lista de /contratos): busca o link na hora de
 * abrir (a lista não traz o token) e monta a mensagem sem o código, que o PDF
 * enviado não tem.
 */
export function EnvioDoContratoDeArquivo({
  contrato,
  nomeDoCliente,
  emailDoCliente,
  aoFechar,
  aoEnviado,
}: {
  contrato: { id: string; title: string; sent_at: string | null };
  nomeDoCliente: string;
  emailDoCliente: string | null;
  aoFechar: () => void;
  aoEnviado: () => void;
}) {
  const token = useQuery({
    queryKey: ["contratos", "link", contrato.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("contracts").select("sign_token").eq("id", contrato.id).maybeSingle();
      if (error) throw error;
      const t = data && (data as { sign_token?: unknown }).sign_token;
      if (!t) throw new Error("Este contrato não tem link de assinatura.");
      return String(t);
    },
    staleTime: 5 * 60_000,
  });
  const link = token.data ? `${window.location.origin}/contrato/${token.data}` : null;
  const mensagens = link ? mensagensProntas({ cliente: nomeDoCliente || "cliente", titulo: contrato.title, link, hash: "", agencia: "Aceleriq" }) : null;
  return (
    <JanelaDeEnvio
      aberta
      aoFechar={aoFechar}
      contrato={{ id: contrato.id, title: contrato.title, sent_at: contrato.sent_at, documento_hash: null }}
      mensagens={mensagens}
      link={link}
      emailDoCliente={emailDoCliente}
      carregandoLink={token.isLoading}
      erroDoLink={token.isError ? textoDoErro(token.error, "O link de assinatura não carregou.") : null}
      aoEnviado={aoEnviado}
    />
  );
}
