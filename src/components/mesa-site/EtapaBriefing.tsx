import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { PreencherComIA } from "@/components/sistema";
import { botao, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarSite, type LinhaDoSite, useSalvarSite } from "./siteApi";
import CampoComIA, { textoDoValor } from "./CampoComIA";
import { camposDoBriefing, camposDoSiteInteiro, destinosDosValores, mapaDoTipoAplicado, perguntasDaTela } from "./preencherDoSite";
import { useBarraDaEtapa } from "./BarraDaEtapa";

type Pergunta = { id: string; rotulo: string };
type Leitura = { encontrado: boolean; briefing_id?: string; titulo?: string | null; respostas: Record<string, unknown>; decupagem: { itens?: Array<{ texto?: string; categoria?: string }>; tom_de_voz?: string | null } | null; perguntas: Pergunta[] };

const textoDe = (v: unknown): string => (Array.isArray(v) ? v.map(textoDe).filter(Boolean).join(", ") : v && typeof v === "object" ? JSON.stringify(v) : String(v ?? "")).slice(0, 1500);
const emTexto = (salvas: Record<string, unknown>) => {
  const r: Record<string, string> = {};
  Object.keys(salvas || {}).forEach((k) => (r[k] = textoDe(salvas[k])));
  return r;
};

/**
 * Etapa 1: o briefing do site. Lê o briefing de site da frente BRF (modelo
 * "site" ou "landing", da marca do site); sem ele, pergunta aqui mesmo. Salvar
 * é sempre parcial. SIT2: cada pergunta tem o ✨ do Preencher com IA, a seção
 * tem o "Preencher o briefing" e o "Preencher tudo do site" (briefing, tipo,
 * direção, SEO, dados do negócio e WhatsApp numa prévia só).
 * UXS 30/09: as perguntas saem na hora (lista fixa, sem esperar o servidor);
 * só o briefing respondido espera, com esqueleto próprio e "Tentar de novo".
 * Salvar e Seguir moram na barra da etapa.
 */
