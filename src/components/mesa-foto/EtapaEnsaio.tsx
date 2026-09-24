import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera as IconeCamera, ClipboardCheck, Loader2, Lock, Plus, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { Ditado } from "@/components/mesa/Ditado";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeModelo, SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, usd, type Qualidade } from "@/lib/mesa/api";
import { Cartao, ListaCurta, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import SeletorDeGuia from "./SeletorDeGuia";
import {
  AZIMUTES,
  chaveDosEnsaios,
  editarTomada,
  ELEVACOES,
  ENQUADRAMENTOS,
  ESTADOS_DA_TOMADA,
  FINALIDADES,
  FORMATOS,
  gerarTomada,
  guardarEnsaio,
  invalidarFotos,
  MODOS_DA_FOTO,
  mudaAVista,
  partesDaGeracao,
  partesDoPlanejamento,
  planejarEnsaio,
  proporcaoDoFormato,
  receitaServeParaKit,
  resumoDoEnsaio,
  rotuloDaCamera,
  rotuloDoEstadoDoEnsaio,
  rotuloDoPapel,
  rotuloDoTipo,
  tomadasParaGerar,
  useEnsaios,
  useFotos,
  useKits,
  useReceitas,
  type Camera,
  type Ensaio,
  type Guia,
  type KitDeFoto,
  type Receita,
  type Tomada,
} from "./fotoApi";

/**
 * Etapa 4, Ensaio: o diretor de fotografia monta as tomadas a partir do kit,
 * da receita e do contexto do cliente. Tomada que pede evidência que o kit
 * não tem vem bloqueada, com o motivo (tomada_editar confere de novo depois
 * que o kit foi completado). A câmera se escolhe por botões (ângulo, altura,
 * enquadramento) e vai em tomada_gerar, que a grava na tomada. Cada tomada
 * gera uma vez, com o custo antes; sem laço de correção automática: refazer
 * pede uma variação nova. Tomada presa em "gerando" há mais de 6 minutos
 * aparece como falhou e pode gerar de novo.
 */

function ResumoDoKit({ kit }: { kit: KitDeFoto }) {
  const { clientId } = useMesa();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-3" data-resumo-do-kit="">
      <div className="flex min-w-0 flex-wrap">
        {kit.refs.slice(0, 8).map((r) => {
          const f = todas.find((x) => x.id === r.imagem_id);
          return (
            <div key={`${r.imagem_id}-${r.papel}`} className="mb-1 mr-1 w-12" title={rotuloDoPapel(r.papel)}>
              {f ? <MiniaturaDaFoto foto={f} selo={false} /> : <div className="h-12 w-12 rounded-lg bg-muted" />}
              <span className="block truncate text-center text-[9.5px] text-muted-foreground">{rotuloDoPapel(r.papel)}</span>
            </div>
          );
        })}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
        <ListaCurta titulo="Não pode mudar" itens={kit.invariantes} vazio="Nada escrito." />
        <ListaCurta titulo="Lacunas: tomadas que dependem delas ficam bloqueadas" itens={kit.lacunas} vazio="Nenhuma lacuna escrita." tom="alerta" />
      </div>
    </div>
  );
}

