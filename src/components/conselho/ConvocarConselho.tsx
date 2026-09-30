import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Paperclip, Save, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCatalogo } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoDeErro, Carregando } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { dataEHora, modeloDoPapel, textoDoErro, usd } from "@/lib/mesa/api";
import {
  convocarConselho,
  type ElencoSalvo,
  estimarConselho,
  lerCatalogoDoConselho,
  listarElencos,
  type ModoDoConselho,
  NOME_DO_NIVEL,
  NOME_DO_STATUS,
  type PresetDoConselho,
  ROTULO_DO_MODO,
  rodadasDoModo,
  salvarElenco,
  type SessaoDoConselho,
  useSessoesDoConselho,
} from "@/lib/conselho/api";

/**
 * Convocar o conselho (frente CNS, 30/09; ampliado na frente BRF2): tema e
 * pergunta (o tema vem da mesa de onde a Sala abriu), um preset por tema
 * (marca, campanha, proposta, site, crise) ou um elenco salvo, quem entra, o
 * modelo de cada um (ou todos com o mesmo), o modo (rápido: 1 rodada e a
 * síntese, barato; padrão; profundo: as 4 rodadas com mais espaço), a pauta
 * com anexos do cliente e o teto de custo. O custo estimado aparece antes,
 * sem IA; o teto sugerido é a estimativa com folga, e a pessoa pode mudar.
 */

const MAX_ANEXOS = 5;

type ArquivoDaPauta = { id: string; file_name: string; folder: string | null; created_at: string };

