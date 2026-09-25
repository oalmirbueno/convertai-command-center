import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, Check, CheckCheck, Copy, Eye, ImagePlus, Layers, Loader2, ScanSearch, Sparkles, Wand2, X } from "lucide-react";
import { Ampliar } from "@/components/mesa/Ampliar";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import { BotaoComCusto, useAvisarErro, useEstimativa } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { QUALIDADES, usd, type Qualidade } from "@/lib/mesa/api";
import { AprovarFoto, BotoesDeUso } from "../AcoesDeUso";
import { useMesaFoto } from "../Comuns";
import { acrescentarFotos, FORMATOS, invalidarFotos, partesDaConferencia, partesDaConversa, type FotoDoAcervo } from "../fotoApi";
import { motoresDaRodada, rotuloDoMotor, useAndamentos, type ConferenciaDaPersona, type Resolucao } from "../modelosApi";
import {
  ACOES_DO_RESULTADO,
  aprovarSePreciso,
  avisosDoGerar,
  bloqueiosDoGerar,
  conferirGeracao,
  enderecoDaMesa,
  entradasDoGerar,
  faltaNoCartao,
  montarCanvas,
  OPCOES_DE_CARROSSEL,
  partesDaSerie,
  partesDoResultado,
  POSES_DO_RESULTADO,
  ROTULOS_DAS_ENTRADAS,
  TIPOS_DE_NO,
  VARIACOES_POR_VEZ,
  type Canvas,
  type DadosDoNo,
  type Montagem,
  type NoDoCanvas,
  type ResultadoDoCanvas,
} from "../canvasApi";
import { andamentoDoResultado } from "./geracao";
import { BOTAO, CAMPO, descrever, Escolha, MiniaturaGrande, pilula, ROTULO, type Fontes } from "./comum";

/**
 * Editores do Canvas v3 (painel lateral preto e modo lista): cartão (com os
 * modos do Ambiente e a autorização da Pessoa real), ajustes do Resultado
 * (ação, pose, carrossel, motores compactos, formato, qualidade, resolução),
 * fotos do Resultado (aprovar, conferir, variações, usar, finalizar).
 */

export const FORMATOS_DO_CANVAS = FORMATOS.filter((f) => ["1:1", "4:5", "9:16", "16:9"].indexOf(f.valor) >= 0).map((f) => ({ valor: f.valor, rotulo: f.valor }));
const RESOLUCOES_DO_CANVAS: { valor: string; rotulo: string }[] = [
  { valor: "auto", rotulo: "Automática" },
  { valor: "1K", rotulo: "1K" },
  { valor: "2K", rotulo: "2K" },
  { valor: "4K", rotulo: "4K" },
];

// ------------------------------------------------------------------ usar na Mesa e finalizar (1 clique)

/**
 * BUG do dono (25/09): "Usar na mesa não deixa". Agora é 1 clique: aprova se
 * ainda não foi aprovada e abre o Estúdio da Mesa com a foto (&fotos=), que
 * já abre a ferramenta Fotos. Finalizar = aprovar e abrir o Usar da Mesa Foto.
 */
export function useUsoDoResultado(fotos: FotoDoAcervo[]) {
  const { clientId } = useMesa();
  const { irPara } = useMesaFoto();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState<"" | "usar" | "finalizar">("");

  const preparar = async (r: ResultadoDoCanvas): Promise<string | null> => {
    const id = r.imagem_id;
    if (!id) return null;
    const foto = fotos.find((f) => f.id === id) || null;
    const nova = await aprovarSePreciso(clientId, id, !!(foto && foto.aprovada));
    if (nova) acrescentarFotos(queryClient, clientId, [nova]);
    if (nova || !foto) invalidarFotos(queryClient, clientId);
    return id;
  };

  const usarNaMesa = async (r: ResultadoDoCanvas) => {
    if (ocupado) return;
    setOcupado("usar");
    try {
      const id = await preparar(r);
      if (id) navigate(enderecoDaMesa(clientId, [id]));
    } catch (e) {
      avisarErro(e, "Não deu para mandar à Mesa");
    } finally {
      setOcupado("");
    }
  };

  const finalizar = async (r: ResultadoDoCanvas) => {
    if (ocupado) return;
    setOcupado("finalizar");
    try {
      const id = await preparar(r);
      if (id) {
        toast.success("Foto finalizada", { description: "Aprovada pela equipe e aberta no Usar: Mesa, Mesa Ads, baixar ou mandar ao cliente." });
        irPara("usar", { imagem: id });
      }
    } catch (e) {
      avisarErro(e, "Não deu para finalizar");
    } finally {
      setOcupado("");
    }
  };

  return { usarNaMesa, finalizar, ocupado };
}

