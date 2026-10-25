import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, FlaskConical, Loader2, RefreshCw, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { normalizarIntegracoes } from "../../../supabase/functions/_shared/site-lancamento";
import { eventoDaMeta, eventosDoObjetivo, linkDoTestarEventos, normalizarCodigoDeTeste, objetivoPedePixel } from "../../../supabase/functions/mesa-site/modulos/medicao-do-site";
import { CHAVES, chamarMotor, chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";
import { CHAVES_DA_JORNADA, jornadaDoSite, useMedicao } from "./jornadaApi";

/** Só dígitos, de 10 a 20 (o mesmo do servidor). */
const pixelValido = (v: string) => /^\d{10,20}$/.test(v.trim());

/**
 * Pixel e eventos (25/10/2026), no passo Ajustar e publicar: o ID do pixel
 * (com a sugestão dos pixels da conta de anúncios do cliente), os eventos
 * padrão da Meta do objetivo (a casca do site dispara, só depois do Aceitar
 * dos cookies), os eventos automáticos da Meta (IA) e a Conversions API pelo
 * servidor (só com token da agência que alcança o pixel). "Testar eventos"
 * mostra o passo a passo do Gerenciador de Eventos e manda um evento de teste
 * pelo servidor. Mudou: "Aplicar no site" monta de novo sem gastar modelo.
 */
export default function PixelEEventos({ site }: { site: LinhaDoSite }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const j = jornadaDoSite(site);
  const salvo = normalizarIntegracoes(site.integracoes || {}).pixel_meta.id || "";
  const [pixel, setPixel] = useState(salvo);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [testando, setTestando] = useState(false);
  const [codigo, setCodigo] = useState(j.medicao.codigo_de_teste || "");
  const [resultado, setResultado] = useState<string | null>(null);
  const q = useMedicao(site.id);
  const d = q.data;

  useEffect(() => setPixel(salvo), [salvo]);

  const eventos = d ? d.eventos : eventosDoObjetivo(j.objetivo, j.objetivo === "loja_virtual" ? j.loja : null);
  const recarregar = () => qc.invalidateQueries({ queryKey: CHAVES_DA_JORNADA.medicao(site.id) });

  const rodar = async (rotulo: string, fn: () => Promise<void>) => {
    if (ocupado) return;
    setOcupado(rotulo);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, rotulo);
    } finally {
      setOcupado(null);
    }
  };

  const gravarPixel = (id: string) =>
    rodar("O pixel não foi salvo", async () => {
      const limpo = id.trim();
      if (limpo === salvo) return;
      if (limpo && !pixelValido(limpo)) throw new Error("O ID do pixel tem só números (de 10 a 20 dígitos).");
      await salvar("integracoes_salvar", { site_id: site.id, integracoes: { pixel_meta: { id: limpo || null } } });
      setPixel(limpo);
      void recarregar();
    });

  const mudarMedicao = (m: Record<string, unknown>) =>
    rodar("A medição não foi salva", async () => {
      await salvar("jornada_salvar", { site_id: site.id, medicao: m });
      void recarregar();
    });

  const aplicar = () =>
    rodar("A montagem não entrou na fila", async () => {
      await chamarMotor("pedir", { client_id: clientId, site_id: site.id, tipo: "revisar", instrucao: "Aplicar pixel, eventos e loja e revisar" });
      void qc.invalidateQueries({ queryKey: CHAVES.trabalhos(site.id) });
      toast.success("A montagem entrou na fila (sem gastar modelo).");
    });

  const testarServidor = () =>
    rodar("O evento de teste não saiu", async () => {
      const r = await chamarSite<{ ok: boolean; mensagem: string }>("medicao_testar_servidor", { site_id: site.id, codigo_de_teste: codigo });
      setResultado(r.mensagem);
    });

  const capiPossivel = !!(d && d.capi.possivel);
  const descricao = salvo ? `Pixel ${salvo} · ${eventos.length} eventos` : objetivoPedePixel(j.objetivo) ? "Sem pixel: os anúncios ficam sem medir" : "Sem pixel";

  return (
    <Secao
      titulo="Pixel e eventos"
      descricao={descricao}
      ajuda="O site dispara os eventos padrão da Meta do objetivo, só depois do Aceitar do aviso de cookies (LGPD), cada um com um id que a Conversions API do servidor repete (a Meta conta uma vez). Eventos automáticos da Meta (a IA do Gerenciador de Eventos que cria eventos sozinha) ficam desligados por padrão para não contar em dobro. A Conversions API usa o token da agência no servidor (nunca vai ao site) e só liga quando ele alcança o pixel. Depois de mudar, Aplicar no site monta de novo sem gastar modelo."
      recolher={`mesa-site:jornada:pixel:${site.id}`}
      acao={
        <>
          <button type="button" className={juntar(botao.icone, "mr-1")} aria-label="Testar eventos" title="Testar eventos" disabled={!salvo} onClick={() => setTestando(true)} data-testar-eventos="">
            <FlaskConical className="h-4 w-4" />
          </button>
          <button type="button" className={botao.icone} aria-label="Aplicar no site" title="Aplicar no site" disabled={!!ocupado} onClick={() => void aplicar()} data-aplicar-medicao="">
            {ocupado === "A montagem não entrou na fila" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </button>
        </>
      }
    >
      <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-5 lg:grid-cols-2" data-pixel-e-eventos="">
        <div className="min-w-0">
          <label className="block min-w-0">
            <span className={juntar(texto.rotulo, "mb-1 block")}>ID do pixel da Meta</span>
            <input
              value={pixel}
              inputMode="numeric"
              onChange={(e) => setPixel(e.target.value.replace(/\D/g, "").slice(0, 20))}
              onBlur={() => void gravarPixel(pixel)}
              onKeyDown={(e) => e.key === "Enter" && void gravarPixel(pixel)}
              className={campo}
              placeholder="só números"
              aria-label="ID do pixel da Meta"
              data-campo-pixel=""
            />
          </label>
          {q.isLoading ? (
            <p className={juntar(texto.auxiliar, "mt-2")}>Lendo os pixels da conta de anúncios</p>
          ) : d && d.pixels.length ? (
            <div className="mt-2 flex min-w-0 flex-wrap items-center" data-pixels-da-conta="">
              {d.pixels.map((p) => {
                const escolhido = p.id === salvo;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={juntar(botao.secundario, "mb-2 mr-2 h-8 max-w-full", escolhido ? "border-primary text-primary" : "")}
                    title={`${p.nome} · conta ${p.conta}${p.ultimo_disparo ? ` · último disparo ${new Date(p.ultimo_disparo).toLocaleString("pt-BR")}` : " · nunca disparou"}${p.id === d.sugerido ? " · sugerido" : ""}`}
                    aria-pressed={escolhido}
                    onClick={() => void gravarPixel(p.id)}
                    data-pixel-sugerido={p.id === d.sugerido ? "" : undefined}
                  >
                    {escolhido ? <Check className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : p.id === d.sugerido ? <Sparkles className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" /> : null}
                    <span className="min-w-0 truncate">{p.nome}</span>
                  </button>
                );
              })}
            </div>
          ) : d && d.motivo ? (
            <p className={juntar(texto.auxiliar, "mt-2 truncate")} title={d.motivo}>
              {d.motivo}
            </p>
          ) : null}
        </div>

        <div className="min-w-0">
          <span className={juntar(texto.rotulo, "mb-1 block")}>Eventos do objetivo</span>
          <ul className="flex min-w-0 flex-wrap" data-eventos-do-objetivo="">
            {eventos.map((e) => {
              const info = eventoDaMeta(e);
              return (
                <li key={e} className={juntar(texto.corpo, "mb-1 mr-4 inline-flex items-center")} title={info ? `${info.rotulo}: ${info.quando}` : e} data-evento={e}>
                  <Check className={juntar("mr-1 h-3.5 w-3.5 shrink-0", salvo ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />
                  {e}
                </li>
              );
            })}
          </ul>
          <label className={juntar(texto.corpo, "mt-3 flex cursor-pointer items-center")} title="Eventos automáticos e enriquecimento por IA da Meta: a Meta cria eventos sozinha a partir dos cliques. Com os eventos do site já por código, isso conta em dobro; ligue só se quiser a IA complementando e confira a duplicidade no Gerenciador de Eventos.">
            <input type="checkbox" className="mr-2" checked={j.medicao.eventos_automaticos} disabled={!!ocupado} onChange={(e) => void mudarMedicao({ eventos_automaticos: e.target.checked })} data-eventos-automaticos="" />
            Eventos automáticos da Meta (IA)
          </label>
          <label className={juntar(texto.corpo, "mt-2 flex items-center", capiPossivel ? "cursor-pointer" : "opacity-60")} title={capiPossivel ? "O lead do formulário vai também pelo servidor, com o mesmo id do navegador (a Meta conta uma vez). Só com o Aceitar dos cookies." : (d && d.capi.motivo) || "Escolha o pixel primeiro."}>
            <input type="checkbox" className="mr-2" checked={j.medicao.capi && capiPossivel} disabled={!capiPossivel || !!ocupado} onChange={(e) => void mudarMedicao({ capi: e.target.checked })} data-capi="" />
            Conversions API pelo servidor
          </label>
        </div>
      </div>

      <Dialog open={testando} onOpenChange={setTestando}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto bg-background" data-janela-testar-eventos="">
          <DialogHeader>
            <DialogTitle className="flex items-center">
              Testar eventos
              {salvo && (
                <a href={linkDoTestarEventos(salvo)} target="_blank" rel="noopener noreferrer" className={juntar(botao.icone, "ml-2")} aria-label="Abrir o Testar eventos no Gerenciador de Eventos" title="Abrir o Testar eventos no Gerenciador de Eventos">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
            </DialogTitle>
          </DialogHeader>
          <ol className={juntar(texto.corpo, "list-decimal space-y-1.5 pl-5")} data-passos-do-teste="">
            {(d ? d.passos : []).map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
          {capiPossivel && (
            <div className="mt-4 flex min-w-0 items-center" data-teste-do-servidor="">
              <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24))} className={juntar(campo, "mr-2")} placeholder="Código de teste (TEST...)" aria-label="Código de teste" />
              <button type="button" className={botao.icone} aria-label="Enviar evento de teste do servidor" title="Enviar evento de teste do servidor" disabled={!normalizarCodigoDeTeste(codigo) || !!ocupado} onClick={() => void testarServidor()}>
                {ocupado === "O evento de teste não saiu" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          )}
          {resultado && (
            <p role="status" className={juntar(texto.auxiliar, "mt-2")}>
              {resultado}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </Secao>
  );
}
