import { useMemo, useRef, useState } from "react";
import { Crosshair, Loader2, ScanFace, Sparkles, Upload, Zap } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { corPadrao, FORMATOS_DO_PROJETO, type CorDoProjeto } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { chamarEditorVideo, emPreparacao, novoId } from "@/lib/editor/api";
import { fidelidadeDaLut, LOOKS, lookPorId, lutDoArquivo } from "@/lib/editor/cor";
import { EFEITOS_DE_AJUSTE, MODOS_DE_ZOOM, ROTULO_DO_EFEITO, clipeDeZoom, type EfeitoDeAjuste, type ModoDeZoom } from "@/lib/editor/efeitos";
import { comRegraNoResto, custoDoRosto, fontesSemRosto, rastrearRosto } from "@/lib/editor/editarComIa";
import { momentosEmBlocos } from "@/lib/editor/julgarEmBlocos";
import { frasesDoProjeto, notasPorRegra, NOME_DA_TRILHA_DE_AJUSTE, zoomNosMomentosEm } from "@/lib/editor/skills/pecasDaEdicao";
import { trilhaLivre } from "@/lib/editor/motion/aplicar";
import { acharClipe, fimDoClipe } from "@/lib/editor/operacoes";
import { tempoFino } from "@/lib/editor/tempo";
import { aceitaImagem, modelosDoAgente } from "./AgenteEditor";
import PainelDeSkills from "./PainelDeSkills";
import { aplicarMontando, Deslizante, porCento, Subtitulo, TituloDoPainel, type ContextoDoPainel } from "./apoioDosPaineis";

/**
 * Painéis de imagem do editor completo (frente EDT, rodada 2): Formato
 * (reenquadrar 9:16, 1:1, 4:5, 16:9 seguindo o rosto), Cor (looks, correção e
 * LUT) e Zoom e efeitos (momentos fortes pelo Jev, efeito no cursor,
 * punch-in e transições). Tudo sem custo muda na hora, com Ctrl+Z; o que é
 * pago (rastrear o rosto) mostra o custo antes.
 */

// ---------------------------------------------------------------- Formato

