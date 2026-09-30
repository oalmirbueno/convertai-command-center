import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { CampoDeFormulario, GrupoDeCampos, Secao, botao, campoTexto, juntar, lista, texto } from "@/components/sistema";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { modeloDoPapel, usd } from "@/lib/mesa/api";
import { valorParaLer } from "@/lib/mesa/preencherComIA";
import { type PreviaDoPreenchimento, chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";

/**
 * "Preencher com IA" o briefing interno (frente BRF2, 30/09/2026): a equipe
 * cola a reunião ou a conversa, marca o site e o Instagram do cliente,
 * escolhe o modelo (o padrão do papel "briefing", trocável) e vê o custo
 * antes. A IA devolve uma PRÉVIA: nada é gravado até a pessoa aplicar (tudo
 * ou campo a campo). Aplicar grava no mesmo link, e Desfazer volta como
 * estava. Depois a equipe revisa e manda o link para o cliente conferir.
 */

type Fontes = { site: boolean; instagram: boolean; contexto: boolean };

export default function PreencherBriefingComIA({
  briefingId,
  temDesfazer,
  onMudou,
}: {
  briefingId: string;
  /** Há um preenchimento aplicado que ainda dá para desfazer. */
  temDesfazer: boolean;
  onMudou: () => void;
}) {
  const catalogo = useCatalogo();
  const padrao = modeloDoPapel(catalogo.data || [], "briefing");
  const [modeloId, setModeloId] = useState("");
  const [reuniao, setReuniao] = useState("");
  const [conversa, setConversa] = useState("");
  const [fontes, setFontes] = useState<Fontes>({ site: true, instagram: true, contexto: true });
  const [substituir, setSubstituir] = useState(false);
  const [previa, setPrevia] = useState<PreviaDoPreenchimento | null>(null);
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [ocupado, setOcupado] = useState<"" | "gerando" | "aplicando" | "desfazendo">("");
  const [erro, setErro] = useState<string | null>(null);
  const [podeDesfazer, setPodeDesfazer] = useState(temDesfazer);
  useEffect(() => setPodeDesfazer(temDesfazer), [temDesfazer]);

  const modelo = modeloId || (padrao ? padrao.id : "");
  // A estimativa só muda de faixa em faixa (a cada 2 mil caracteres), para não chamar a cada tecla.
  const faixa = Math.ceil((reuniao.length + conversa.length) / 2000);
  const estimativa = useQuery({
    queryKey: ["briefing-preencher-estimar", briefingId, modelo, faixa, fontes.site, fontes.instagram, fontes.contexto, substituir],
    enabled: !!modelo,
    queryFn: () =>
      chamarAgenteDoBriefing<{ custo_usd: number; campos: number }>("estimar_preenchimento", {
        briefing_id: briefingId,
        modelo_id: modelo,
        caracteres: faixa * 2000,
        fontes,
        substituir,
      }),
    staleTime: 60_000,
  });
  const temMaterial = reuniao.trim().length + conversa.trim().length >= 40 || fontes.site || fontes.instagram;

  const gerar = async () => {
    setOcupado("gerando");
    setErro(null);
    try {
      const r = await chamarAgenteDoBriefing<PreviaDoPreenchimento>("preencher_ia", { briefing_id: briefingId, modelo_id: modelo, reuniao, conversa, fontes, substituir, confirmado: true });
      setPrevia(r);
      setEscolhidas(Object.keys(r.valores));
      if (!Object.keys(r.valores).length) toast.info("A IA não achou base para nenhuma pergunta. Veja os avisos.");
    } catch (e) {
      // O material fica nos campos: nada se perde.
      setErro(textoDoErroDoBriefing(e, "Não foi possível preencher agora."));
    } finally {
      setOcupado("");
    }
  };

  const desfazer = async () => {
    setOcupado("desfazendo");
    try {
      const r = await chamarAgenteDoBriefing<{ voltaram: string[]; mantidos: string[] }>("desfazer_preenchimento", { briefing_id: briefingId });
      toast.success(r.mantidos.length ? `${r.voltaram.length} voltaram; ${r.mantidos.length} mudaram depois e ficaram.` : "Desfeito. As respostas voltaram como estavam.");
      setPodeDesfazer(false);
      onMudou();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível desfazer."));
    } finally {
      setOcupado("");
    }
  };

  const aplicar = async () => {
    if (!previa) return;
    setOcupado("aplicando");
    try {
      const valores: Record<string, unknown> = {};
      escolhidas.forEach((k) => {
        valores[k] = previa.valores[k];
        // "Outro" leva o texto junto.
        if (Object.prototype.hasOwnProperty.call(previa.valores, `${k}__outro`)) valores[`${k}__outro`] = previa.valores[`${k}__outro`];
      });
      const r = await chamarAgenteDoBriefing<{ aplicadas: string[]; aviso: string | null }>("aplicar_respostas", { briefing_id: briefingId, valores });
      toast.success(`${r.aplicadas.length} ${r.aplicadas.length === 1 ? "resposta aplicada" : "respostas aplicadas"} no link.`, { action: { label: "Desfazer", onClick: () => void desfazer() } });
      if (r.aviso) toast.warning(r.aviso);
      setPrevia(null);
      setPodeDesfazer(true);
      onMudou();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível aplicar."));
    } finally {
      setOcupado("");
    }
  };

  const chaves = useMemo(() => (previa ? Object.keys(previa.valores).filter((k) => !/__outro$/.test(k)) : []), [previa]);

  return (
    <Secao
      titulo="Preencher com IA"
      descricao={previa ? `${chaves.length} respostas na prévia` : undefined}
      ajuda="Cole a reunião ou a conversa com o cliente e marque o site e o Instagram dele. A IA responde o que o material responde (nunca inventa número, preço ou nome) e mostra uma prévia. Nada é gravado até você aplicar; Desfazer volta como estava. Depois, mande o link para o cliente conferir."
      recolher={`briefing:preencher-ia:${briefingId}`}
      recolhidaDeInicio
      divisoria
      acao={
        podeDesfazer ? (
          <button type="button" onClick={() => void desfazer()} disabled={!!ocupado} className={botao.barra}>
            {ocupado === "desfazendo" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="h-4 w-4" aria-hidden="true" />}
            <span className="ml-1.5">Desfazer o último</span>
          </button>
        ) : undefined
      }
    >
      {!previa ? (
        <div className="min-w-0 space-y-4">
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Reunião" apoio="Transcrição ou anotações." largo>
              <textarea className={campoTexto} value={reuniao} maxLength={60_000} rows={4} onChange={(e) => setReuniao(e.target.value)} aria-label="Reunião com o cliente" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Conversa" apoio="WhatsApp, e-mail ou direct." largo>
              <textarea className={campoTexto} value={conversa} maxLength={60_000} rows={3} onChange={(e) => setConversa(e.target.value)} aria-label="Conversa com o cliente" />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="-m-1 flex flex-wrap" role="group" aria-label="Fontes">
            {([["site", "Site do cliente"], ["instagram", "Instagram"], ["contexto", "Contexto do painel"]] as Array<[keyof Fontes, string]>).map(([k, r]) => (
              <label key={k} className="m-1 inline-flex items-center text-[13px] text-foreground">
                <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={fontes[k]} onChange={(e) => setFontes({ ...fontes, [k]: e.target.checked })} />
                {r}
              </label>
            ))}
            <label className="m-1 inline-flex items-center text-[13px] text-foreground">
              <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
              Substituir o que já tem
            </label>
          </div>
          <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-2">
            <SeletorDeModelo catalogo={catalogo.data || []} tipo="texto" rotulo="Modelo" valor={modelo} onChange={setModeloId} />
            <div className="flex min-w-0 flex-wrap items-center justify-end">
              <span className={juntar(texto.auxiliar, "mr-3")}>
                {estimativa.isFetching ? "Calculando o custo..." : estimativa.data ? `${estimativa.data.campos} perguntas · cerca de ${usd(estimativa.data.custo_usd)}` : estimativa.isError ? textoDoErroDoBriefing(estimativa.error) : ""}
              </span>
              <button type="button" onClick={() => void gerar()} disabled={!!ocupado || !modelo || !temMaterial || !estimativa.data || !estimativa.data.campos} className={botao.primario}>
                {ocupado === "gerando" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                {ocupado === "gerando" ? "Lendo o material..." : "Gerar prévia"}
              </button>
            </div>
          </div>
          {erro && <p className="text-[13px] text-destructive" role="alert">{erro}</p>}
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {chaves.length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Prévia das respostas">
              {chaves.map((k) => {
                const marcada = escolhidas.indexOf(k) >= 0;
                const antes = valorParaLer(previa.atuais[k]);
                return (
                  <li key={k} className={juntar(lista.linha, "items-start")}>
                    <input type="checkbox" id={`prev-${k}`} className="mr-3 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={marcada} onChange={() => setEscolhidas((l) => (marcada ? l.filter((x) => x !== k) : l.concat(k)))} />
                    <label htmlFor={`prev-${k}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-[13px] font-medium text-foreground">{previa.rotulos[k] || k}</span>
                      <span className={juntar(texto.corpo, "mt-0.5 block [overflow-wrap:anywhere]")}>{valorParaLer(previa.valores[k]).slice(0, 600)}</span>
                      {antes && <span className={juntar(texto.auxiliar, "mt-0.5 block [overflow-wrap:anywhere]")}>Hoje: {antes.slice(0, 200)}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {previa.fontes.length > 0 && <p className={texto.auxiliar}>Fontes: {previa.fontes.join(", ")} · custo {usd(previa.custo_usd)}</p>}
          {previa.avisos.length > 0 && (
            <ul className="list-disc space-y-1 pl-5" aria-label="Avisos do preenchimento">
              {previa.avisos.map((a, i) => <li key={i} className="text-[12px] leading-5 text-muted-foreground">{a}</li>)}
            </ul>
          )}
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            <button type="button" onClick={() => setPrevia(null)} disabled={!!ocupado} className={botao.secundario}>Descartar</button>
            <button type="button" onClick={() => void aplicar()} disabled={!!ocupado || !escolhidas.length} className={botao.primario}>
              {ocupado === "aplicando" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Aplicar {escolhidas.length ? `(${escolhidas.length})` : ""}
            </button>
          </div>
        </div>
      )}
    </Secao>
  );
}
