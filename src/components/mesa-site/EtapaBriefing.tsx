import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarSite, type LinhaDoSite, useGuardarSite } from "./siteApi";

type Pergunta = { id: string; rotulo: string };
type Leitura = { encontrado: boolean; briefing_id?: string; titulo?: string | null; respostas: Record<string, unknown>; decupagem: { itens?: Array<{ texto?: string; categoria?: string }>; tom_de_voz?: string | null } | null; perguntas: Pergunta[] };

const textoDe = (v: unknown): string => (Array.isArray(v) ? v.map(textoDe).filter(Boolean).join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "")).slice(0, 600);

/**
 * Etapa 1: o briefing do site. Lê o briefing de site da frente BRF (modelo
 * "site" ou "landing", da marca do site); sem ele, pergunta aqui mesmo. Salvar
 * é sempre parcial.
 */
export default function EtapaBriefing({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const leitura = useQuery({ queryKey: ["mesa-site", "briefing", site.id], queryFn: () => chamarSite<Leitura>("briefing_ler", { site_id: site.id }) });
  const salvas = (site.briefing && site.briefing.respostas) || {};
  const [respostas, setRespostas] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    const r: Record<string, string> = {};
    Object.keys(salvas).forEach((k) => (r[k] = textoDe(salvas[k])));
    setRespostas(r);
    // Só ao abrir outro site (a escrita da pessoa não é trocada por dado velho).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const salvar = async (extra: Record<string, unknown> = {}, seguir = false) => {
    setSalvando(true);
    try {
      const d = await chamarSite<{ site: LinhaDoSite }>("site_salvar", { site_id: site.id, briefing: { respostas, ...extra }, etapa: seguir ? "referencias" : undefined });
      guardar(d.site);
      if (seguir) onIrPara("referencias");
    } catch (e) {
      avisarErro(e, "O briefing não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  if (leitura.isLoading) return <Carregando forma="lista" rotulo="Procurando o briefing do site" />;
  const d = leitura.data;
  const usandoBrf = site.briefing && site.briefing.fonte === "brf" && d && d.briefing_id === site.briefing.briefing_id;

  return (
    <div className="min-w-0 space-y-6" data-etapa-briefing="">
      {d && d.encontrado && (
        <Secao
          titulo={d.titulo || "Briefing respondido"}
          descricao={usandoBrf ? "Em uso neste site" : "Da frente de briefings"}
          ajuda="O briefing de site que o cliente respondeu pelo link (Briefings). A decupagem grifa palavras-chave, dores, público e tom. Usar leva as respostas para o site; o texto das próximas etapas parte dele."
          acao={
            <button type="button" className={usandoBrf ? botao.secundario : botao.primario} disabled={salvando} onClick={() => void salvar({ fonte: "brf", briefing_id: d.briefing_id, respostas: d.respostas }, true)}>
              {usandoBrf ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
              {usandoBrf ? "Seguir" : "Usar este briefing"}
            </button>
          }
        >
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {Object.keys(d.respostas || {}).slice(0, 30).map((k) => (
              <li key={k} className="px-2 py-2">
                <span className={juntar(texto.rotulo, "block")}>{k.replace(/_/g, " ")}</span>
                <span className={juntar(texto.corpo, "block")}>{textoDe(d.respostas[k]) || "sem resposta"}</span>
              </li>
            ))}
          </ul>
          {d.decupagem && Array.isArray(d.decupagem.itens) && d.decupagem.itens.length > 0 && (
            <div className="flex flex-wrap">
              {d.decupagem.itens.slice(0, 24).map((i, n) => (
                <span key={n} className="mb-1.5 mr-1.5 inline-flex h-6 items-center rounded bg-muted px-2 text-[12px]" title={i.categoria || ""}>
                  {i.texto}
                </span>
              ))}
            </div>
          )}
        </Secao>
      )}

      <Secao
        titulo={d && d.encontrado ? "Complementar" : "Briefing do site"}
        descricao={d && !d.encontrado ? "Sem briefing de site respondido" : undefined}
        ajuda="Sem o briefing de site do cliente, responda aqui o essencial. Salvar guarda o que já estiver escrito; dá para voltar depois."
        acao={
          <>
            <button type="button" className={juntar(botao.secundario, "mr-2")} disabled={salvando} onClick={() => void salvar()}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Salvar
            </button>
            <button type="button" className={botao.primario} disabled={salvando} onClick={() => void salvar({}, true)}>
              Seguir
              <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </button>
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {((d && d.perguntas) || []).map((p) => (
            <label key={p.id} className="block min-w-0">
              <span className={juntar(texto.rotulo, "mb-1 block")}>{p.rotulo}</span>
              <textarea
                value={respostas[p.id] || ""}
                onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))}
                rows={3}
                maxLength={1500}
                className={juntar(campoTexto, "min-h-[76px]")}
              />
            </label>
          ))}
        </div>
      </Secao>
    </div>
  );
}
