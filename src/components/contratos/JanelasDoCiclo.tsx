import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, Loader2, Mail, MessageCircle } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { botao, campoTexto, juntar, rolagem, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, type PayloadDoContrato, type RespostaDoLembrete } from "@/lib/contratos/api";
import { ROTULO_DO_SERVICO, SERVICOS_DO_CONTRATO, type ServicoDoContrato } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Janelas do ciclo do contrato (frente CON2, 30/09):
 * - lembrete de assinatura pendente: mensagem pronta para cada pessoa que
 *   falta, com o link dela. Nada é enviado: a pessoa copia ou abre o
 *   WhatsApp, e o uso fica na trilha;
 * - aditivo: o que muda e os serviços que entram (o rascunho nasce com os
 *   dados do contratante do contrato assinado; valor e data a pessoa confere
 *   em Dados).
 */

function copiar(t: string, oQue: string) {
  try {
    void navigator.clipboard.writeText(t);
    toast.success(`${oQue} copiado`);
  } catch {
    toast.error("Não deu para copiar; selecione e copie.");
  }
}

export function JanelaDeLembrete({ aberta, aoFechar, contratoId }: { aberta: boolean; aoFechar: () => void; contratoId: string }) {
  const consulta = useQuery({ queryKey: ["contratos", "lembrete", contratoId], enabled: aberta, queryFn: () => chamarContratos<RespostaDoLembrete>("lembrete", { contract_id: contratoId }), staleTime: 0 });
  const registrar = (canal: string, signatarioId: string | null) => {
    chamarContratos("lembrete_registrar", { contract_id: contratoId, canal, signatario_id: signatarioId || undefined }).catch((e) => toast.error("O lembrete não ficou na trilha", { description: textoDoErro(e) }));
  };
  const d = consulta.data;
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Lembrete de assinatura</DialogTitle>
          <DialogDescription>{d ? `Esperando há ${d.dias} ${d.dias === 1 ? "dia" : "dias"}${d.ultimo_lembrete ? `, último lembrete em ${new Date(d.ultimo_lembrete).toLocaleDateString("pt-BR")}` : ""}.` : "Mensagem pronta para quem falta assinar."}</DialogDescription>
        </DialogHeader>
        <div className={juntar("min-w-0 space-y-5", rolagem.janela)}>
          {consulta.isLoading && <Carregando forma="lista" linhas={2} rotulo="Montando o lembrete" />}
          {consulta.isError && <EstadoDeErro titulo={textoDoErro(consulta.error)} />}
          {d &&
            d.lembretes.map((l) => (
              <div key={l.id || l.link} className="min-w-0 space-y-2">
                <p className={juntar(texto.corpo, "font-medium")}>
                  {l.nome}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{l.papel === "testemunha" ? "testemunha" : "contratante"}{l.email ? ` · ${l.email}` : ""}</span>
                </p>
                <textarea readOnly value={l.mensagens.whatsapp} rows={4} className={campoTexto} aria-label={`Mensagem para ${l.nome}`} />
                <div className="-m-1 flex min-w-0 flex-wrap items-center [&>*]:m-1">
                  <button type="button" className={botao.discreto} onClick={() => { copiar(l.mensagens.whatsapp, "Mensagem"); registrar("copiado", l.id); }}>
                    <Copy className="mr-1.5 h-4 w-4" aria-hidden="true" /> Copiar
                  </button>
                  <button type="button" className={botao.secundario} onClick={() => { window.open(l.mensagens.wa_me, "_blank", "noopener,noreferrer"); registrar("whatsapp", l.id); }}>
                    <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden="true" /> WhatsApp
                  </button>
                  {l.email && (
                    <button type="button" className={botao.secundario} onClick={() => { window.open(`mailto:${encodeURIComponent(l.email)}?subject=${encodeURIComponent(l.mensagens.assunto)}&body=${encodeURIComponent(l.mensagens.email)}`, "_blank"); registrar("email", l.id); }}>
                      <Mail className="mr-1.5 h-4 w-4" aria-hidden="true" /> E-mail
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
        <DialogFooter>
          <button type="button" className={botao.primario} onClick={aoFechar}>
            Fechar
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function JanelaDeAditivo({ aberta, aoFechar, p, aoCriar }: { aberta: boolean; aoFechar: () => void; p: PayloadDoContrato; aoCriar: (novo: PayloadDoContrato) => void }) {
  const [descricao, setDescricao] = useState("");
  const [incluir, setIncluir] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    if (aberta) {
      setDescricao("");
      setIncluir([]);
    }
  }, [aberta]);
  const fora = SERVICOS_DO_CONTRATO.filter((s) => (p.contrato.servicos || []).indexOf(s) < 0);
  const criar = async () => {
    setOcupado(true);
    try {
      const novo = await chamarContratos("aditivo_criar", { contract_id: p.contrato.id, descricao: descricao.trim(), servicos: incluir });
      aoCriar(novo);
      toast.success(`Aditivo ${novo.contrato.numero || ""} em rascunho`, { description: "Confira valor e data em Dados antes de congelar." });
    } catch (e) {
      toast.error("O aditivo não foi criado", { description: textoDoErro(e) });
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Dialog open={aberta} onOpenChange={(o) => !o && aoFechar()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Aditivo ao contrato {p.contrato.numero || ""}</DialogTitle>
          <DialogDescription>Muda escopo, valor ou prazo do contrato assinado. O resto continua valendo.</DialogDescription>
        </DialogHeader>
        <div className={juntar("min-w-0 space-y-4", rolagem.janela)}>
          <CampoDeFormulario rotulo="O que muda" obrigatorio apoio="Com as suas palavras. Valor e datas você confere em Dados.">
            <textarea value={descricao} onChange={(e) => setDescricao(e.target.value)} rows={3} maxLength={2000} className={campoTexto} placeholder="Ex.: inclui 4 reels por mês a partir de novembro" />
          </CampoDeFormulario>
          {fora.length > 0 && (
            <fieldset className="min-w-0">
              <legend className={juntar(texto.rotulo, "mb-2")}>Serviços que entram (viram anexo do aditivo)</legend>
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                {fora.map((s) => (
                  <label key={s} className={juntar(texto.corpo, "flex min-w-0 cursor-pointer items-center")}>
                    <Checkbox checked={incluir.indexOf(s) >= 0} onCheckedChange={(v) => setIncluir((l) => (v ? l.concat([s]) : l.filter((x) => x !== s)))} className="mr-2" />
                    <span className="truncate">{ROTULO_DO_SERVICO[s as ServicoDoContrato]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        <DialogFooter>
          <button type="button" className={botao.secundario} onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void criar()} disabled={ocupado || descricao.trim().length < 10}>
            {ocupado ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Criar rascunho do aditivo
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