// ------------------------------------------------------------------ cartão

export function EditorDoCartao({
  no,
  fontes,
  onMudar,
  onEscolher,
  onAgente,
}: {
  no: NoDoCanvas;
  fontes: Fontes;
  onMudar: (dados: Partial<DadosDoNo>) => void;
  onEscolher: () => void;
  /** Ambiente: o agente escreve a descrição pelo contexto (IA, custo à vista). */
  onAgente?: () => Promise<unknown>;
}) {
  const { catalogo } = useMesa();
  const d = no.dados;
  const desc = descrever(no, fontes);
  const tipo = TIPOS_DE_NO[no.tipo];
  if (no.tipo === "texto") {
    return (
      <div className="min-w-0 space-y-2">
        <Escolha
          rotulo="Papel do texto"
          opcoes={[
            { valor: "pedido", rotulo: "Pedido" },
            { valor: "restricao", rotulo: "Restrição" },
          ]}
          valor={d.papel || "pedido"}
          onEscolher={(v) => onMudar({ papel: v as "pedido" | "restricao" })}
        />
        <textarea value={d.texto || ""} onChange={(e) => onMudar({ texto: e.target.value })} rows={5} placeholder="Ex.: ela usando o óculos, sorrindo de leve, luz de fim de tarde" aria-label="Texto do pedido" className={CAMPO} />
        <p className="text-[11px] text-zinc-400">{d.papel === "restricao" ? "Restrição: o que não pode aparecer ou mudar." : "Pedido: a cena em palavras, do jeito que você falaria."}</p>
      </div>
    );
  }
  const temImagem = !!(d.imagem_id || d.biblioteca_id);
  const falta = faltaNoCartao(no);
  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex min-w-0 items-center rounded-xl border border-white/10 bg-zinc-900/60 p-2">
        <span className="relative block shrink-0 overflow-hidden rounded-lg bg-zinc-900" style={{ width: 52, height: 52 }}>
          <MiniaturaGrande m={desc.miniatura} alt={desc.titulo} />
        </span>
        <div className="ml-2.5 min-w-0 flex-1">
          <p className="truncate text-[12.5px] font-semibold">{desc.titulo}</p>
          <p className={`truncate text-[11px] ${falta ? "text-amber-300" : "text-zinc-400"}`}>{desc.subtitulo}</p>
        </div>
      </div>
      {no.tipo === "ambiente" && (
        <Escolha
          rotulo="Modo do ambiente"
          opcoes={[
            { valor: "foto", rotulo: "Pela foto" },
            { valor: "descrever", rotulo: "Descrever" },
            { valor: "contexto", rotulo: "Pelo contexto" },
          ]}
          valor={d.modo || "descrever"}
          onEscolher={(v) => onMudar({ modo: v as DadosDoNo["modo"] })}
        />
      )}
      {no.tipo === "ambiente" && d.modo === "foto" && (
        <Escolha
          rotulo="Uso da foto do lugar"
          opcoes={[
            { valor: "complementar", rotulo: "Complementar" },
            { valor: "usar", rotulo: "Usar como está" },
          ]}
          valor={d.uso || "complementar"}
          onEscolher={(v) => onMudar({ uso: v as DadosDoNo["uso"] })}
        />
      )}
      <div className="flex min-w-0 flex-wrap items-center">
        {!(no.tipo === "ambiente" && d.modo !== "foto" && !temImagem) && (
          <button type="button" className={`${BOTAO} mb-1 mr-1.5`} onClick={onEscolher} data-trocar-cartao={no.id}>
            <ImagePlus className="mr-1 h-3.5 w-3.5" />
            {(no.tipo === "produto" && d.kit_id) || (no.tipo === "modelo" && (d.modelo_id || d.imagem_id)) || temImagem ? `Trocar ${tipo.rotulo.toLowerCase()}` : `Escolher ${tipo.rotulo.toLowerCase()}`}
          </button>
        )}
        {(no.tipo === "ambiente" || no.tipo === "estilo") && temImagem && (
          <button type="button" className={`${BOTAO} mb-1`} onClick={() => onMudar({ imagem_id: null, biblioteca_id: null })}>
            Tirar a imagem
          </button>
        )}
      </div>
      {no.tipo === "modelo" && !d.modelo_id && d.imagem_id && (
        <label className="flex items-start rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-[11.5px] leading-snug text-amber-100">
          <input type="checkbox" className="mr-2 mt-0.5" checked={!!d.autorizada} onChange={(e) => onMudar({ autorizada: e.target.checked })} aria-label="Tenho autorização desta pessoa" />
          Tenho autorização desta pessoa para usar a imagem dela.
        </label>
      )}
      {(no.tipo === "ambiente" || no.tipo === "estilo") && (
        <textarea
          value={d.texto || ""}
          onChange={(e) => onMudar({ texto: e.target.value })}
          rows={2}
          placeholder={no.tipo === "ambiente" ? (d.modo === "contexto" ? "Vazio: o lugar sai da marca. Ou escreva por cima." : "Descreva o lugar: praia no fim de tarde, loja com balcão claro...") : "Descreva a pegada: céu azul, luz de estúdio fria..."}
          aria-label={no.tipo === "ambiente" ? "Descrição do ambiente" : "Descrição do estilo"}
          className={CAMPO}
        />
      )}
      {no.tipo === "ambiente" && onAgente && (
        <BotaoComCusto
          rotulo={
            <>
              <Wand2 className="mr-1 h-3.5 w-3.5" /> Descrever pelo contexto (agente)
            </>
          }
          titulo="Ambiente pelo contexto"
          descricao="O agente lê a marca, o público e a campanha do cliente e escreve o lugar."
          variant="outline"
          className="h-8 border-white/10 bg-white/5 text-[11.5px] text-zinc-100 hover:bg-white/10"
          partes={() => partesDaConversa(catalogo)}
          executar={onAgente}
        />
      )}
      <p className="text-[11px] leading-snug text-zinc-400">
        {no.tipo === "produto"
          ? "Vão as fotos de identidade do kit, na ordem de prioridade. O produto não muda."
          : no.tipo === "modelo"
            ? d.imagem_id && !d.modelo_id
              ? "Foto real: a mesma pessoa, sem mudar traços. Só com autorização."
              : "Só modelo com âncora escolhida. Vão a âncora e as vistas mais próximas do ângulo."
            : no.tipo === "ambiente"
              ? d.modo === "contexto"
                ? "O lugar sai da marca, do nicho e da campanha do cliente, sem custo."
                : "Pessoas e marcas da foto do lugar não são copiadas."
              : "Só paleta, luz e enquadramento. Nunca vira identidade."}
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ foto do Resultado

export function FotoDoResultado({
  r,
  foto,
  referencias,
  qualidade,
  onConferencia,
  onVariacoes,
}: {
  r: ResultadoDoCanvas;
  foto: FotoDoAcervo | null;
  referencias: number;
  qualidade: Qualidade;
  onConferencia: (c: ConferenciaDaPersona | null) => void;
  onVariacoes: (r: ResultadoDoCanvas) => Promise<unknown>;
}) {
  const { catalogo } = useMesa();
  const uso = useUsoDoResultado(foto ? [foto] : []);
  const [ampliada, setAmpliada] = useState(false);
  const caminho = r.storage_path || r.url;
  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-zinc-900/60 p-2" data-resultado={r.geracao_id}>
      <div className="flex min-w-0 items-start">
        <button type="button" className="block shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-white/10 bg-zinc-900" style={{ width: 64, height: 80 }} onClick={() => setAmpliada(true)} aria-label="Ver grande">
          <MiniaturaDoStorage bucket={r.storage_bucket} caminho={caminho} alt="Foto do Canvas" largura={200} className="h-full w-full" />
        </button>
        <div className="ml-2 min-w-0 flex-1">
          <p className="flex items-center text-[12px] font-semibold">
            <span className="min-w-0 truncate">{rotuloDoMotor(catalogo, r.motor_id)}</span>
            <span className="ml-1.5 inline-flex shrink-0 items-center rounded-full border border-emerald-400/40 px-1.5 py-px text-[9.5px] font-semibold text-emerald-300" data-selo="gerada">
              gerada
            </span>
            {r.tipo !== "foto" && <span className="ml-1 shrink-0 text-[10px] text-zinc-400">{r.tipo === "carrossel" ? `carrossel ${r.quadro || ""}` : "variação"}</span>}
          </p>
          <p className="text-[10.5px] text-zinc-400">{r.custo_usd ? `${usd(r.custo_usd)} · ` : ""}no acervo</p>
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
            {foto && <AprovarFoto foto={foto} />}
            <BotaoComCusto
              rotulo={
                <>
                  <ScanSearch className="mr-1 h-3.5 w-3.5" /> Conferir
                </>
              }
              titulo="Conferência pronta"
              descricao="A visão compara com o produto (formato, cor, logo) e com a âncora da modelo. Só aviso."
              variant="outline"
              className="mb-1.5 mr-1.5 h-8 text-[12px]"
              partes={() => partesDaConferencia(catalogo)}
              executar={() => conferirGeracao(r.geracao_id)}
              aoConcluir={(data) => onConferencia(data ? data.conferencia : null)}
            />
            {r.imagem_id && (
              <BotaoComCusto
                rotulo={
                  <>
                    <Copy className="mr-1 h-3.5 w-3.5" /> Variações desta
                  </>
                }
                titulo="Variações desta foto"
                descricao={`${VARIACOES_POR_VEZ} fotos com a mesma pessoa, o mesmo produto e o mesmo estilo, cada uma num ângulo diferente.`}
                variant="outline"
                className="mb-1.5 mr-1.5 h-8 text-[12px]"
                fecharAoConfirmar
                partes={() => partesDaSerie(r.motor_id, qualidade, referencias, VARIACOES_POR_VEZ, true)}
                executar={() => onVariacoes(r)}
              />
            )}
          </div>
          {r.imagem_id && (
            <div className="flex min-w-0 flex-wrap items-center">
              <button type="button" className={`${BOTAO} mb-1.5 mr-1.5`} disabled={!!uso.ocupado} onClick={() => void uso.usarNaMesa(r)} title="Aprova (se precisar) e abre o Estúdio da Mesa com esta foto">
                {uso.ocupado === "usar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <ArrowUpRight className="mr-1 h-3 w-3" />} Usar na Mesa
              </button>
              <button type="button" className={`${BOTAO} mb-1.5`} disabled={!!uso.ocupado} onClick={() => void uso.finalizar(r)} title="Aprova (se precisar) e abre o Usar">
                {uso.ocupado === "finalizar" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCheck className="mr-1 h-3 w-3" />} Finalizar
              </button>
            </div>
          )}
        </div>
      </div>
      {foto && (
        <div className="mt-1">
          <BotoesDeUso fotos={[foto]} compacto />
        </div>
      )}
      {r.conferencia && (
        <div className="mt-1 rounded-md border border-white/10 p-2 text-[11px] leading-snug" data-conferencia="">
          <p className="mb-0.5 font-medium text-zinc-400">Conferência (aviso, você decide)</p>
          {r.conferencia.alertas.map((a) => (
            <p key={a} className="text-amber-300 [overflow-wrap:anywhere]">
              {a}
            </p>
          ))}
          {r.conferencia.pontos.map((p) => (
            <p key={p.criterio} className={p.ok === false ? "text-amber-300" : "text-zinc-400"}>
              {p.ok === false ? "Atenção" : "Ok"}: {p.criterio}
              {p.nota ? `, ${p.nota}` : ""}
            </p>
          ))}
        </div>
      )}
      <Ampliar imagens={[{ caminho, bucket: r.storage_bucket, titulo: "Resultado do Canvas (gerada)", legenda: "Imagem gerada por IA" }]} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(false)} />
    </div>
  );
}

