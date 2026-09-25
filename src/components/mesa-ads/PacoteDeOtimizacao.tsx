import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import { chamarAds, chavesAds, formatoDe, rotuloDoObjetivo } from "./adsApi";
import { carregarDadosDoPacote, extrairRetorno, gerarPacoteDeOtimizacao, textoDoArquivoDeRetorno } from "./pacoteOtimizacao";
import { salvarBlob } from "./zipDoGestor";

/**
 * Pacote do agente externo (pedido do dono em 26/09/2026):
 * - "Baixar pacote de otimização (.zip)": prompt completo, dados em CSV,
 *   miniaturas, artes, estratégia e o contrato do retorno. Grátis, no navegador.
 * - "Importar pacote no Estúdio Ads": sobe o .zip ou o .json que o agente
 *   externo devolveu (ou cola o texto); a Mesa Ads mostra o que entendeu,
 *   recusa o que não entende e cria os criativos num plano para o Estúdio Ads.
 */

export function BaixarPacoteDeOtimizacao({ dias, className = "" }: { dias: number; className?: string }) {
  const { clientId, clientName } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [progresso, setProgresso] = useState<string | null>(null);
  const baixar = async () => {
    setProgresso("Lendo a conta e o contexto...");
    try {
      const dados = await carregarDadosDoPacote(queryClient, clientId, clientName, dias);
      const r = await gerarPacoteDeOtimizacao(dados, { aoProgredir: (f, t) => setProgresso(`Baixando imagens ${f} de ${t}...`) });
      salvarBlob(r.nome, r.blob);
      toast.success("Pacote de otimização baixado", {
        description: r.faltando.length ? `${r.imagens} imagens no zip; ${r.faltando.length} não baixaram (listadas no LEIA-ME).` : `${r.imagens} imagens no zip, com o prompt completo e os dados.`,
      });
    } catch (e) {
      avisarErro(e, "Não foi possível montar o pacote");
    } finally {
      setProgresso(null);
    }
  };
  return (
    <span className={`inline-flex min-w-0 flex-wrap items-center ${className}`}>
      <Button type="button" size="sm" variant="outline" className="h-9" disabled={progresso !== null} onClick={() => void baixar()} title="Prompt completo, dados em CSV, miniaturas e artes num .zip para o agente externo. Grátis.">
        {progresso !== null ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
        Baixar pacote de otimização (.zip)
      </Button>
      {progresso && <span className="ml-2 text-[11.5px] text-muted-foreground" role="status">{progresso}</span>}
    </span>
  );
}

type Entendido = {
  plano: { nome: string; objetivo: string | null; resumo: string };
  aceitos: { titulo: string; angulo: string; formato: string; objetivo: string | null; headline_arte: string; texto_principal: string; titulo_anuncio: string; cta_meta: string; avisos: string[] }[];
  recusados: { indice: number; titulo: string; motivos: string[] }[];
  avisos: string[];
};

export function ImportarPacote({ onImportado, className = "" }: { onImportado?: (planoId: string) => void; className?: string }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [criando, setCriando] = useState(false);
  const [pacote, setPacote] = useState<unknown>(null);
  const [entendido, setEntendido] = useState<Entendido | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);

  const limpar = () => {
    setTexto("");
    setPacote(null);
    setEntendido(null);
    setErro(null);
  };

  const ler = async (conteudo: string) => {
    setErro(null);
    setEntendido(null);
    const r = extrairRetorno(conteudo);
    if ("erro" in r) {
      setErro(r.erro);
      return;
    }
    setLendo(true);
    try {
      const data = await chamarAds<any>("pacote_importar", { client_id: clientId, pacote: r.valor, confirmar: false });
      setPacote(r.valor);
      setEntendido((data && data.entendido) || null);
    } catch (e) {
      avisarErro(e, "Não foi possível ler o retorno");
    } finally {
      setLendo(false);
    }
  };

  const escolherArquivo = async (f: File | null) => {
    if (!f) return;
    try {
      const conteudo = await textoDoArquivoDeRetorno(f);
      setTexto(conteudo.slice(0, 200000));
      await ler(conteudo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível abrir o arquivo.");
    } finally {
      if (arquivoRef.current) arquivoRef.current.value = "";
    }
  };

  const criar = async () => {
    if (!pacote) return;
    setCriando(true);
    try {
      const data = await chamarAds<any>("pacote_importar", { client_id: clientId, pacote, confirmar: true });
      const n = Array.isArray(data && data.criativos) ? data.criativos.length : 0;
      toast.success(`${n} criativo${n === 1 ? "" : "s"} no Estúdio Ads`, {
        description: [data && data.custo_usd ? `Conferência do Jev: ${usd(data.custo_usd)}.` : "", Array.isArray(data && data.avisos) && data.avisos.length ? `${data.avisos.length} aviso(s) para revisar.` : ""].filter(Boolean).join(" ") || undefined,
      });
      void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
      void queryClient.invalidateQueries({ queryKey: chavesAds.planos(clientId) });
      setAberto(false);
      limpar();
      if (onImportado && data && data.plano && data.plano.id) onImportado(String(data.plano.id));
    } catch (e) {
      avisarErro(e, "Não foi possível criar os criativos");
    } finally {
      setCriando(false);
    }
  };

  return (
    <>
      <Button type="button" size="sm" variant="outline" className={`h-9 ${className}`} onClick={() => setAberto(true)} title="Sobe o retorno do agente externo e cria os criativos no Estúdio Ads">
        <Upload className="mr-1 h-3.5 w-3.5" />
        Importar pacote no Estúdio Ads
      </Button>
      <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (!v) limpar(); }}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] max-w-2xl overflow-y-auto overscroll-contain">
          <DialogHeader>
            <DialogTitle>Importar o retorno do agente externo</DialogTitle>
            <DialogDescription>Suba o .zip ou o .json que o agente devolveu, ou cole a resposta. A Mesa Ads mostra o que entendeu antes de criar qualquer coisa.</DialogDescription>
          </DialogHeader>
          <div className="min-w-0 space-y-3">
            <div className="flex min-w-0 flex-wrap items-center">
              <input ref={arquivoRef} type="file" accept=".zip,.json,.md,.txt,application/zip,application/json,text/plain,text/markdown" className="hidden" onChange={(e) => void escolherArquivo(e.target.files && e.target.files[0] ? e.target.files[0] : null)} aria-label="Arquivo do retorno" />
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8" onClick={() => arquivoRef.current && arquivoRef.current.click()} disabled={lendo}>
                <FileUp className="mr-1 h-3.5 w-3.5" /> Escolher arquivo (.zip ou .json)
              </Button>
              <span className="mb-1 text-[11.5px] text-muted-foreground">ou cole o texto abaixo</span>
            </div>
            <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={6} aria-label="Resposta do agente externo" placeholder='Cole a resposta com o bloco ```json { "formato": "mesa-ads-retorno", "criativos": [...] } ```' className="text-[12px]" />
            <div className="flex min-w-0 flex-wrap items-center">
              <Button type="button" size="sm" className="mb-1 mr-2 h-8" disabled={!texto.trim() || lendo} onClick={() => void ler(texto)}>
                {lendo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                Ler o retorno
              </Button>
              <span className="mb-1 text-[11px] text-muted-foreground">Ler é grátis: nada é criado até você confirmar.</span>
            </div>
            {erro && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">{erro}</p>}
            {entendido && (
              <div className="min-w-0 space-y-2 rounded-xl border border-border p-3" aria-label="O que a Mesa Ads entendeu">
                <p className="text-[12.5px] font-semibold">
                  Entendi {entendido.aceitos.length} criativo{entendido.aceitos.length === 1 ? "" : "s"}
                  {entendido.recusados.length ? ` e recusei ${entendido.recusados.length}` : ""}
                  {entendido.plano.nome ? ` para o plano "${entendido.plano.nome}"` : ""}.
                </p>
                {entendido.plano.resumo && <p className="text-[12px] text-muted-foreground [overflow-wrap:anywhere]">{entendido.plano.resumo}</p>}
                <ul className="space-y-1.5">
                  {entendido.aceitos.map((c, k) => (
                    <li key={k} className="min-w-0 rounded-lg bg-muted/50 px-2.5 py-1.5 text-[12px] leading-snug">
                      <span className="font-medium [overflow-wrap:anywhere]">{c.titulo}</span>
                      <span className="text-muted-foreground"> · {formatoDe(c.formato).rotulo}{c.objetivo ? ` · ${rotuloDoObjetivo(c.objetivo)}` : ""} · {c.cta_meta}</span>
                      <span className="block [overflow-wrap:anywhere]">Arte: "{c.headline_arte}". Título: {c.titulo_anuncio}</span>
                      {c.avisos.length > 0 && <span className="block text-[11px] text-warning [overflow-wrap:anywhere]">{c.avisos.join("; ")}</span>}
                    </li>
                  ))}
                </ul>
                {entendido.recusados.length > 0 && (
                  <div className="rounded-lg bg-destructive/5 px-2.5 py-1.5 text-[12px]">
                    <p className="font-medium text-destructive">Recusados</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {entendido.recusados.map((r) => (
                        <li key={r.indice} className="[overflow-wrap:anywhere]">#{r.indice} {r.titulo || "sem título"}: {r.motivos.join("; ")}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {entendido.avisos.map((a) => <p key={a} className="text-[11.5px] text-muted-foreground">{a}</p>)}
                <div className="flex min-w-0 flex-wrap items-center pt-1">
                  <Button type="button" size="sm" className="mb-1 mr-2 h-9" disabled={!entendido.aceitos.length || criando} onClick={() => void criar()}>
                    {criando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Criar {entendido.aceitos.length} criativo{entendido.aceitos.length === 1 ? "" : "s"} no Estúdio Ads
                  </Button>
                  <span className="mb-1 text-[11px] text-muted-foreground">Custo: só a conferência de política pelo Jev (centavos). A arte é gerada depois, no Estúdio Ads, com o custo à vista.</span>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