export default function EtapaBriefing({ site }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const leitura = useQuery({ queryKey: ["mesa-site", "briefing", site.id], queryFn: () => chamarSite<Leitura>("briefing_ler", { site_id: site.id }) });
  const salvas = (site.briefing && site.briefing.respostas) || {};
  const [respostas, setRespostas] = useState<Record<string, string>>(() => emTexto(salvas));
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    setRespostas(emTexto(salvas));
    // Só ao abrir outro site (a escrita da pessoa não é trocada por dado velho).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id]);

  const gravarRespostas = async (novas: Record<string, string>, extra: Record<string, unknown> = {}, seguir = false) => {
    await salvarSite("site_salvar", { site_id: site.id, briefing: { respostas: novas, ...extra }, etapa: seguir ? "referencias" : undefined });
  };

  /** Grava as respostas (com `seguir`, marca a etapa seguinte). true quando gravou; o erro aparece e mantém o que foi escrito. */
  const salvar = async (extra: Record<string, unknown> = {}, seguir = false): Promise<boolean> => {
    setSalvando(true);
    try {
      await gravarRespostas(respostas, extra, seguir);
      return true;
    } catch (e) {
      avisarErro(e, "O briefing não foi salvo");
      return false;
    } finally {
      setSalvando(false);
    }
  };

  /** Aplica respostas (do ✨ ou do Preencher tudo) e grava na hora; o erro sobe para a peça mostrar. */
  const aplicarRespostas = async (parciais: Record<string, string>) => {
    const novas = { ...respostas, ...parciais };
    setRespostas(novas);
    await gravarRespostas(novas);
  };

  /** Preencher tudo do site: cada destino vira a sua ação (briefing, direção, tipo e mapa, SEO, WhatsApp). */
  const aplicarNoSite = async (valores: Record<string, unknown>) => {
    const d = destinosDosValores(valores);
    if (Object.keys(d.briefing).length) await aplicarRespostas(d.briefing);
    if (Object.keys(d.direcao).length) await salvarSite("site_salvar", { site_id: site.id, direcao: d.direcao });
    if (d.tipo) await salvarSite("mapa_salvar", { site_id: site.id, tipo: d.tipo, mapa: mapaDoTipoAplicado(site, d.tipo) });
    if (Object.keys(d.seo).length) await salvarSite("seo_salvar", { site_id: site.id, seo: d.seo });
    if (d.whatsappMensagem !== null) await salvarSite("integracoes_salvar", { site_id: site.id, integracoes: { whatsapp: { ...((site.integracoes && site.integracoes.whatsapp) || {}), mensagem: d.whatsappMensagem } } });
  };

  const d = leitura.data;
  const usandoBrf = !!(site.briefing && site.briefing.fonte === "brf" && d && d.briefing_id === site.briefing.briefing_id);
  // As perguntas da lista fixa na hora; as que o servidor mandar a mais entram no fim.
  const perguntas = perguntasDaTela(d ? d.perguntas : null);
  const respondidas = perguntas.filter((p) => (respostas[p.id] || "").trim()).length;

  /** Usar o briefing respondido: só aplica (não troca de etapa); o formulário passa a mostrar as respostas dele. */
  const usarBrf = async () => {
    if (!d || !d.encontrado) return;
    if (await salvar({ fonte: "brf", briefing_id: d.briefing_id, respostas: d.respostas })) setRespostas(emTexto(d.respostas || {}));
  };

  useBarraDaEtapa(
    { estado: salvando ? "Salvando" : usandoBrf ? "Briefing respondido em uso" : `${respondidas} de ${perguntas.length} respondidas`, ocupado: salvando, salvar: true, pendente: !!(d && d.encontrado && !usandoBrf) },
    { antesDeSeguir: () => salvar({}, true), aoSalvar: () => salvar() },
  );

  return (
    <div className="min-w-0 space-y-6" data-etapa-briefing="">
      {/* O lugar do briefing respondido: esqueleto só aqui; o formulário fica na mesma posição (as caixas não remontam). */}
      {leitura.isLoading ? (
        <Carregando forma="lista" linhas={2} rotulo="Procurando o briefing do site" />
      ) : leitura.isError ? (
        <EstadoDeErro
          titulo="O briefing respondido não foi lido."
          acao={
            <button type="button" className={botao.discreto} onClick={() => void leitura.refetch()}>
              Tentar de novo
            </button>
          }
        />
      ) : d && d.encontrado ? (
        <Secao
          titulo={d.titulo || "Briefing respondido"}
          descricao={usandoBrf ? "Em uso neste site" : "Da frente de briefings"}
          ajuda="O briefing de site que o cliente respondeu pelo link (Briefings). A decupagem grifa palavras-chave, dores, público e tom. Usar leva as respostas para o site; o texto das próximas etapas parte dele."
          acao={
            <button type="button" className={usandoBrf ? botao.secundario : botao.primario} disabled={salvando} onClick={() => void usarBrf()} data-usar-briefing="">
              {usandoBrf ? <Check className="mr-1 h-3.5 w-3.5" /> : null}
              {usandoBrf ? "Usar de novo" : "Usar este briefing"}
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
      ) : null}

      <Secao
        titulo={d && d.encontrado ? "Complementar" : "Briefing do site"}
        descricao={d && !d.encontrado ? "Sem briefing de site respondido" : undefined}
        ajuda="Sem o briefing de site do cliente, responda aqui o essencial. O ✨ de cada pergunta preenche pelo contexto da marca, pelo dossiê e pelos arquivos, com a prévia antes de gravar. Preencher tudo do site também propõe o tipo de site, a observação da direção, o SEO, os dados do negócio e a mensagem do WhatsApp. Nada de número ou nome que não esteja nas fontes. Salvar e Seguir ficam no pé da etapa."
        recolher="mesa-site:briefing:formulario"
        acao={
          <>
            <span className="mr-2 inline-flex">
              <PreencherComIA
                papel="site"
                clientId={clientId}
                marcaId={marca ? marca.id : null}
                campos={camposDoSiteInteiro(site, respostas)}
                fontes={["contexto", "briefing", "dossie", "arquivos"]}
                rotulo="Preencher tudo do site"
                onAplicar={aplicarNoSite}
                onDesfazer={(anteriores) => aplicarNoSite(anteriores)}
              />
            </span>
            <span className="inline-flex">
              <PreencherComIA
                papel="site"
                clientId={clientId}
                marcaId={marca ? marca.id : null}
                campos={camposDoBriefing(perguntas, respostas)}
                rotulo="Preencher o briefing"
                compacto
                onAplicar={(v) => aplicarNoSite(v)}
                onDesfazer={(a) => aplicarNoSite(a)}
              />
            </span>
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {perguntas.map((p) => (
            <CampoComIA
              key={p.id}
              rotulo={p.rotulo}
              campo={camposDoBriefing([p], respostas)[0]}
              onAplicar={(v) => aplicarRespostas({ [p.id]: textoDoValor(v) })}
              onDesfazer={(a) => aplicarRespostas({ [p.id]: textoDoValor(a) })}
            >
              <textarea
                value={respostas[p.id] || ""}
                onChange={(e) => setRespostas((r) => ({ ...r, [p.id]: e.target.value }))}
                rows={3}
                maxLength={1500}
                aria-label={p.rotulo}
                className={juntar(campoTexto, "min-h-[76px]")}
              />
            </CampoComIA>
          ))}
        </div>
      </Secao>
    </div>
  );
}