// ------------------------------------------------------------------ o que vai ao gerador

export function PedidoMontado({ m, fotos, onFechar }: { m: Montagem; fotos: FotoDoAcervo[]; onFechar: () => void }) {
  return (
    <div className="min-w-0 rounded-xl border border-emerald-400/30 bg-zinc-900/60 p-2.5" data-pedido-montado="">
      <div className="mb-2 flex min-w-0 items-center">
        <p className="min-w-0 flex-1 text-[12px] font-semibold">O que vai para o gerador</p>
        {m.estimativa_usd !== null && <span className="mr-2 text-[11px] text-zinc-400">~{usd(m.estimativa_usd)} por foto</span>}
        <button type="button" onClick={onFechar} aria-label="Fechar o que vai ao gerador" className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>
      {m.referencias.length > 0 && (
        <ol className="mb-2 flex min-w-0 flex-wrap" aria-label="Referências na ordem">
          {m.referencias.map((r) => {
            const f = r.imagem_id ? fotos.find((x) => x.id === r.imagem_id) || null : null;
            const caminho = r.storage_path || (f ? f.storage_path : "") || r.url;
            return (
              <li key={`${r.ordem}-${r.imagem_id || r.origem_id}`} className="mb-1.5 mr-1.5 w-12" title={r.legenda || r.papel}>
                <span className="relative block overflow-hidden rounded-md bg-zinc-900" style={{ width: 48, height: 48 }}>
                  {caminho ? <MiniaturaDoStorage bucket={r.storage_bucket || (f ? f.storage_bucket : "mesa")} caminho={caminho} alt={r.legenda || r.papel} largura={160} className="h-full w-full" /> : null}
                  <span className="absolute left-0.5 top-0.5 rounded-full bg-zinc-950/85 px-1 text-[9.5px] font-semibold text-white">{r.ordem}</span>
                </span>
                <span className="mt-0.5 block truncate text-[10px] text-zinc-400">{r.papel || r.origem_tipo}</span>
              </li>
            );
          })}
        </ol>
      )}
      {m.cortadas > 0 && <p className="mb-1 text-[11px] text-amber-300">{m.cortadas} {m.cortadas === 1 ? "referência ficou" : "referências ficaram"} de fora pelo limite do motor.</p>}
      {m.avisos.map((a) => (
        <p key={a} className="mb-1 text-[11px] text-amber-300 [overflow-wrap:anywhere]">
          {a}
        </p>
      ))}
      <pre className="nowheel max-h-56 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-lg bg-zinc-900/70 p-2 text-[11px] leading-relaxed text-zinc-200 [overflow-wrap:anywhere]">{m.prompt || "A função não devolveu o texto do pedido."}</pre>
    </div>
  );
}