export default function ConvocarConselho({
  clientId,
  origem,
  temaInicial,
  contextoInicial,
  referencia,
  onAbrir,
}: {
  clientId: string;
  origem: string;
  temaInicial: string;
  contextoInicial?: string;
  referencia?: Record<string, unknown> | null;
  onAbrir: (sessaoId: string) => void;
}) {
  const qc = useQueryClient();
  const catalogoDoConselho = useQuery({
    queryKey: ["conselho", "catalogo", origem],
    queryFn: () => lerCatalogoDoConselho(origem),
    staleTime: 10 * 60_000,
  });
  const catalogoDeModelos = useCatalogo();
  const sessoes = useSessoesDoConselho(clientId);
  const elencos = useQuery({ queryKey: ["conselho", "elencos", clientId], queryFn: () => listarElencos(clientId), staleTime: 60_000 });

  const chave = `conselho:${origem}:${clientId}`;
  // Tema e contexto vêm da tela de onde a Sala abriu (sempre os de agora); a pergunta é rascunho e fica guardada.
  const [tema, setTema] = useState(temaInicial);
  const [pergunta, setPergunta] = useEstadoDaTela<string>(`${chave}:pergunta`, "");
  const [contexto, setContexto] = useState(contextoInicial || "");
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [modelos, setModelos] = useState<Record<string, string>>({});
  const [rodadas, setRodadas] = useState("4");
  const [modo, setModo] = useState<ModoDoConselho>("padrao");
  const [criterios, setCriterios] = useState<string[]>([]);
  const [preset, setPreset] = useState<PresetDoConselho["id"] | null>(null);
  const [pautaTexto, setPautaTexto] = useState("");
  const [anexos, setAnexos] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [nomeDoElenco, setNomeDoElenco] = useState("");
  const [daAgencia, setDaAgencia] = useState(false);
  const [salvandoElenco, setSalvandoElenco] = useState(false);
  const [teto, setTeto] = useState<string>("");
  const [tetoMexido, setTetoMexido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const arquivos = useQuery({
    queryKey: ["conselho", "arquivos-da-pauta", clientId],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ArquivoDaPauta[]> => {
      const { data, error } = await supabase.from("files").select("id, file_name, folder, created_at").eq("client_id", clientId).is("archived_at" as any, null).order("created_at", { ascending: false }).limit(60);
      if (error) throw error;
      return (data as unknown as ArquivoDaPauta[]) || [];
    },
  });

  const cat = catalogoDoConselho.data;
  // O elenco sugerido pela origem até a pessoa mexer.
  const ids = useMemo(() => escolhidos || (cat ? cat.padrao : []), [escolhidos, cat]);
  // Papel "conselho" do catálogo (frente BASE); o servidor manda o mesmo padrão.
  const padraoNaTela = modeloDoPapel(catalogoDeModelos.data || [], "conselho");
  const padraoDoModelo = (cat && cat.modelo_padrao) || (padraoNaTela ? padraoNaTela.id : "");
  const modelosEfetivos = useMemo(() => {
    const r: Record<string, string> = {};
    ids.forEach((id) => {
      const escolhido = modelos[id] ? modeloDoPapel(catalogoDeModelos.data || [], "conselho", modelos[id]) : null;
      r[id] = (escolhido && escolhido.id === modelos[id] ? modelos[id] : "") || padraoDoModelo;
    });
    return r;
  }, [ids, modelos, padraoDoModelo, catalogoDeModelos.data]);
  const todosIguais = ids.length > 0 && ids.every((id) => modelosEfetivos[id] === modelosEfetivos[ids[0]]);
  const rodadasEfetivas = rodadasDoModo(modo, Number(rodadas));

  const min = cat ? cat.limites.min_especialistas : 2;
  const max = cat ? cat.limites.max_especialistas : 6;
  const podeEstimar = !!cat && ids.length >= min && ids.length <= max && ids.every((id) => !!modelosEfetivos[id]);
  const estimativa = useQuery({
    queryKey: ["conselho", "estimar", clientId, origem, ids.join(","), JSON.stringify(modelosEfetivos), rodadasEfetivas, modo],
    enabled: podeEstimar,
    queryFn: () => estimarConselho({ clientId, origem, especialistas: ids, modelos: modelosEfetivos, rodadas: rodadasEfetivas, modo }),
    staleTime: 60_000,
  });
  const total = estimativa.data ? estimativa.data.estimativa.total_usd : null;

  // Teto sugerido acompanha a estimativa até a pessoa digitar o dela.
  useEffect(() => {
    if (!tetoMexido && estimativa.data) setTeto(String(estimativa.data.teto_sugerido_usd));
  }, [estimativa.data, tetoMexido]);

  const alternar = (id: string) => {
    const atual = ids.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length < max) atual.push(id);
    setEscolhidos(atual);
  };

  const usarPreset = (p: PresetDoConselho) => {
    setPreset(p.id);
    setEscolhidos(p.especialistas.slice(0, max));
    setCriterios(p.criterios);
    setModo(p.modo);
    setRodadas(String(p.rodadas));
    if (!pergunta.trim()) setPergunta(p.pergunta);
    if (!tema.trim() || tema === temaInicial) setTema(`${p.tema}${temaInicial ? `: ${temaInicial}` : ""}`.slice(0, 300));
  };

  const usarElenco = (e: ElencoSalvo) => {
    setPreset(e.preset);
    setEscolhidos(e.especialistas.slice(0, max));
    setModelos(e.modelos || {});
    setCriterios(e.criterios || []);
    setModo(e.modo);
    setRodadas(String(e.rodadas));
  };

  const guardarElenco = async () => {
    setSalvandoElenco(true);
    try {
      await salvarElenco({ clientId, nome: nomeDoElenco.trim(), especialistas: ids, modelos: modelosEfetivos, criterios, rodadas: rodadasEfetivas, modo, preset, daAgencia });
      toast.success(daAgencia ? "Elenco salvo para a agência toda." : "Elenco salvo para este cliente.");
      setNomeDoElenco("");
      void qc.invalidateQueries({ queryKey: ["conselho", "elencos", clientId] });
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível salvar o elenco."));
    } finally {
      setSalvandoElenco(false);
    }
  };

  const tetoNumero = Number(String(teto).replace(",", "."));
  const tetoBaixo = total !== null && isFinite(tetoNumero) && tetoNumero < total;
  const pronto = podeEstimar && tema.trim().length >= 3 && pergunta.trim().length >= 3 && total !== null && isFinite(tetoNumero) && tetoNumero > 0 && !tetoBaixo;
  const itensDaPauta = pautaTexto.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2).slice(0, 8);

  const convocar = async () => {
    if (!pronto || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const r = await convocarConselho({
        clientId,
        origem,
        referencia: referencia || null,
        tema: tema.trim(),
        pergunta: pergunta.trim(),
        contexto: contexto.trim(),
        especialistas: ids,
        modelos: modelosEfetivos,
        rodadas: rodadasEfetivas,
        teto_usd: tetoNumero,
        modo,
        criterios,
        pauta: itensDaPauta.length || anexos.length ? { itens: itensDaPauta, anexos } : null,
      });
      setPergunta("");
      void sessoes.refetch();
      onAbrir(r.sessao.id);
    } catch (e) {
      // O pedido fica no campo: nada se perde.
      setErro(textoDoErro(e));
    } finally {
      setEnviando(false);
    }
  };

  if (catalogoDoConselho.isLoading) return <Carregando forma="aba" rotulo="Abrindo o conselho" />;
  if (catalogoDoConselho.isError || !cat) {
    return <EstadoDeErro titulo="O conselho não abriu." descricao={textoDoErro(catalogoDoConselho.error)} acao={<button type="button" className={botao.secundario} onClick={() => void catalogoDoConselho.refetch()}>Tentar de novo</button>} />;
  }

  const anteriores = (sessoes.data || []) as SessaoDoConselho[];
  const listaDeElencos = elencos.data || [];
  const arquivosFiltrados = (arquivos.data || []).filter((a) => !busca.trim() || a.file_name.toLowerCase().indexOf(busca.trim().toLowerCase()) >= 0).slice(0, 12);

  return (
    <div className="min-w-0 space-y-6" data-convocar-conselho="">
      <Secao
        titulo="Convocar"
        recolher={false}
        ajuda="Cada especialista responde sozinho, depois critica os outros com nota de 1 a 10, revisa e o Jev mede o consenso. Rápido: 1 rodada de propostas e a síntese do moderador (barato). Profundo: as 4 rodadas, com mais espaço. O número de rodadas é fixo e o custo nunca passa do teto."
      >
        <div className="min-w-0 space-y-4">
          {cat.presets && cat.presets.length > 0 && (
            <div className="min-w-0">
              <span className={texto.rotulo}>Começar por um tema</span>
              <div className="-m-1 mt-1 flex flex-wrap" role="group" aria-label="Presets do conselho">
                {cat.presets.map((p) => (
                  <button key={p.id} type="button" aria-pressed={preset === p.id} onClick={() => usarPreset(p)} className={juntar(botao.barra, "m-1 border border-border", preset === p.id && "border-primary bg-primary/10 text-foreground")} data-preset={p.id}>
                    {p.nome}
                  </button>
                ))}
                {listaDeElencos.length > 0 && (
                  <select className={juntar(campo, "m-1 h-8 w-auto")} value="" onChange={(e) => { const x = listaDeElencos.find((l) => l.id === e.target.value); if (x) usarElenco(x); }} aria-label="Elenco salvo">
                    <option value="">Elenco salvo...</option>
                    {listaDeElencos.map((l) => <option key={l.id} value={l.id}>{l.nome}{l.client_id ? "" : " (agência)"}</option>)}
                  </select>
                )}
              </div>
            </div>
          )}

          <GrupoDeCampos colunas={1}>
            <CampoDeFormulario rotulo="Tema">
              <input className={campo} value={tema} maxLength={300} onChange={(e) => setTema(e.target.value)} aria-label="Tema" />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Pergunta">
              <textarea
                className={campoTexto}
                value={pergunta}
                maxLength={4000}
                rows={3}
                placeholder="O que o conselho precisa decidir?"
                onChange={(e) => setPergunta(e.target.value)}
                aria-label="Pergunta"
              />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Contexto da mesa" ajuda="O que a mesa já mostrou. O retrato do cliente (cérebro, dossiê e decisões anteriores) entra sozinho.">
              <textarea className={campoTexto} value={contexto} maxLength={8000} rows={2} onChange={(e) => setContexto(e.target.value)} aria-label="Contexto da mesa" />
            </CampoDeFormulario>
          </GrupoDeCampos>

          <div className="min-w-0">
            <div className="flex items-center justify-between">
              <span className={texto.rotulo}>Especialistas</span>
              <span className={texto.auxiliar}>{ids.length} de {max}</span>
            </div>
            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3" role="group" aria-label="Quem entra no conselho">
              {cat.especialistas.map((e) => {
                const dentro = ids.indexOf(e.id) >= 0;
                return (
                  <button
                    key={e.id}
                    type="button"
                    aria-pressed={dentro}
                    title={`${e.visao}. Critério: ${e.criterio}.`}
                    onClick={() => alternar(e.id)}
                    disabled={!dentro && ids.length >= max}
                    className={juntar(
                      "toque-compacto min-w-0 rounded-md border px-3 py-2 text-left transition-colors disabled:opacity-50",
                      dentro ? "border-primary bg-primary/10" : "border-border hover:bg-muted",
                    )}
                    data-especialista={e.id}
                  >
                    <span className="block truncate text-[13px] font-medium text-foreground">{e.nome}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">{e.area}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {ids.length > 0 && (
            <div className="min-w-0 space-y-3">
              <div className="sm:max-w-[360px]">
                <SeletorDeModelo
                  catalogo={catalogoDeModelos.data || []}
                  tipo="texto"
                  rotulo="Todos com o mesmo modelo"
                  valor={todosIguais ? modelosEfetivos[ids[0]] || "" : ""}
                  onChange={(m) => {
                    const r: Record<string, string> = {};
                    ids.forEach((id) => (r[id] = m));
                    setModelos(r);
                  }}
                />
              </div>
              <GrupoDeCampos colunas={3}>
                {ids.map((id) => {
                  const e = cat.especialistas.find((x) => x.id === id);
                  return (
                    <SeletorDeModelo
                      key={id}
                      catalogo={catalogoDeModelos.data || []}
                      tipo="texto"
                      rotulo={e ? e.nome : id}
                      valor={modelosEfetivos[id] || ""}
                      onChange={(m) => setModelos((x) => ({ ...x, [id]: m }))}
                    />
                  );
                })}
              </GrupoDeCampos>
            </div>
          )}

          <div className="grid min-w-0 grid-cols-1 items-end gap-4 sm:grid-cols-3">
            <CampoDeFormulario rotulo="Modo" ajuda="Rápido: 1 rodada de propostas e a síntese do moderador, respostas curtas. Padrão: você escolhe as rodadas. Profundo: as 4 rodadas, com mais espaço e raciocínio.">
              <SeletorCompacto
                rotulo="Modo"
                valor={modo}
                onEscolher={(v) => setModo(v as ModoDoConselho)}
                opcoes={(["rapido", "padrao", "profundo"] as ModoDoConselho[]).map((m) => ({ valor: m, rotulo: ROTULO_DO_MODO[m] }))}
              />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Rodadas" ajuda="2: propostas e consolidação. 3: com crítica cruzada. 4: com crítica e revisão.">
              {modo === "padrao" ? (
                <SeletorCompacto
                  rotulo="Rodadas"
                  valor={rodadas}
                  onEscolher={setRodadas}
                  opcoes={[
                    { valor: "2", rotulo: "2" },
                    { valor: "3", rotulo: "3" },
                    { valor: "4", rotulo: "4" },
                  ]}
                />
              ) : (
                <p className={juntar(texto.corpo, "flex h-9 items-center")}>{rodadasEfetivas} pelo modo</p>
              )}
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Teto (US$)" erro={tetoBaixo ? `Abaixo do custo estimado (${usd(total)}).` : undefined}>
              <input
                className={campo}
                inputMode="decimal"
                value={teto}
                onChange={(e) => {
                  setTetoMexido(true);
                  setTeto(e.target.value);
                }}
                aria-label="Teto de custo da sessão em dólares"
              />
            </CampoDeFormulario>
          </div>

          <Secao titulo="Pauta e anexos" nivel={3} descricao={itensDaPauta.length || anexos.length ? `${itensDaPauta.length} itens · ${anexos.length} anexos` : "opcional"} recolher={`conselho:pauta:${clientId}`} recolhidaDeInicio>
            <div className="min-w-0 space-y-3">
              <CampoDeFormulario rotulo="Itens da pauta" apoio="Um por linha. O conselho precisa cobrir cada um.">
                <textarea className={campoTexto} value={pautaTexto} rows={3} maxLength={1600} onChange={(e) => setPautaTexto(e.target.value)} aria-label="Itens da pauta" />
              </CampoDeFormulario>
              <div className="min-w-0">
                <div className="flex min-w-0 items-center justify-between">
                  <span className={texto.rotulo}>Anexos do cliente</span>
                  <span className={texto.auxiliar}>{anexos.length} de {MAX_ANEXOS}</span>
                </div>
                <input className={juntar(campo, "mt-1")} value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar arquivo" aria-label="Buscar arquivo para a pauta" />
                {arquivos.isError ? (
                  <p className={juntar(texto.auxiliar, "mt-1 text-destructive")}>{textoDoErro(arquivos.error, "Os arquivos não abriram.")}</p>
                ) : (
                  <ul className={juntar(lista.aberta, lista.divisoria, "mt-1")}>
                    {arquivosFiltrados.map((a) => {
                      const marcado = anexos.indexOf(a.id) >= 0;
                      return (
                        <li key={a.id} className={juntar(lista.linha, "py-1.5")}>
                          <input type="checkbox" id={`pauta-${a.id}`} className="mr-3 h-4 w-4 shrink-0 accent-primary" checked={marcado} disabled={!marcado && anexos.length >= MAX_ANEXOS} onChange={() => setAnexos((l) => (marcado ? l.filter((x) => x !== a.id) : l.concat(a.id)))} />
                          <label htmlFor={`pauta-${a.id}`} className="flex min-w-0 flex-1 cursor-pointer items-center">
                            <Paperclip className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                            <span className="min-w-0 truncate text-[13px] text-foreground">{a.file_name}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </Secao>

          {erro && <p className="text-[13px] text-destructive" role="alert">{erro}</p>}

          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <span className={juntar(texto.auxiliar, "mr-3")} data-estimativa-do-conselho="">
              {estimativa.isFetching ? "Calculando o custo..." : total !== null ? `Custo estimado ${usd(total)}` : estimativa.isError ? textoDoErro(estimativa.error) : ""}
            </span>
            <button type="button" className={botao.primario} disabled={!pronto || enviando} onClick={() => void convocar()}>
              {enviando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <Users className="mr-2 h-4 w-4" aria-hidden="true" />}
              Convocar o conselho
            </button>
          </div>

          <div className="flex min-w-0 flex-wrap items-center justify-end border-t border-border pt-3 [&>*]:mt-1">
            <input className={juntar(campo, "mr-2 h-8 sm:w-56")} value={nomeDoElenco} maxLength={80} onChange={(e) => setNomeDoElenco(e.target.value)} placeholder="Nome do elenco" aria-label="Nome do elenco para salvar" />
            <label className="mr-2 inline-flex items-center text-[12px] text-muted-foreground">
              <input type="checkbox" className="mr-1.5 h-4 w-4 accent-primary" checked={daAgencia} onChange={(e) => setDaAgencia(e.target.checked)} />
              Para a agência toda
            </label>
            <button type="button" className={juntar(botao.secundario, "h-8")} disabled={nomeDoElenco.trim().length < 2 || ids.length < min || salvandoElenco} onClick={() => void guardarElenco()}>
              {salvandoElenco ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Salvar elenco
            </button>
          </div>
        </div>
      </Secao>

      {anteriores.length > 0 && (
        <Secao titulo="Sessões" descricao={`${anteriores.length} deste cliente`} recolher={`conselho:sessoes:${clientId}`}>
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {anteriores.map((s) => (
              <li key={s.id}>
                <button type="button" className={juntar(lista.linha, "w-full text-left")} onClick={() => onAbrir(s.id)} data-sessao-anterior={s.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">{s.tema}</span>
                    <span className="block truncate text-[12px] text-muted-foreground">
                      {dataEHora(s.criado_em)} · {NOME_DO_STATUS[s.status]}
                      {s.resultado ? ` · ${NOME_DO_NIVEL[s.resultado.nivel]}` : ""}
                      {s.decisao && !s.decisao.desfeita_em ? " · decidida" : ""}
                    </span>
                  </span>
                  <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>{usd(s.custo_usd)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Secao>
      )}
    </div>
  );
}