export function PainelDeFormato({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const p = ctx.projeto;
  const modelos = useMemo(() => modelosDoAgente(catalogo || []).reduce((l, g) => l.concat(g.modelos), [] as NonNullable<typeof catalogo>).filter(aceitaImagem), [catalogo]);
  const [modeloId, setModeloId] = useState("");
  const modelo = modelos.find((m) => m.id === modeloId) || modelos[0] || null;
  const [andamento, setAndamento] = useState<string | null>(null);
  const parar = useRef(false);
  const sem = fontesSemRosto(p);
  const custo = modelo && sem.length ? custoDoRosto(modelo, p, sem) : 0;
  const principais = Object.keys(p.fontes).filter((k) => p.fontes[k].midia === "video" && p.trilhas.some((t) => t.tipo === "video" && t.clipes.some((c) => c.fonte === k)));

  const rastrear = async () => {
    if (!modelo || !sem.length) return;
    parar.current = false;
    setAndamento("Lendo os quadros");
    try {
      const r = await rastrearRosto(chamarEditorVideo, { clientId, projeto: p, chaves: sem, urls: ctx.urls, modelo, referencia: novoId(), aoAndar: setAndamento, parado: () => parar.current });
      // O que já foi pago entra SEMPRE, mesmo parado ou com falha no meio.
      if (r.ops.length) ctx.onOps(r.ops, "Rosto rastreado");
      atualizarCusto();
      const feito = r.ops.length ? `Rosto rastreado em ${r.ops.length} ${r.ops.length === 1 ? "vídeo" : "vídeos"}` : "Nenhum rosto rastreado";
      const gasto = `${usd(r.custo_usd)}.${r.semRosto.length ? ` Sem rosto: ${r.semRosto.join(", ")}.` : ""}`;
      if (r.erro) {
        const motivo = emPreparacao(r.falha) ? "O rastreio está em preparação: falta publicar a função editor-video." : textoDoErro(r.falha || new Error(r.erro));
        toast.warning(`O rastreio parou no meio. ${feito}`, { description: `${gasto} O que já veio foi aplicado. Motivo: ${motivo}` });
      } else if (r.parado) {
        toast.info(`Parado. ${feito}`, { description: `${gasto} O que já foi rastreado ficou guardado; rastreie de novo para completar.` });
      } else {
        toast.success(r.ops.length ? feito : "Nenhum rosto achado", { description: `${gasto} O recorte agora segue a pessoa.` });
      }
    } catch (e) {
      const t = emPreparacao(e) ? "O rastreio está em preparação: falta publicar a função editor-video." : textoDoErro(e);
      toast.error("O rastreio não terminou", { description: t });
      console.error("[editor] rastreio do rosto", e);
    } finally {
      setAndamento(null);
    }
  };

  return (
    <div data-painel="formato">
      <TituloDoPainel
        titulo="Formato"
        ajuda="Troca o formato do vídeo inteiro (9:16 para Reels e TikTok, 1:1 e 4:5 para o feed, 16:9 para YouTube). O recorte segue o rosto rastreado; num clipe, você pode fixar o foco à mão em Ajustes. Para exportar em vários formatos de uma vez, use Exportar."
      />
      <div className="flex flex-wrap" role="group" aria-label="Formato do vídeo">
        {Object.keys(FORMATOS_DO_PROJETO).map((f) => (
          <button key={f} type="button" className={juntar(p.formato === f ? botao.primario : botao.secundario, "mb-1 mr-1 h-8 px-3")} onClick={() => p.formato !== f && ctx.onOps([{ op: "formato", formato: f }], `Formato ${f}`)} aria-pressed={p.formato === f}>
            {f}
          </button>
        ))}
      </div>
      <label className="mt-2 flex items-center text-[13px]">
        <input type="checkbox" className="mr-2 h-3.5 w-3.5 accent-primary" checked={p.enquadramento.seguir_rosto} onChange={(e) => ctx.onOps([{ op: "enquadramento", campos: { seguir_rosto: e.target.checked } }], e.target.checked ? "Seguir o rosto" : "Recorte no centro")} />
        Seguir o rosto
      </label>
      <div className="mt-2">
        <Deslizante rotulo="Suavidade do acompanhamento" valor={p.enquadramento.suavidade} min={0} max={1} passo={0.05} formatar={(v) => `${Math.round(v * 100)}%`} onMudar={(v) => ctx.onOps([{ op: "enquadramento", campos: { suavidade: v } }], "Suavidade do recorte")} />
      </div>
      <Subtitulo ajuda="Um modelo com imagem olha um quadro a cada 1,5 s de cada vídeo e diz onde está o rosto; o código suaviza (sem tremer) e o recorte acompanha. Pago, com o custo antes. Uma vez rastreado, vale para todos os formatos.">Rosto rastreado</Subtitulo>
      <ul className="divide-y divide-border">
        {principais.map((k) => {
          const r = (p.rostos || {})[k];
          return (
            <li key={k} className="flex min-w-0 items-center py-1.5 text-[13px]">
              <ScanFace className={juntar("mr-2 h-3.5 w-3.5 shrink-0", r ? "text-emerald-500" : "text-muted-foreground")} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{p.fontes[k].nome}</span>
              <span className={juntar(etiqueta, "ml-1 bg-muted text-muted-foreground")}>{r ? `${r.pontos.length} leituras` : "sem rastro"}</span>
              {r && (
                <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[12px]")} onClick={() => ctx.onOps([{ op: "rosto", fonte: k, rastro: null }], "Tirar o rastro do rosto")}>
                  Tirar
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {sem.length > 0 && (
        <div className="mt-2 space-y-2">
          <label className="block">
            <span className={texto.rotulo}>Modelo com imagem</span>
            <select className={juntar(campo, "mt-1 h-8")} value={modelo ? modelo.id : ""} onChange={(e) => setModeloId(e.target.value)} disabled={!modelos.length}>
              {!modelos.length && <option value="">Nenhum modelo com imagem ativo</option>}
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.rotulo || m.modelo_api}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center">
            <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void rastrear()} disabled={!!andamento || !modelo} data-rastrear-rosto="">
              {andamento ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanFace className="mr-1.5 h-3.5 w-3.5" />}
              Rastrear {sem.length === 1 ? "o rosto" : `${sem.length} vídeos`} · até {usd(custo)}
            </button>
            {andamento && (
              <button type="button" className={juntar(botao.discreto, "ml-1 h-8")} onClick={() => (parar.current = true)}>
                Parar
              </button>
            )}
          </div>
          {andamento && <p className={texto.auxiliar}>{andamento}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Cor

export function PainelDeCor({ ctx }: { ctx: ContextoDoPainel }) {
  const p = ctx.projeto;
  const cor = p.cor || corPadrao();
  const arquivo = useRef<HTMLInputElement | null>(null);
  const mudar = (campos: Partial<CorDoProjeto>, rotulo: string) => ctx.onOps([{ op: "cor", campos }], rotulo);

  const lerLut = (f: File | null | undefined) => {
    if (!f) return;
    if (!/\.cube$/i.test(f.name)) return toast.error("Escolha um arquivo .cube (LUT do Premiere, Resolve ou CapCut).");
    if (f.size > 12 * 1024 * 1024) return toast.error("LUT grande demais (mais de 12 MB).");
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const lut = lutDoArquivo(String(leitor.result || ""), f.name);
        mudar({ lut }, `LUT ${lut.nome}`);
        toast.success(`LUT ${lut.nome} aplicada`, { description: `Aproximação ${fidelidadeDaLut(lut.erro)} (erro médio de ${(lut.erro * 100).toFixed(1).replace(".", ",")}%). Ctrl+Z desfaz.` });
      } catch (e) {
        toast.error("Não deu para ler a LUT", { description: e instanceof Error ? e.message : undefined });
      }
    };
    leitor.onerror = () => toast.error("Não deu para ler o arquivo.");
    leitor.readAsText(f);
  };

  const corNoTrecho = () => {
    const alvo = ctx.selecao.length === 1 ? acharClipe(p, ctx.selecao[0]) : null;
    const ini = alvo && alvo.trilha.tipo === "video" ? alvo.clipe.inicio_s : ctx.cursor();
    const fim = alvo && alvo.trilha.tipo === "video" ? fimDoClipe(alvo.clipe) : Math.min(p.duracao_s, ini + 3);
    aplicarMontando(ctx, "Cor do trecho", (m) => {
      if (fim - ini < 0.2) throw new Error("Ponha o cursor dentro do vídeo (ou escolha um clipe).");
      const trilha = trilhaLivre(m, "ajuste", NOME_DA_TRILHA_DE_AJUSTE, ini, fim);
      const { lut: _l, ...resto } = cor;
      m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: ini, entrada_s: 0, saida_s: Math.round((fim - ini) * 1000) / 1000, estilo: { efeito: "cor", params: { ...resto, look: cor.look === "natural" ? "pb" : cor.look } }, origem: { tipo: "manual", ref: "cor do trecho" } } });
      return `Cor própria de ${tempoFino(ini)} a ${tempoFino(fim)} (ajuste o look no clipe, em Ajustes).`;
    });
  };

  return (
    <div data-painel="cor">
      <TituloDoPainel
        titulo="Cor"
        ajuda="Look pronto, correção fina e a LUT (.cube) do cliente, no vídeo inteiro (legenda e texto ficam fora). A LUT vira curvas + matriz de cor: a tela diz quão fiel ficou. Para um trecho com outra cor, use Cor só neste trecho (vira um clipe na camada Câmera e cor)."
      />
      <div className="grid min-w-0 grid-cols-3 gap-1" role="group" aria-label="Looks">
        {LOOKS.map((l) => (
          <button key={l.id} type="button" title={l.quando} className={juntar(cor.look === l.id ? botao.primario : botao.secundario, "h-8 min-w-0 truncate px-1.5 text-[12px]")} onClick={() => cor.look !== l.id && mudar({ look: l.id }, `Look ${l.rotulo}`)} aria-pressed={cor.look === l.id}>
            {l.rotulo}
          </button>
        ))}
      </div>
      <div className="mt-3 space-y-2">
        <Deslizante rotulo={`Força do look${cor.lut ? " e da LUT" : ""}`} valor={cor.intensidade} min={0} max={1} passo={0.05} formatar={(v) => `${Math.round(v * 100)}%`} onMudar={(v) => mudar({ intensidade: v }, "Força do look")} />
        <Deslizante rotulo="Exposição" valor={cor.exposicao} min={-1} max={1} passo={0.02} formatar={porCento} onMudar={(v) => mudar({ exposicao: v }, "Exposição")} />
        <Deslizante rotulo="Contraste" valor={cor.contraste} min={-1} max={1} passo={0.02} formatar={porCento} onMudar={(v) => mudar({ contraste: v }, "Contraste")} />
        <Deslizante rotulo="Saturação" valor={cor.saturacao} min={-1} max={1} passo={0.02} formatar={porCento} onMudar={(v) => mudar({ saturacao: v }, "Saturação")} />
        <Deslizante rotulo="Temperatura" valor={cor.temperatura} min={-1} max={1} passo={0.02} formatar={porCento} onMudar={(v) => mudar({ temperatura: v }, "Temperatura")} />
        <Deslizante rotulo="Tinta" valor={cor.tinta} min={-1} max={1} passo={0.02} formatar={porCento} onMudar={(v) => mudar({ tinta: v }, "Tinta")} />
        <Deslizante rotulo="Vinheta" valor={cor.vinheta} min={0} max={1} passo={0.02} formatar={(v) => `${Math.round(v * 100)}`} onMudar={(v) => mudar({ vinheta: v }, "Vinheta")} />
      </div>
      <Subtitulo ajuda="Arquivo .cube de 1D ou 3D (Adobe, DaVinci, CapCut). Fica guardado no projeto como aproximação; o render usa a mesma conta da prévia.">LUT do cliente</Subtitulo>
      {cor.lut ? (
        <div className="flex min-w-0 items-center text-[13px]">
          <span className="min-w-0 flex-1 truncate">{cor.lut.nome}</span>
          <span className={juntar(etiqueta, "ml-1 bg-muted text-muted-foreground")}>{fidelidadeDaLut(cor.lut.erro)}</span>
          <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[12px]")} onClick={() => mudar({ lut: null }, "Tirar a LUT")}>
            Tirar
          </button>
        </div>
      ) : (
        <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => arquivo.current && arquivo.current.click()} data-subir-lut="">
          <Upload className="mr-1.5 h-3.5 w-3.5" />
          Subir LUT (.cube)
        </button>
      )}
      <input ref={arquivo} type="file" accept=".cube" className="hidden" onChange={(e) => {
        lerLut(e.target.files && e.target.files[0]);
        e.target.value = "";
      }} />
      <div className="mt-3 flex flex-wrap border-t border-border pt-3">
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={corNoTrecho}>
          Cor só neste trecho
        </button>
        <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => mudar({ ...corPadrao(), lut: cor.lut }, "Cor natural")} disabled={JSON.stringify({ ...cor, lut: null }) === JSON.stringify(corPadrao())}>
          Voltar ao natural
        </button>
      </div>
      <p className={juntar(texto.auxiliar, "mt-1")}>{lookPorId(cor.look).quando}</p>
    </div>
  );
}

// ---------------------------------------------------------------- Zoom e efeitos

export function PainelDeZoom({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId } = useMesa();
  const p = ctx.projeto;
  const [intensidade, setIntensidade] = useState<"suave" | "media" | "forte">("media");
  const [efeito, setEfeito] = useState<EfeitoDeAjuste>("zoom");
  const [modo, setModo] = useState<ModoDeZoom>("punch");
  const [duracao, setDuracao] = useState(1.5);
  const [julgando, setJulgando] = useState(false);
  const frases = frasesDoProjeto(p);

  const momentosFortes = async () => {
    if (!frases.length) return toast.info("Marque a fala primeiro (Timestamp).");
    setJulgando(true);
    let notas: { k: string; nota: number }[] = [];
    let fonte = "o Jev";
    try {
      const r = await momentosEmBlocos(chamarEditorVideo, { clientId, titulo: p.titulo, frases, forca: true, virais: false });
      notas = comRegraNoResto(frases, r.forca);
      if (r.aviso) {
        fonte = "o Jev e, no resto, a regra da casa";
        toast.warning("Força julgada em parte da fala", { description: r.aviso });
      }
    } catch (e) {
      console.error("[editor] momentos fortes pelo Jev", e);
      notas = notasPorRegra(frases);
      fonte = "a regra da casa";
      toast.info("O julgamento da IA não respondeu: usei a regra da casa.", { description: emPreparacao(e) ? "Falta publicar a editor-video." : textoDoErro(e) });
    } finally {
      setJulgando(false);
    }
    aplicarMontando(ctx, "Zoom nos momentos fortes", (m) => {
      const n = zoomNosMomentosEm(m, frases, notas, intensidade);
      return n ? `${n} ${n === 1 ? "zoom" : "zooms"} nos momentos fortes (julgados por ${fonte}).` : "Nenhuma frase forte o bastante.";
    });
  };

  const porNoCursor = () => {
    const ini = Math.max(0, ctx.cursor());
    const d = Math.max(0.2, Math.min(10, duracao));
    aplicarMontando(ctx, ROTULO_DO_EFEITO[efeito], (m) => {
      const trilha = trilhaLivre(m, "ajuste", NOME_DA_TRILHA_DE_AJUSTE, ini, ini + d);
      if (efeito === "zoom") m.aplicar({ op: "inserir", trilha, clipe: { ...clipeDeZoom(ini, d, intensidade === "forte" ? 1.25 : intensidade === "suave" ? 1.08 : 1.15, modo, "manual"), origem: { tipo: "manual", ref: "efeito" } } });
      else m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: ini, entrada_s: 0, saida_s: d, estilo: { efeito, params: efeito === "cor" ? { look: "pb" } : {} }, origem: { tipo: "manual", ref: "efeito" } } });
      return `${ROTULO_DO_EFEITO[efeito]} em ${tempoFino(ini)} (ajuste no clipe, em Ajustes).`;
    });
  };

  return (
    <div data-painel="zoom">
      <TituloDoPainel titulo="Zoom e efeitos" ajuda="Zoom e punch-in nos momentos fortes, efeitos de câmera (tremor, flash, desfoque) e transições. Os efeitos ficam na camada Câmera e cor da linha do tempo: arraste, estique ou apague como qualquer clipe." />
      <label className="block">
        <span className={texto.rotulo}>Intensidade</span>
        <select className={juntar(campo, "mt-1 h-8")} value={intensidade} onChange={(e) => setIntensidade(e.target.value as "suave" | "media" | "forte")}>
          <option value="suave">Suave (1,08x)</option>
          <option value="media">Média (1,15x)</option>
          <option value="forte">Forte (1,25x)</option>
        </select>
      </label>
      <button type="button" className={juntar(botao.primario, "mt-2 h-8")} onClick={() => void momentosFortes()} disabled={julgando || !frases.length} data-zoom-momentos="">
        {julgando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
        Zoom nos momentos fortes (IA)
      </button>
      {!frases.length && <p className={juntar(texto.auxiliar, "mt-1")}>Precisa da fala marcada (Timestamp).</p>}
      <Subtitulo ajuda="Põe o efeito no cursor, na camada Câmera e cor.">Efeito no cursor</Subtitulo>
      <div className="grid min-w-0 grid-cols-2 gap-2">
        <label className="block min-w-0">
          <span className={texto.rotulo}>Efeito</span>
          <select className={juntar(campo, "mt-1 h-8")} value={efeito} onChange={(e) => setEfeito(e.target.value as EfeitoDeAjuste)}>
            {EFEITOS_DE_AJUSTE.map((x) => (
              <option key={x} value={x}>
                {ROTULO_DO_EFEITO[x]}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Duração (s)</span>
          <input type="number" className={juntar(campo, "mt-1 h-8")} min={0.2} max={10} step={0.1} value={duracao} onChange={(e) => setDuracao(Number(e.target.value) || 1.5)} />
        </label>
      </div>
      {efeito === "zoom" && (
        <label className="mt-2 block">
          <span className={texto.rotulo}>Movimento</span>
          <select className={juntar(campo, "mt-1 h-8")} value={modo} onChange={(e) => setModo(e.target.value as ModoDeZoom)}>
            {MODOS_DE_ZOOM.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" className={juntar(botao.secundario, "mt-2 h-8")} onClick={porNoCursor}>
        {efeito === "zoom" ? <Crosshair className="mr-1.5 h-3.5 w-3.5" /> : <Zap className="mr-1.5 h-3.5 w-3.5" />}
        Pôr no cursor
      </button>
      <Subtitulo>Skills de ritmo</Subtitulo>
      <PainelDeSkills projeto={p} contexto={{ agora: new Date().toISOString(), selecionados: ctx.selecao }} controle={ctx.controle} ids={["punch_in", "zoom_nos_momentos", "transicoes_suaves"]} />
    </div>
  );
}