/** Custo de uma geração do Resultado (uma foto por motor, ou o carrossel inteiro), sempre à vista. */
export function CustoDoResultado({ canvas, no, curto = false }: { canvas: Canvas; no: NoDoCanvas | null; curto?: boolean }) {
  const motores = no ? no.dados.motores || [] : [];
  const partes = no && motores.length ? partesDoResultado(no, entradasDoGerar(canvas, no.id).length) : null;
  const { data, isLoading } = useEstimativa(partes);
  if (!no) return null;
  if (!motores.length) return <span className="text-amber-300">sem motor</span>;
  if (isLoading || data === undefined) return <span className="text-zinc-400">estimando</span>;
  const fotos = no.dados.carrossel ? no.dados.carrossel : motores.length;
  return curto ? (
    <span data-custo-do-resultado="">~{usd(data)}</span>
  ) : (
    <span data-custo-do-resultado="">
      ~{usd(data)} por geração{fotos > 1 ? ` (${fotos} fotos)` : ""}
    </span>
  );
}

// ------------------------------------------------------------------ ajustes do Resultado

export function AjustesDoResultado({
  canvas,
  no,
  fontes,
  onMudar,
  garantirSalvo,
  comGerar,
  onGerar,
  onVariacoes,
}: {
  canvas: Canvas;
  no: NoDoCanvas;
  fontes: Fontes;
  onMudar: (dados: Partial<DadosDoNo>) => void;
  garantirSalvo: () => Promise<Canvas | null>;
  comGerar: boolean;
  onGerar: (gerarId: string) => Promise<Record<string, never>>;
  onVariacoes: (gerarId: string, r: ResultadoDoCanvas) => Promise<unknown>;
}) {
  const { catalogo } = useMesa();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const { opcoes } = useMemo(() => motoresDaRodada(catalogo), [catalogo]);
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const [montando, setMontando] = useState(false);
  const [todosOsMotores, setTodosOsMotores] = useState(false);
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDaPersona | null>>({});
  const d = no.dados;
  const motores = d.motores || [];
  const qualidade: Qualidade = d.qualidade || "alta";
  const formato = d.formato || "4:5";
  const entradas = entradasDoGerar(canvas, no.id);
  const bloqueios = bloqueiosDoGerar(canvas, no.id, fontes.personas);
  const avisos = avisosDoGerar(canvas, no.id, fontes.personas);
  const resultados = (d.resultados || []).slice().reverse();
  const { gerando, falhas } = andamentoDoResultado(andamentos, no.id);
  const alternar = (id: string) => onMudar({ motores: motores.indexOf(id) >= 0 ? motores.filter((x) => x !== id) : motores.concat([id]) });
  const visiveis = todosOsMotores ? opcoes : opcoes.filter((o) => motores.indexOf(o.id) >= 0 || o.padrao);

  const montar = async () => {
    if (montando || !motores.length) return;
    setMontando(true);
    try {
      const salvo = await garantirSalvo();
      if (!salvo || !salvo.id) throw new Error("Salve o canvas antes de ver o que vai ao gerador.");
      setMontagem(await montarCanvas({ canvasId: salvo.id, gerarId: no.id, motorId: motores[0], qualidade }));
    } catch (e) {
      avisarErro(e, "Não deu para montar o que vai ao gerador");
    } finally {
      setMontando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3.5" data-ajustes-do-resultado={no.id}>
      <div className="min-w-0">
        <p className={ROTULO}>Ação</p>
        <Escolha rotulo="Ação do Resultado" opcoes={ACOES_DO_RESULTADO} valor={d.acao || "livre"} onEscolher={(v) => onMudar({ acao: v })} />
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Pose e intenção</p>
        <Escolha rotulo="Pose do Resultado" opcoes={POSES_DO_RESULTADO} valor={d.pose || "nenhuma"} onEscolher={(v) => onMudar({ pose: v })} />
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>Saída</p>
        <Escolha
          rotulo="Saída do Resultado"
          opcoes={OPCOES_DE_CARROSSEL.map((n) => ({ valor: String(n), rotulo: n ? `Carrossel ${n}` : "Foto", dica: n ? `${n} fotos coerentes (mesma pessoa, produto e lugar), ângulo diferente em cada, no primeiro motor.` : "Uma foto por motor ligado." }))}
          valor={String(d.carrossel || 0)}
          onEscolher={(v) => onMudar({ carrossel: Number(v) })}
        />
      </div>
      <div className="min-w-0">
        <div className="mb-1.5 flex items-center">
          <p className={`${ROTULO} mb-0 flex-1`}>Motores {d.carrossel ? "(o carrossel usa o 1º)" : "(uma foto por motor)"}</p>
          <button type="button" className="text-[10.5px] text-zinc-400 hover:text-white" onClick={() => setTodosOsMotores(!todosOsMotores)}>
            {todosOsMotores ? "Só os principais" : "Ver todos"}
          </button>
        </div>
        <div className="flex min-w-0 flex-wrap" role="group" aria-label="Motores do Resultado">
          {visiveis.map((o) => {
            const ligado = motores.indexOf(o.id) >= 0;
            const a = gerando.concat(falhas).find((x) => x.motor === o.id);
            return (
              <button key={o.id} type="button" role="switch" aria-checked={ligado} onClick={() => alternar(o.id)} className={pilula(ligado)} title={a && a.a.estado === "falhou" ? a.a.erro : undefined}>
                {ligado && <Check className="mr-1 h-3 w-3 text-emerald-300" />}
                {o.rotulo}
                {a && a.a.estado === "gerando" && <Loader2 className="ml-1 h-3 w-3 animate-spin" />}
                {a && a.a.estado === "falhou" && <span className="ml-1 text-red-400">falhou</span>}
              </button>
            );
          })}
        </div>
        {falhas.map((x) => (
          <p key={x.chave} className="text-[11px] text-red-400 [overflow-wrap:anywhere]" role="alert">
            {rotuloDoMotor(catalogo, x.motor)}: {x.a.erro}
          </p>
        ))}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-2">
        <div className="min-w-0">
          <p className={ROTULO}>Formato</p>
          <Escolha rotulo="Formato do Resultado" opcoes={FORMATOS_DO_CANVAS} valor={formato} onEscolher={(v) => onMudar({ formato: v })} />
        </div>
        <div className="min-w-0">
          <p className={ROTULO}>Qualidade</p>
          <Escolha rotulo="Qualidade do Resultado" opcoes={QUALIDADES.map((q) => ({ valor: q.valor, rotulo: q.rotulo }))} valor={qualidade} onEscolher={(v) => onMudar({ qualidade: v as Qualidade })} />
        </div>
        <div className="min-w-0">
          <p className={ROTULO}>Resolução</p>
          <Escolha rotulo="Resolução do Resultado" opcoes={RESOLUCOES_DO_CANVAS} valor={d.resolucao || "auto"} onEscolher={(v) => onMudar({ resolucao: v === "auto" ? null : (v as Resolucao) })} />
        </div>
      </div>
      <div className="flex min-w-0 items-center rounded-lg border border-white/10 bg-zinc-900/60 px-2.5 py-1.5 text-[12px]">
        <span className="min-w-0 flex-1 text-zinc-400">Custo</span>
        <span className="font-semibold">
          <CustoDoResultado canvas={canvas} no={no} />
        </span>
      </div>
      <div className="min-w-0">
        <p className={ROTULO}>O que o Resultado junta, na ordem</p>
        {entradas.length === 0 ? (
          <p className="text-[11.5px] text-zinc-400">Nada ainda. Ponha um produto ou uma pessoa pela barra à esquerda.</p>
        ) : (
          <ol className="min-w-0 space-y-1" aria-label="Entradas do Resultado">
            {entradas.map((e) => (
              <li key={e.ligacao.id} className="flex min-w-0 items-center text-[11.5px]">
                <span className="mr-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-semibold">{e.numero}</span>
                <span className="mr-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: TIPOS_DE_NO[e.no.tipo].cor }} />
                <span className="min-w-0 flex-1 truncate">
                  {ROTULOS_DAS_ENTRADAS[e.entrada]}: {descrever(e.no, fontes).titulo}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
      {bloqueios.length > 0 && (
        <ul className="space-y-0.5" aria-label="O que falta para gerar">
          {bloqueios.map((b) => (
            <li key={b} className="text-[11.5px] text-amber-300">
              {b}
            </li>
          ))}
        </ul>
      )}
      {avisos.map((a) => (
        <p key={a} className="text-[11.5px] text-zinc-400">
          {a}
        </p>
      ))}
      <div className="flex min-w-0 flex-wrap items-center">
        <button type="button" className={`${BOTAO} mb-1.5 mr-1.5 h-8`} disabled={montando || !motores.length || entradas.length === 0} onClick={() => void montar()}>
          {montando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Eye className="mr-1.5 h-3.5 w-3.5" />} Ver o que vai ao gerador
        </button>
        {comGerar && (
          <BotaoComCusto
            rotulo={
              <>
                {d.carrossel ? <Layers className="mr-1.5 h-3.5 w-3.5" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                {d.carrossel ? `Gerar carrossel de ${d.carrossel}` : motores.length > 1 ? `Gerar em ${motores.length} motores` : "Gerar foto"}
              </>
            }
            titulo="Geração do Canvas"
            descricao="O que sair entra no acervo, marcado como gerado, e aparece no Resultado."
            className="mb-1.5 h-9 text-[12.5px]"
            disabled={bloqueios.length > 0 || gerando.length > 0}
            fecharAoConfirmar
            partes={() => partesDoResultado(no, entradas.length)}
            executar={() => onGerar(no.id)}
          />
        )}
      </div>
      {montagem && <PedidoMontado m={montagem} fotos={fontes.fotos} onFechar={() => setMontagem(null)} />}
      {resultados.length > 0 && (
        <div className="min-w-0 space-y-2">
          <p className={ROTULO}>Fotos deste Resultado ({resultados.length})</p>
          {resultados.slice(0, 8).map((r) =>
            r.status === "falhou" ? (
              <p key={r.geracao_id} className="text-[11.5px] text-red-400">
                {rotuloDoMotor(catalogo, r.motor_id)}: {r.erro || "falhou"}
              </p>
            ) : (
              <FotoDoResultado
                key={r.geracao_id}
                r={conferencias[r.geracao_id] !== undefined ? { ...r, conferencia: conferencias[r.geracao_id] } : r}
                foto={r.imagem_id ? fontes.fotos.find((f) => f.id === r.imagem_id) || null : null}
                referencias={entradas.length}
                qualidade={qualidade}
                onVariacoes={(x) => onVariacoes(no.id, x)}
                onConferencia={(c) => {
                  setConferencias({ ...conferencias, [r.geracao_id]: c });
                  onMudar({ resultados: (d.resultados || []).map((x) => (x.geracao_id === r.geracao_id ? { ...x, conferencia: c } : x)) });
                }}
              />
            ),
          )}
        </div>
      )}
    </div>
  );
}
