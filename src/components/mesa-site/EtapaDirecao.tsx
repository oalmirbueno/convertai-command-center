import { useEffect, useState } from "react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { GradeDeGrupos, GrupoDeFuncoes } from "@/components/sistema/GrupoDeFuncoes";
import { PreencherComIA } from "@/components/sistema";
import { campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { ATRIBUTOS_DO_DNA, MAX_ATRIBUTOS, MIN_ATRIBUTOS, MOVIMENTOS, NICHOS, NIVEIS } from "../../../supabase/functions/_shared/site-metodo";
import { mapaDoSite, type MapaDoSite, normalizarEstilo, PRESETS_DE_MOTION, presetDeEstilo, presetDeMotion, secoesDoMapa } from "../../../supabase/functions/_shared/site-biblioteca";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import EditorDoMapa, { mapaMudou } from "./EditorDoMapa";
import PresetsDeEstilo from "./PresetsDeEstilo";
import CampoComIA, { textoDoValor } from "./CampoComIA";
import { useBarraDaEtapa } from "./BarraDaEtapa";

type Dna = { atributos: string[]; movimento: string; nivel: string; nicho: string };

/** O que está salvo na linha (a mesma leitura para começar a tela e para saber o que mudou). */
function dnaSalvoDo(site: LinhaDoSite): Dna {
  const d = site.dna && Array.isArray(site.dna.atributos) ? site.dna : null;
  return {
    atributos: d ? d.atributos.map((a: { id: string }) => a.id) : [],
    movimento: (d && d.movimento) || "sutil",
    nivel: (d && d.nivel) || "saas",
    nicho: (d && d.nicho) || site.direcao.nicho || "servico_local",
  };
}

const rotuloDe = (lista: ReadonlyArray<{ id: string; rotulo: string }>, id: string) => (lista.find((x) => x.id === id) || { rotulo: id }).rotulo;

/**
 * Etapa 3: direção. SIT2: tipo de site e mapa (páginas e seções da
 * biblioteca), presets de estilo com prévia e de movimento, nicho, referência
 * de nível, DNA (3 a 5 atributos) e a observação. A paleta vem do kit da marca.
 * O ✨ da direção propõe nicho, nível, movimento e observação com prévia.
 *
 * UXS 30/09, uma escolha principal (o preset) e um clique para seguir:
 * 1) tipo e mapa; 2) estilo, com o "Ajuste fino" recolhido (DNA, um grupo só
 * "Movimento" e referência de nível); 3) nicho e observação. Mapa, estilo e
 * direção ficam na tela até o Salvar ou o Seguir da barra, que gravam só o que
 * mudou, nessa ordem, parando no primeiro erro. Escolher o preset já põe o DNA
 * dele no estado da etapa (a mesma regra do servidor), e o estilo vai com
 * aplicar_dna: false, para o servidor não passar por cima do ajuste fino.
 * O modelo do motor saiu daqui: fica só na Construção (e continua salvo no site).
 */
export default function EtapaDirecao({ site }: { site: LinhaDoSite; onIrPara?: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvarSite = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const dnaSalvo = site.dna && Array.isArray(site.dna.atributos) ? site.dna : null;
  const [mapa, setMapa] = useState<MapaDoSite>(() => mapaDoSite(site));
  const [estilo, setEstilo] = useState(() => normalizarEstilo(site.estilo || {}));
  const [dna, setDna] = useState<Dna>(() => dnaSalvoDo(site));
  const [observacao, setObservacao] = useState<string>(site.direcao.observacao || "");
  const [salvando, setSalvando] = useState(false);

  // Cada parte volta ao salvo quando muda por fora (outro site, o diretor de site, o que acabou de gravar).
  useEffect(() => {
    setMapa(mapaDoSite(site));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.mapa || null), site.tipo]);
  useEffect(() => {
    setEstilo(normalizarEstilo(site.estilo || {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.estilo || null)]);
  useEffect(() => {
    setDna(dnaSalvoDo(site));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, JSON.stringify(site.dna || null)]);
  useEffect(() => {
    setObservacao(site.direcao.observacao || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site.id, site.direcao.observacao]);

  const estiloSalvo = normalizarEstilo(site.estilo || {});
  const salvo = dnaSalvoDo(site);
  const mudouMapa = mapaMudou(site, mapa);
  const mudouEstilo = estilo.preset !== estiloSalvo.preset || estilo.motion.join(",") !== estiloSalvo.motion.join(",");
  const mudouDirecao = dna.atributos.join(",") !== salvo.atributos.join(",") || dna.movimento !== salvo.movimento || dna.nivel !== salvo.nivel || dna.nicho !== salvo.nicho || observacao !== (site.direcao.observacao || "");
  const pendentes = [mudouMapa && "mapa", mudouEstilo && "estilo", mudouDirecao && "direção"].filter(Boolean) as string[];
  const totalDeSecoes = secoesDoMapa(mapa).length;
  const poucos = dna.atributos.length < MIN_ATRIBUTOS;

  const mudarDna = (v: Partial<Dna>) => setDna((d) => ({ ...d, ...v }));
  const alternar = (id: string) => setDna((d) => ({ ...d, atributos: d.atributos.indexOf(id) >= 0 ? d.atributos.filter((x) => x !== id) : d.atributos.length >= MAX_ATRIBUTOS ? d.atributos : d.atributos.concat([id]) }));
  const alternarMotion = (id: string) => setEstilo((e) => ({ ...e, motion: e.motion.indexOf(id) >= 0 ? e.motion.filter((x) => x !== id) : e.motion.length >= 3 ? e.motion : e.motion.concat([id]) }));

  /** Preset escolhido (clique ou Jev): o DNA dele entra na hora, com a regra do servidor (camposDoEstilo); o nicho fica. */
  const escolherPreset = (id: string | null) => {
    setEstilo((e) => ({ ...e, preset: id }));
    const p = presetDeEstilo(id);
    if (!p) return;
    const primeiro = presetDeMotion(estilo.motion[0]);
    mudarDna({ atributos: p.atributos.slice(0, MAX_ATRIBUTOS), movimento: primeiro ? primeiro.base : p.movimento, nivel: p.nivel });
  };

  const corpoDaDirecao = (d: Dna, ob: string) => ({ dna: { atributos: d.atributos, movimento: d.movimento, nivel: d.nivel, nicho: d.nicho }, direcao: { nicho: d.nicho, nivel: d.nivel, observacao: ob } });

  /**
   * Grava só o que mudou, na ordem mapa, estilo e direção; para no primeiro
   * erro e diz qual parte não foi salva. Com `seguir`, marca a etapa seguinte.
   */
  const gravarTudo = async (seguir: boolean): Promise<boolean> => {
    setSalvando(true);
    let parte = "";
    try {
      if (mudouMapa) {
        parte = "O mapa não foi salvo";
        await salvarSite("mapa_salvar", { site_id: site.id, tipo: mapa.tipo, mapa });
      }
      if (mudouEstilo) {
        parte = "O estilo não foi salvo";
        await salvarSite("estilo_salvar", { site_id: site.id, preset: estilo.preset, motion: estilo.motion, aplicar_dna: false });
      }
      if (mudouDirecao || seguir) {
        parte = "A direção não foi salva";
        await salvarSite("site_salvar", { site_id: site.id, ...(mudouDirecao ? corpoDaDirecao(dna, observacao) : {}), etapa: seguir ? "conteudo" : undefined });
      }
      return true;
    } catch (e) {
      avisarErro(e, parte || "A direção não foi salva");
      return false;
    } finally {
      setSalvando(false);
    }
  };

  /** ✨ da direção: aplica o que veio (com a prévia da peça) e grava a direção. */
  const aplicarDirecao = async (v: Record<string, unknown>) => {
    const novo: Partial<Dna> = {};
    let ob = observacao;
    if (typeof v["direcao.nicho"] === "string" && NICHOS.some((n) => n.id === v["direcao.nicho"])) novo.nicho = String(v["direcao.nicho"]);
    if (typeof v["direcao.nivel"] === "string" && NIVEIS.some((n) => n.id === v["direcao.nivel"])) novo.nivel = String(v["direcao.nivel"]);
    if (typeof v["direcao.movimento"] === "string" && MOVIMENTOS.some((n) => n.id === v["direcao.movimento"])) novo.movimento = String(v["direcao.movimento"]);
    if (v["direcao.observacao"] !== undefined) ob = textoDoValor(v["direcao.observacao"]);
    const d = { ...dna, ...novo };
    setDna(d);
    setObservacao(ob);
    await salvarSite("site_salvar", { site_id: site.id, ...corpoDaDirecao(d, ob) });
  };

  const camposDaDirecao = [
    { chave: "direcao.nicho", rotulo: "Nicho", tipo: "escolha" as const, opcoes: NICHOS.map((n) => n.id), valorAtual: dna.nicho },
    { chave: "direcao.nivel", rotulo: "Referência de nível", tipo: "escolha" as const, opcoes: NIVEIS.map((n) => n.id), valorAtual: dna.nivel, dica: NIVEIS.map((n) => `${n.id}: ${n.descricao}`).join("; ") },
    { chave: "direcao.movimento", rotulo: "Movimento", tipo: "escolha" as const, opcoes: MOVIMENTOS.map((n) => n.id), valorAtual: dna.movimento, dica: MOVIMENTOS.map((n) => `${n.id}: ${n.descricao}`).join("; ") },
    { chave: "direcao.observacao", rotulo: "Observação para o site", tipo: "texto_longo" as const, valorAtual: observacao, dica: "o que o site deve priorizar ou evitar, em 1 a 3 frases", maximo: 1500 },
  ];

  const motivo = !totalDeSecoes ? "O mapa precisa de ao menos uma seção" : poucos ? "Escolha um estilo ou 3 atributos" : null;
  useBarraDaEtapa(
    { estado: salvando ? "Salvando" : pendentes.length ? `Não salvo: ${pendentes.join(", ")}` : `${totalDeSecoes} seções · ${dna.atributos.length} atributos`, motivo, ocupado: salvando, salvar: true, nadaASalvar: !pendentes.length },
    { antesDeSeguir: () => gravarTudo(true), aoSalvar: () => gravarTudo(false) },
  );

  const resumoDoAjuste = `${rotuloDe(MOVIMENTOS, dna.movimento)} · ${rotuloDe(NIVEIS, dna.nivel)} · ${dna.atributos.length} atributos · ${estilo.motion.length} ${estilo.motion.length === 1 ? "movimento" : "movimentos"}`;

  return (
    <div className="min-w-0 space-y-6" data-etapa-direcao="">
      <EditorDoMapa site={site} mapa={mapa} onMapa={setMapa} />

      <PresetsDeEstilo site={site} preset={estilo.preset} onPreset={escolherPreset} mudou={mudouEstilo}>
        {/* O ajuste fino (DNA, movimento e nível) recolhido de início, com o resumo à vista: nada muda escondido. */}
        <Secao
          nivel={3}
          titulo="Ajuste fino"
          resumo={resumoDoAjuste}
          descricao={dnaSalvo && dnaSalvo.fonte === "jev" && !mudouDirecao ? "Sugerido pelas referências" : undefined}
          recolher="mesa-site:direcao:ajuste-fino"
          recolhidaDeInicio
          divisoria
          className="mt-4"
        >
          <GradeDeGrupos colunas={3}>
            <GrupoDeFuncoes titulo={`DNA · ${dna.atributos.length} de ${MIN_ATRIBUTOS} a ${MAX_ATRIBUTOS}`}>
              <div className="flex flex-wrap" role="group" aria-label="Atributos do DNA">
                {ATRIBUTOS_DO_DNA.map((a) => {
                  const ligado = dna.atributos.indexOf(a.id) >= 0;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      aria-pressed={ligado}
                      title={a.descricao}
                      onClick={() => alternar(a.id)}
                      className={juntar(etiqueta, "mb-2 mr-2 h-7 px-2.5 text-[12px]", ligado ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
                    >
                      {a.rotulo}
                    </button>
                  );
                })}
              </div>
              {dnaSalvo && Array.isArray(dnaSalvo.cores_das_referencias) && dnaSalvo.cores_das_referencias.length > 0 && (
                <div className="flex min-w-0 items-center">
                  <span className={juntar(texto.auxiliar, "mr-2")}>Cores das referências</span>
                  {dnaSalvo.cores_das_referencias.slice(0, 8).map((c: string) => (
                    <span key={c} className="mr-1 inline-block h-4 w-4 rounded-sm border border-border" style={{ background: c }} title={c} />
                  ))}
                </div>
              )}
            </GrupoDeFuncoes>
            <GrupoDeFuncoes titulo="Movimento" ajuda="O movimento base guia o texto e o motor; os presets de movimento (até 3) usam só o kit livre e respeitam o movimento reduzido.">
              <SeletorCompacto rotulo="Movimento base" opcoes={MOVIMENTOS.map((m) => ({ valor: m.id, rotulo: m.rotulo, descricao: m.descricao }))} valor={dna.movimento} onEscolher={(v) => mudarDna({ movimento: v })} larguraTotal />
              <div className="mt-2 flex flex-wrap" role="group" aria-label="Presets de movimento">
                {PRESETS_DE_MOTION.map((m) => {
                  const ligado = estilo.motion.indexOf(m.id) >= 0;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      aria-pressed={ligado}
                      title={`${m.descricao} (${m.pecas.join(", ")})`}
                      onClick={() => alternarMotion(m.id)}
                      className={juntar(etiqueta, "mb-2 mr-2 h-7 px-2.5 text-[12px]", ligado ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-muted/70")}
                    >
                      {m.rotulo}
                    </button>
                  );
                })}
              </div>
            </GrupoDeFuncoes>
            <GrupoDeFuncoes titulo="Referência de nível">
              <SeletorCompacto rotulo="Referência de nível" opcoes={NIVEIS.map((n) => ({ valor: n.id, rotulo: n.rotulo, descricao: n.descricao }))} valor={dna.nivel} onEscolher={(v) => mudarDna({ nivel: v })} larguraTotal />
            </GrupoDeFuncoes>
          </GradeDeGrupos>
        </Secao>
      </PresetsDeEstilo>

      <Secao
        titulo="Nicho e observação"
        descricao={rotuloDe(NICHOS, dna.nicho)}
        ajuda="A fórmula de 6 blocos: o quê, estrutura, estilo e DNA, movimento, stack e referência de nível. O ✨ propõe nicho, nível, movimento e observação pelo contexto e pelo briefing, com prévia antes de gravar; o resto grava no Salvar ou no Seguir do pé da etapa."
        recolher="mesa-site:direcao:motor"
        acao={<PreencherComIA papel="site" clientId={clientId} marcaId={marca ? marca.id : null} campos={camposDaDirecao} rotulo="Preencher a direção" onAplicar={aplicarDirecao} onDesfazer={aplicarDirecao} />}
      >
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
          <GrupoDeFuncoes titulo="Nicho">
            <SeletorCompacto rotulo="Nicho" opcoes={NICHOS.map((n) => ({ valor: n.id, rotulo: n.rotulo }))} valor={dna.nicho} onEscolher={(v) => mudarDna({ nicho: v })} larguraTotal />
          </GrupoDeFuncoes>
          <CampoComIA
            rotulo="Observação para o site"
            campo={camposDaDirecao[3]}
            onAplicar={(v) => aplicarDirecao({ "direcao.observacao": v })}
            onDesfazer={(a) => aplicarDirecao({ "direcao.observacao": a })}
          >
            <textarea value={observacao} onChange={(e) => setObservacao(e.target.value)} rows={3} maxLength={1500} aria-label="Observação para o site" className={juntar(campoTexto, "min-h-[76px]")} placeholder="Ex.: CTA para o WhatsApp; evitar fundo branco puro" />
          </CampoComIA>
        </div>
      </Secao>
    </div>
  );
}