function NovoEnsaio({ kits, onPlanejado }: { kits: KitDeFoto[]; onPlanejado: (e: Ensaio) => void }) {
  const { clientId, catalogo } = useMesa();
  const { kitId, escolherKit, irPara } = useMesaFoto();
  const receitas = useReceitas();
  const kit = kitId ? kits.find((k) => k.id === kitId) || null : null;
  const lista = useMemo(() => (receitas.data ? receitas.data.receitas : []), [receitas.data]);
  const combinam = lista.filter((r) => receitaServeParaKit(r, kit ? kit.tipo : null));
  const outras = lista.filter((r) => combinam.indexOf(r) < 0);
  const [receitaId, setReceitaId] = useState<string>("");
  const receita: Receita | null = lista.find((r) => r.id === receitaId) || combinam[0] || null;
  const [fora, setFora] = useState<string[]>([]);
  const [finalidade, setFinalidade] = useState("catalogo");
  const [formatos, setFormatos] = useState<string[]>(["1:1", "4:5"]);
  const [pedido, setPedido] = useState("");
  // "fora" guarda ids de tomada da receita: é o que ensaio_planejar aceita em tomadas_pedidas.
  const tomadas = receita ? receita.tomadas.filter((t) => fora.indexOf(t.id) < 0) : [];

  const idDaReceita = receita ? receita.id : null;
  useEffect(() => setFora([]), [idDaReceita]);

  const alternarFormato = (f: string) => setFormatos((l) => (l.indexOf(f) >= 0 ? (l.length > 1 ? l.filter((x) => x !== f) : l) : l.concat([f])));

  if (!kits.length) {
    return (
      <Vazio
        titulo="Primeiro, um kit"
        acao={
          <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("kits")}>
            Montar kit
          </Button>
        }
      >
        O ensaio parte das fotos que provam como o assunto é. Sem kit, não há o que preservar.
      </Vazio>
    );
  }

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-4">
        <Cartao titulo="Kit do ensaio">
          <Select value={kit && kit.id ? kit.id : ""} onValueChange={(v) => escolherKit(v)}>
            <SelectTrigger className="h-9 min-w-0 text-[12.5px]" aria-label="Kit do ensaio">
              <SelectValue placeholder="Escolha o kit" />
            </SelectTrigger>
            <SelectContent>
              {kits.map((k) => (
                <SelectItem key={String(k.id)} value={String(k.id)}>
                  {k.nome} · {rotuloDoTipo(k.tipo)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {kit && (
            <div className="mt-3">
              <ResumoDoKit kit={kit} />
            </div>
          )}
        </Cartao>

        <Cartao titulo="Receita" dica={receitas.data && receitas.data.fonte === "local" ? "Receitas da pesquisa (a função ainda não respondeu)." : "Direção fotográfica pronta por categoria."}>
          {receitas.isLoading && (
            <p className="flex items-center text-[12px] text-muted-foreground">
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo as receitas...
            </p>
          )}
          <div role="radiogroup" aria-label="Receita" className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
            {combinam.concat(outras).map((r) => {
              const ativa = receita ? receita.id === r.id : false;
              const combina = combinam.indexOf(r) >= 0;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={ativa}
                  onClick={() => setReceitaId(r.id)}
                  className={`min-w-0 rounded-lg border px-3 py-2 text-left transition-colors ${ativa ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"} ${combina ? "" : "opacity-60"}`}
                >
                  <span className="block truncate text-[12.5px] font-semibold">{r.nome}</span>
                  <span className="block text-[11.5px] leading-snug text-muted-foreground">{r.direcao}</span>
                  <span className="mt-0.5 block text-[10.5px] text-muted-foreground">
                    {r.tomadas.length} tomadas{combina ? "" : " · outro tipo de assunto"}
                  </span>
                </button>
              );
            })}
          </div>
          {receita && (
            <div className="mt-3 space-y-1.5">
              <p className="text-[11.5px] text-muted-foreground">Tomadas (toque para tirar):</p>
              <div className="flex min-w-0 flex-wrap">
                {receita.tomadas.map((t) => {
                  const dentro = fora.indexOf(t.id) < 0;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={dentro}
                      onClick={() => setFora((l) => (dentro ? l.concat([t.id]) : l.filter((x) => x !== t.id)))}
                      className={`mb-1.5 mr-1.5 h-7 max-w-full truncate rounded-full border px-2.5 text-[12px] ${dentro ? "border-primary/50 bg-primary/5 text-foreground" : "border-border text-muted-foreground line-through"}`}
                    >
                      {t.nome}
                    </button>
                  );
                })}
              </div>
              {receita.atributos_criticos.length > 0 && <p className="text-[11.5px] text-muted-foreground">Conferência olha: {receita.atributos_criticos.join(", ")}.</p>}
            </div>
          )}
        </Cartao>
      </div>

      <div className="min-w-0 space-y-4">
        <Cartao titulo="Para quê">
          <Pilulas rotulo="Finalidade" opcoes={FINALIDADES} valor={finalidade} onEscolher={setFinalidade} />
          <p className="mb-1 mt-2 text-[11.5px] text-muted-foreground">Formatos</p>
          <div className="flex min-w-0 flex-wrap" role="group" aria-label="Formatos">
            {FORMATOS.map((f) => (
              <button
                key={f.valor}
                type="button"
                aria-pressed={formatos.indexOf(f.valor) >= 0}
                onClick={() => alternarFormato(f.valor)}
                className={`mb-1.5 mr-1.5 h-7 rounded-full border px-2.5 text-[12px] ${formatos.indexOf(f.valor) >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
              >
                {f.rotulo}
              </button>
            ))}
          </div>
          <label className="mt-2 block">
            <span className="mb-1 block text-[11.5px] text-muted-foreground">Pedido ao diretor (opcional)</span>
            <div className="relative">
              <Textarea value={pedido} onChange={(e) => setPedido(e.target.value)} rows={3} placeholder="Ex.: clima de escritório claro, espaço para texto à direita" className="pr-10 text-[12.5px]" aria-label="Pedido ao diretor" />
              <Ditado valor={pedido} onChange={setPedido} className="absolute bottom-1.5 right-1.5" />
            </div>
          </label>
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Planejar {tomadas.length} {tomadas.length === 1 ? "tomada" : "tomadas"}
              </>
            }
            titulo="Ensaio planejado"
            descricao="O diretor de fotografia monta as tomadas com o kit, a receita e o contexto do cliente. Nenhuma imagem é gerada agora."
            className="mt-3 h-9 w-full text-[12.5px]"
            disabled={!kit || !kit.id || !receita || tomadas.length === 0 || !receitaServeParaKit(receita, kit.tipo)}
            partes={() => partesDoPlanejamento(catalogo)}
            executar={() =>
              planejarEnsaio({
                clientId,
                kitId: String(kit && kit.id),
                receitaId: receita ? receita.id : "",
                finalidade,
                formatos,
                pedido,
                tomadasPedidas: fora.length ? tomadas.map((t) => t.id) : [],
              })
            }
            aoConcluir={(data) => {
              if (data && data.ensaio) onPlanejado(data.ensaio);
              if (data && data.estimativa_usd !== null && data.estimativa_usd !== undefined) {
                toast.info(`Gerar todas as tomadas: cerca de ${usd(data.estimativa_usd)}`, { description: "O custo de cada tomada aparece no botão antes de gerar." });
              }
            }}
          />
          {!kit && <p className="mt-2 text-[11.5px] text-muted-foreground">Escolha o kit.</p>}
          {kit && receita && !receitaServeParaKit(receita, kit.tipo) && (
            <p className="mt-2 text-[11.5px] text-warning">A receita {receita.nome} não serve para kit de {rotuloDoTipo(kit.tipo).toLowerCase()}. Escolha uma receita em destaque.</p>
          )}
        </Cartao>
      </div>
    </div>
  );
}

/**
 * Câmera por botões. A escolha fica na tela até gerar: tomada_gerar leva a
 * câmera e a função a grava na tomada (modo e bloqueio recalculados lá).
 * "Câmera do plano" volta para a câmera que o diretor planejou.
 */
function SeletorDeCamera({
  camera,
  planejada,
  onMudar,
  disabled,
}: {
  camera: Camera | null;
  planejada: Camera | null;
  onMudar: (c: Camera | null) => void;
  disabled?: boolean;
}) {
  const base: Camera = camera || planejada || { azimute: 0, elevacao: 0, enquadramento: "medio" };
  return (
    <div className={`min-w-0 space-y-1.5 ${disabled ? "pointer-events-none opacity-60" : ""}`} data-camera="">
      <div className="flex min-w-0 flex-wrap items-center">
        <button
          type="button"
          aria-pressed={!camera}
          onClick={() => onMudar(null)}
          className={`mb-1.5 mr-1.5 h-7 rounded-full border px-2.5 text-[11.5px] ${!camera ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
        >
          Câmera do plano
        </button>
        <span className="mb-1.5 text-[11px] text-muted-foreground">ou escolha:</span>
      </div>
      <Pilulas rotulo="Ângulo" opcoes={AZIMUTES.map((a) => ({ valor: a.graus, rotulo: a.rotulo }))} valor={base.azimute} onEscolher={(v) => onMudar({ ...base, azimute: v })} />
      <Pilulas rotulo="Altura da câmera" opcoes={ELEVACOES.map((e) => ({ valor: e.graus, rotulo: e.rotulo }))} valor={base.elevacao} onEscolher={(v) => onMudar({ ...base, elevacao: v })} />
      <Pilulas rotulo="Enquadramento" opcoes={ENQUADRAMENTOS} valor={base.enquadramento} onEscolher={(v) => onMudar({ ...base, enquadramento: v })} />
    </div>
  );
}

function CartaoDaTomada({
  tomada,
  camera,
  onCamera,
  gerando,
  modeloId,
  qualidade,
  onGerar,
}: {
  tomada: Tomada;
  /** Câmera escolhida na tela (null: a do plano). */
  camera: Camera | null;
  onCamera: (c: Camera | null) => void;
  gerando: boolean;
  modeloId: string;
  qualidade: Qualidade;
  onGerar: () => Promise<any>;
}) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const { irPara, ensaioId } = useMesaFoto();
  const [abrirCamera, setAbrirCamera] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const ultima = tomada.versoes.length ? tomada.versoes[tomada.versoes.length - 1] : null;
  const bloqueada = tomada.status === "bloqueada";
  const aprovada = tomada.versoes.some((v) => v.aprovada);
  // "gerando" gravado pela função (outra aba ou outra pessoa) também trava o botão.
  const emGeracao = gerando || tomada.status === "gerando";
  const estado = emGeracao ? ESTADOS_DA_TOMADA.gerando : ESTADOS_DA_TOMADA[tomada.status] || ESTADOS_DA_TOMADA.pendente;
  const angulo = camera ? mudaAVista(camera) : tomada.modo === "angulo";

  /** tomada_editar sem mudar nada: a função remonta a tomada com o kit de agora e recalcula o bloqueio. */
  const conferirDeNovo = async () => {
    if (!ensaioId) return;
    setConferindo(true);
    try {
      const r = await editarTomada(ensaioId, tomada.id, { nome: tomada.nome });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      const nova = r.tomada;
      if (nova && nova.status !== "bloqueada") toast.success("Tomada liberada", { description: "O kit agora tem a evidência que faltava." });
      else toast.info("Ainda bloqueada", { description: (nova && nova.motivo_bloqueio) || tomada.motivo_bloqueio || "Falta evidência no kit." });
    } catch (e) {
      avisarErro(e, "Não conferida");
    } finally {
      setConferindo(false);
    }
  };
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-3" data-tomada={tomada.id}>
      <div className="grid min-w-0 grid-cols-[88px_minmax(0,1fr)] gap-3 sm:grid-cols-[120px_minmax(0,1fr)]">
        <div className="min-w-0">
          <Moldura proporcao={proporcaoDoFormato(tomada.formato)} className="border border-border">
            {ultima && ultima.storage_path ? (
              <div className="h-full w-full" style={emGeracao ? { filter: "blur(10px)", WebkitFilter: "blur(10px)" } : undefined}>
                <ImagemDaMesa caminho={ultima.storage_path} alt={`${tomada.nome}, versão ${ultima.versao}`} className="h-full w-full" />
              </div>
            ) : (
              <span className="flex h-full w-full items-center justify-center p-1 text-center text-[10.5px] text-muted-foreground">
                {bloqueada ? <Lock className="h-4 w-4" /> : <IconeCamera className="h-4 w-4" />}
              </span>
            )}
            {emGeracao && (
              <span className="absolute inset-0 flex items-center justify-center" aria-live="polite">
                <span className="inline-flex items-center rounded-full bg-card px-2 py-1 text-[11px] font-medium shadow-sm">
                  <span className="mr-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Gerando
                </span>
              </span>
            )}
          </Moldura>
          {ultima && <p className="mt-1 text-center text-[10.5px] text-muted-foreground">v{ultima.versao} · gerada</p>}
        </div>
        <div className="min-w-0 space-y-1.5">
          <div className="flex min-w-0 flex-wrap items-center">
            <p className="mr-2 min-w-0 truncate text-[13px] font-semibold">{tomada.nome}</p>
            <span className={`mr-1.5 rounded-full px-1.5 py-px text-[10.5px] font-medium ${estado.cor}`}>{estado.rotulo}</span>
            <span className="rounded-full border border-border px-1.5 py-px text-[10.5px] text-muted-foreground" title={MODOS_DA_FOTO[tomada.modo].dica}>
              {MODOS_DA_FOTO[tomada.modo].rotulo}
            </span>
          </div>
          {bloqueada && (
            <p className="flex items-start rounded-lg bg-warning/10 px-2 py-1.5 text-[11.5px] leading-snug">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {tomada.motivo_bloqueio || "Falta evidência no kit para esta tomada."} Complete o kit para liberar.{" "}
                {ensaioId && (
                  <button type="button" className="font-medium text-primary hover:underline disabled:opacity-60" onClick={() => void conferirDeNovo()} disabled={conferindo}>
                    {conferindo ? "Conferindo..." : "Já completei, conferir de novo"}
                  </button>
                )}
              </span>
            </p>
          )}
          {tomada.status === "falhou" && !gerando && (
            <p className="flex items-start rounded-lg bg-destructive/10 px-2 py-1.5 text-[11.5px] leading-snug" data-falhou="">
              <AlertTriangle className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <span className="min-w-0 [overflow-wrap:anywhere]">{tomada.ultimo_erro || "A geração falhou."} Pode gerar de novo.</span>
            </p>
          )}
          <p className="text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">
            {rotuloDaCamera(camera || tomada.camera)} · {tomada.formato}
            {tomada.luz ? ` · luz: ${tomada.luz}` : ""}
            {tomada.cenario ? ` · cenário: ${tomada.cenario}` : ""}
          </p>
          {angulo && (
            <p className="text-[11px] leading-snug text-primary">Novo ângulo: partes que não aparecem nas fotos serão criadas. Fica marcada como gerada, sem garantia de fidelidade.</p>
          )}
          {(tomada.invariantes.length > 0 || tomada.pode_mudar.length > 0) && (
            <p className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
              {tomada.invariantes.length > 0 && <>Fica: {tomada.invariantes.join(", ")}. </>}
              {tomada.pode_mudar.length > 0 && <>Pode mudar: {tomada.pode_mudar.join(", ")}.</>}
            </p>
          )}
          {!bloqueada && (
            <>
              <button type="button" className="text-[11.5px] font-medium text-primary hover:underline" onClick={() => setAbrirCamera(!abrirCamera)} aria-expanded={abrirCamera}>
                {abrirCamera ? "Fechar câmera" : "Mudar a câmera"}
              </button>
              {abrirCamera && <SeletorDeCamera camera={camera} planejada={tomada.camera} onMudar={onCamera} disabled={emGeracao} />}
            </>
          )}
          <div className="flex min-w-0 flex-wrap items-center pt-0.5">
            {!bloqueada && !aprovada && (
              <BotaoComCusto
                rotulo={
                  ultima ? (
                    <>
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Nova variação
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar
                    </>
                  )
                }
                titulo={ultima ? "Variação gerada" : "Tomada gerada"}
                descricao="Gera uma versão desta tomada, uma vez. Refazer pede uma variação nova."
                variant={ultima ? "outline" : "default"}
                className="mb-1 mr-1.5 h-8 text-[12px]"
                disabled={emGeracao || !modeloId}
                partes={() => partesDaGeracao(modeloId, qualidade)}
                executar={onGerar}
              />
            )}
            {tomada.versoes.length > 0 && ensaioId && (
              <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" onClick={() => irPara("revisar", { ensaio: ensaioId })}>
                <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" /> Revisar {tomada.versoes.length > 1 ? `(${tomada.versoes.length})` : ""}
              </Button>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function EnsaioAberto({ ensaio, kit }: { ensaio: Ensaio; kit: KitDeFoto | null }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const receitas = useReceitas();
  const receita = receitas.data ? receitas.data.receitas.find((r) => r.id === ensaio.receita_id) || null : null;
  const padrao = padraoPara(catalogo, "imagem");
  const [modeloId, setModeloId] = useState("");
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [guia, setGuia] = useState<Guia>({ modo: "nenhum" });
  const [cameras, setCameras] = useState<Record<string, Camera | null>>({});
  const [gerando, setGerando] = useState<Record<string, boolean>>({});
  const modelo = modeloId || (padrao ? padrao.id : "");
  const pendentes = tomadasParaGerar(ensaio).filter((t) => !t.versoes.length);
  const resumo = resumoDoEnsaio(ensaio);
  const finalidade = FINALIDADES.find((f) => f.valor === ensaio.finalidade);

  const gerarUma = async (t: Tomada) => {
    setGerando((g) => ({ ...g, [t.id]: true }));
    try {
      const r = await gerarTomada({
        ensaioId: ensaio.id,
        tomadaId: t.id,
        modeloImagemId: modelo,
        qualidade,
        // A câmera escolhida nos botões vai junto; a função a grava na tomada.
        camera: cameras[t.id] || null,
        guia,
      });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      else void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
      invalidarFotos(queryClient, clientId);
      // A câmera escolhida agora é a da tomada (a função gravou).
      setCameras((m) => ({ ...m, [t.id]: null }));
      return r;
    } catch (e) {
      // Falha do gerador fica escrita na tomada (status falhou): relê o ensaio.
      void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
      throw e;
    } finally {
      setGerando((g) => ({ ...g, [t.id]: false }));
    }
  };

  /** Uma de cada vez, em ordem; para na primeira falha (as feitas ficam). */
  const gerarTodas = async () => {
    let custo = 0;
    let feitas = 0;
    for (const t of pendentes) {
      try {
        const r = await gerarUma(t);
        custo += Number((r && r.custo_usd) || 0);
        feitas++;
      } catch (e) {
        atualizarCusto();
        avisarErro(e, `Parou em "${t.nome}"`);
        break;
      }
    }
    return { custo_usd: custo, feitas };
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center">
          <p className="mr-auto min-w-0 text-[12.5px] text-muted-foreground">
            <span className="font-semibold text-foreground">{receita ? receita.nome : ensaio.receita_id || "Ensaio"}</span>
            {finalidade ? ` · ${finalidade.rotulo}` : ""} · {ensaio.formatos.join(", ") || "1:1"} · {rotuloDoEstadoDoEnsaio(ensaio.status)} · {resumo.aprovadas} de {resumo.total} aprovadas
            {resumo.bloqueadas ? ` · ${resumo.bloqueadas} bloqueadas` : ""}
          </p>
        </div>
        {ensaio.tomadas.length === 0 ? (
          <Vazio titulo="Este ensaio não tem tomadas">O diretor não montou tomadas. Planeje de novo com outra receita ou complete o kit.</Vazio>
        ) : (
          <ul className="space-y-2">
            {ensaio.tomadas.map((t) => (
              <CartaoDaTomada
                key={t.id}
                tomada={t}
                camera={cameras[t.id] || null}
                onCamera={(c) => setCameras((m) => ({ ...m, [t.id]: c }))}
                gerando={!!gerando[t.id]}
                modeloId={modelo}
                qualidade={qualidade}
                onGerar={() => gerarUma(t)}
              />
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0 space-y-4">
        {kit && (
          <Cartao titulo={`Kit: ${kit.nome}`}>
            <ResumoDoKit kit={kit} />
          </Cartao>
        )}
        <Cartao titulo="Guia">
          <SeletorDeGuia guia={guia} onMudar={setGuia} />
        </Cartao>
        <Cartao titulo="Gerar">
          <div className="grid min-w-0 grid-cols-2 gap-2">
            <SeletorDeModelo catalogo={catalogo} tipo="imagem" valor={modelo} onChange={setModeloId} qualidade={qualidade} />
            <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
          </div>
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {pendentes.length} {pendentes.length === 1 ? "tomada" : "tomadas"}, uma por vez
              </>
            }
            titulo="Tomadas geradas"
            descricao="Gera cada tomada ainda sem versão, em ordem. Bloqueadas ficam de fora. Sem correção automática: você revisa e decide."
            className="mt-3 h-9 w-full text-[12.5px]"
            disabled={!pendentes.length || !modelo || Object.keys(gerando).some((k) => gerando[k])}
            partes={() => partesDaGeracao(modelo, qualidade, pendentes.length)}
            executar={gerarTodas}
            fecharAoConfirmar
            aoConcluir={(data) => {
              const n = Number((data && data.feitas) || 0);
              if (n) toast.success(`${n} ${n === 1 ? "tomada gerada" : "tomadas geradas"}`, { description: `Custo real: ${usd(Number((data && data.custo_usd) || 0))}. Agora é revisar.` });
            }}
          />
          <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Continue trabalhando enquanto gera: cada tomada mostra o próprio andamento.</p>
        </Cartao>
      </div>
    </div>
  );
}

export default function EtapaEnsaio() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const { ensaioId, escolherEnsaio, kitId, escolherKit } = useMesaFoto();
  const kits = useKits(clientId);
  const ensaios = useEnsaios(clientId);
  const listaDeKits = useMemo(() => kits.data || [], [kits.data]);
  const lista = useMemo(() => ensaios.data || [], [ensaios.data]);
  const [novo, setNovo] = useState(false);
  const ensaio = !novo && ensaioId ? lista.find((e) => e.id === ensaioId) || null : null;
  const kitDoEnsaio = ensaio && ensaio.kit_id ? listaDeKits.find((k) => k.id === ensaio.kit_id) || null : null;
  const receitas = useReceitas();
  const nomeDaReceita = (id: string) => {
    const r = receitas.data ? receitas.data.receitas.find((x) => x.id === id) : null;
    return r ? r.nome : id || "Ensaio";
  };

  // O ensaio aberto puxa o kit dele para a barra.
  useEffect(() => {
    if (ensaio && ensaio.kit_id && ensaio.kit_id !== kitId) escolherKit(ensaio.kit_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ensaio ? ensaio.id : null]);

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <div className="flex min-w-0 flex-wrap items-center">
        <Select
          value={ensaio ? ensaio.id : ""}
          onValueChange={(v) => {
            setNovo(false);
            escolherEnsaio(v);
          }}
        >
          <SelectTrigger className="mb-1.5 mr-2 h-9 w-full min-w-0 text-[12.5px] sm:w-[340px]" aria-label="Ensaio aberto">
            <SelectValue placeholder={lista.length ? "Abrir um ensaio" : "Nenhum ensaio ainda"} />
          </SelectTrigger>
          <SelectContent>
            {lista.map((e) => {
              const k = listaDeKits.find((x) => x.id === e.kit_id);
              return (
                <SelectItem key={e.id} value={e.id}>
                  {nomeDaReceita(e.receita_id)}
                  {k ? ` · ${k.nome}` : ""} · {rotuloDoEstadoDoEnsaio(e.status)}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {(ensaio || lista.length > 0) && (
          <Button
            type="button"
            size="sm"
            variant={ensaio ? "outline" : "default"}
            className="mb-1.5 h-9 text-[12.5px]"
            onClick={() => {
              setNovo(true);
              escolherEnsaio(null);
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo ensaio
          </Button>
        )}
      </div>
      {(kits.isError || ensaios.isError) && <AvisoDeErro erro={kits.error || ensaios.error} />}
      {kits.isLoading ? (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo kits e ensaios...
        </p>
      ) : ensaio ? (
        <EnsaioAberto key={ensaio.id} ensaio={ensaio} kit={kitDoEnsaio} />
      ) : (
        <NovoEnsaio
          kits={listaDeKits}
          onPlanejado={(e) => {
            guardarEnsaio(queryClient, clientId, e);
            setNovo(false);
            escolherEnsaio(e.id);
          }}
        />
      )}
    </div>
  );
}
