import { useMemo, useRef, useState } from "react";
import { Loader2, Music, Play, Plus, Sparkles, Square, Type } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import { mixagemPadrao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { BIBLIOTECA_DE_SONS, caminhoDoSom } from "../../../../supabase/functions/mesa-motion/modulos/som-do-editor";
import { chamarEditorVideo } from "@/lib/editor/api";
import { POSICOES_DE_TEXTO, PRESETS_DE_LEGENDA, PRESETS_DE_TEXTO } from "@/lib/editor/estilosDeTexto";
import { textoEm } from "@/lib/editor/skills/pecasDaEdicao";
import { chaveNoProjeto, fonteDoItem } from "@/lib/editor/biblioteca";
import { fonteDoSom, NOME_DA_TRILHA_DE_EFEITOS, porLogo, porPeca, porTrilha, trilhaLivre } from "@/lib/editor/motion/aplicar";
import { CATALOGO_DE_MOTION, type DefinicaoDaPeca, type IdDaPeca } from "@/lib/editor/motion/catalogo";
import { sugerirAnimacoesNaTela } from "@/lib/editor/geracaoDoAgente";
import { tempoFino } from "@/lib/editor/tempo";
import PainelDeSkills from "./PainelDeSkills";
import { useMarcaDoEditor } from "./PainelEditarComIA";
import { aplicarMontando, Deslizante, Subtitulo, TituloDoPainel, type ContextoDoPainel } from "./apoioDosPaineis";

/**
 * Painéis de texto, som e motion do editor completo (frente EDT, rodada 2):
 * legendas com estilos da marca, títulos e chamadas no cursor; música com
 * ducking e efeitos sonoros CC0; peças de motion no cursor ou sugeridas pela
 * IA na fala. Tudo muda na hora, com Ctrl+Z.
 */

// ---------------------------------------------------------------- Legendas e textos

export function PainelDeTextos({ ctx }: { ctx: ContextoDoPainel }) {
  const p = ctx.projeto;
  const marca = useMarcaDoEditor();
  const [txt, setTxt] = useState("");
  const [preset, setPreset] = useState("titulo");
  const [dur, setDur] = useState(3);
  const legendas = p.trilhas.filter((t) => t.tipo === "legenda").reduce((n, t) => n + t.clipes.length, 0);
  const idAtual = p.identidade;

  const restilizar = (novo: string, posicao?: string) => {
    const ops = p.trilhas
      .filter((t) => t.tipo === "legenda")
      .reduce((l, t) => l.concat(t.clipes.map((c) => ({ op: "propriedades" as const, clipe: c.id, campos: { estilo: { ...(c.estilo || {}), preset: novo, ...(posicao ? { posicao } : {}) } } }))), [] as { op: "propriedades"; clipe: string; campos: { estilo: Record<string, unknown> } }[]);
    if (!ops.length) return toast.info("Ainda não há legenda: gere abaixo.");
    ctx.onOps(ops, "Estilo da legenda");
  };

  return (
    <div data-painel="textos">
      <TituloDoPainel titulo="Legendas e textos" ajuda="Legenda da fala em 10 estilos, com a cor e a letra da marca, e textos na tela: título, gancho, tarjas, marca-texto, balão, vidro, chamada e nome e cargo. A legenda automática desvia do rosto quando ele está embaixo." />
      <div className="flex min-w-0 items-center text-[13px]">
        <span className="min-w-0 flex-1 truncate">Marca: {idAtual && idAtual.nome ? idAtual.nome : "sem marca no vídeo"}</span>
        {idAtual && idAtual.cor && <span className="ml-1 inline-block h-4 w-4 shrink-0 rounded border border-border" style={{ background: idAtual.cor }} title={idAtual.cor} />}
        {idAtual && idAtual.fonte && <span className="ml-1 max-w-[96px] shrink-0 truncate text-[12px] text-muted-foreground" title={`Letra da marca: ${idAtual.fonte}`}>{idAtual.fonte}</span>}
        {marca && (
          <button type="button" className={juntar(botao.discreto, "ml-1 h-7 px-2 text-[12px]")} onClick={() => ctx.onOps([{ op: "identidade", identidade: { nome: marca.nome, cor: marca.cor, cor2: marca.cor2 || null, fonte: marca.fonte || null, ...(marca.fonte && marca.fonte_path ? { fonte_path: marca.fonte_path } : {}) } }], "Identidade da marca")}>
            Usar a da marca aberta
          </button>
        )}
      </div>
      {legendas > 0 && (
        <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className={texto.rotulo}>Estilo das {legendas} legendas</span>
            <select className={juntar(campo, "mt-1 h-8")} value="" onChange={(e) => e.target.value && restilizar(e.target.value)}>
              <option value="">Trocar para...</option>
              {PRESETS_DE_LEGENDA.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.rotulo}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Onde</span>
            <select className={juntar(campo, "mt-1 h-8")} value="" onChange={(e) => {
              if (!e.target.value) return;
              const ops = p.trilhas.filter((t) => t.tipo === "legenda").reduce((l, t) => l.concat(t.clipes.map((c) => ({ op: "propriedades" as const, clipe: c.id, campos: { estilo: { ...(c.estilo || {}), posicao: e.target.value } } }))), [] as { op: "propriedades"; clipe: string; campos: { estilo: Record<string, unknown> } }[]);
              ctx.onOps(ops, "Posição da legenda");
            }}>
              <option value="">Mudar para...</option>
              {POSICOES_DE_TEXTO.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <Subtitulo>Gerar a legenda</Subtitulo>
      <PainelDeSkills projeto={p} contexto={{ agora: new Date().toISOString(), selecionados: ctx.selecao }} controle={ctx.controle} ids={["legendas"]} />
      <Subtitulo ajuda="Entra no cursor, na trilha Textos. Nome e cargo: escreva &quot;Nome | cargo&quot;. Tarjas: separe as linhas com |.">Texto no cursor</Subtitulo>
      <input className={juntar(campo, "h-8")} value={txt} maxLength={200} onChange={(e) => setTxt(e.target.value)} placeholder="Ex.: 3 erros que travam sua venda" />
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
        <select className={juntar(campo, "h-8")} value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Estilo do texto">
          {PRESETS_DE_TEXTO.map((x) => (
            <option key={x.valor} value={x.valor} title={x.quando}>
              {x.rotulo}
            </option>
          ))}
        </select>
        <input type="number" className={juntar(campo, "h-8")} min={0.5} max={20} step={0.5} value={dur} onChange={(e) => setDur(Number(e.target.value) || 3)} aria-label="Duração em segundos" />
      </div>
      <button
        type="button"
        className={juntar(botao.secundario, "mt-2 h-8")}
        disabled={!txt.trim()}
        onClick={() =>
          aplicarMontando(ctx, "Texto", (m) => {
            textoEm(m, txt, ctx.cursor(), dur, preset);
            setTxt("");
            return `Texto em ${tempoFino(ctx.cursor())}.`;
          })
        }
      >
        <Type className="mr-1.5 h-3.5 w-3.5" />
        Pôr no cursor
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- Som

export function PainelDeSom({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId } = useMesa();
  const p = ctx.projeto;
  const arquivosQ = useArquivosDeVideo(clientId);
  const tocador = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState<string | null>(null);
  const mix = p.mixagem || mixagemPadrao();
  const musicasDoProjeto = Object.keys(p.fontes).filter((k) => p.fontes[k].midia === "audio" && p.fontes[k].storage_bucket !== "publico");
  const doAcervo = useMemo(
    () =>
      ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter((a) => a.estado !== "arquivado" && (a.tipo === "audio" || /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(a.storage_path)) && !Object.keys(p.fontes).some((k) => p.fontes[k].storage_path === a.storage_path)),
    [arquivosQ.data, p.fontes],
  );
  const trilhaAtual = p.trilhas.reduce((achou: string | null, t) => achou || (t.tipo === "audio" ? (t.clipes.find((c) => c.estilo && (c.estilo as Record<string, unknown>).papel === "trilha") || { fonte: null }).fonte : null), null);

  const ouvir = (id: string, caminho: string) => {
    if (tocador.current) {
      tocador.current.pause();
      tocador.current = null;
    }
    if (tocando === id) return setTocando(null);
    const a = new Audio(`/${caminho}`);
    tocador.current = a;
    setTocando(id);
    a.onended = () => setTocando(null);
    void a.play().catch(() => setTocando(null));
  };

  const usarComoTrilha = (chave: string | null, item?: (typeof doAcervo)[number]) =>
    aplicarMontando(ctx, "Música", (m) => {
      let k = chave;
      if (!k && item) {
        const it = { id: item.id, arquivo_id: item.so_no_storage ? null : item.id, nome: item.nome, tipo: "audio", storage_bucket: item.storage_bucket, storage_path: item.storage_path, duracao_s: item.duracao_s, largura: null, altura: null, origem: "enviado" as const };
        const c = chaveNoProjeto(m.projeto, it);
        if (c.nova) m.aplicar({ op: "fonte", fonte: fonteDoItem(c.chave, it) });
        k = c.chave;
      }
      if (!k) throw new Error("Escolha uma música.");
      const r = porTrilha(m, k, null);
      return `Música de ${Math.round(r.duracao_s)} s, ${m.projeto.mixagem.trilha_abaixo_da_voz_db} dB abaixo da voz.`;
    });

  const somNoCursor = (id: string) =>
    aplicarMontando(ctx, "Efeito sonoro", (m) => {
      const f = fonteDoSom(id);
      if (!f) throw new Error("Som desconhecido.");
      if (!m.projeto.fontes[f.chave]) m.aplicar({ op: "fonte", fonte: f });
      const ini = Math.max(0, ctx.cursor());
      const d = f.duracao_s || 1;
      const trilha = trilhaLivre(m, "audio", NOME_DA_TRILHA_DE_EFEITOS, ini, ini + d);
      m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: ini, entrada_s: 0, saida_s: d, fonte: f.chave, estilo: { papel: "efeito", som: id }, origem: { tipo: "manual", ref: `som:${id}` } } });
      return `${f.nome.replace("Som: ", "")} em ${tempoFino(ini)}.`;
    });

  return (
    <div data-painel="som">
      <TituloDoPainel titulo="Som" ajuda="Música abaixo da voz (o render mede a voz e a música e deixa a trilha 22 dB abaixo; ela sobe nas pausas longas), efeitos sonoros CC0 no pico das animações e o volume final em -14 LUFS, o padrão das redes." />
      <Subtitulo>Música</Subtitulo>
      {!musicasDoProjeto.length && !doAcervo.length && <p className={texto.auxiliar}>Nenhuma música no projeto nem no acervo. Suba um áudio na Entrada.</p>}
      <ul className="divide-y divide-border">
        {musicasDoProjeto.map((k) => (
          <li key={k} className="flex min-w-0 items-center py-1.5 text-[13px]">
            <Music className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{p.fontes[k].nome}</span>
            {trilhaAtual === k ? <span className={juntar(etiqueta, "bg-primary/10 text-primary")}>trilha</span> : (
              <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => usarComoTrilha(k)}>
                Usar
              </button>
            )}
          </li>
        ))}
        {doAcervo.slice(0, 12).map((a) => (
          <li key={a.id} className="flex min-w-0 items-center py-1.5 text-[13px]">
            <Music className="mr-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{a.nome}</span>
            <span className={juntar(etiqueta, "mr-1 bg-muted text-muted-foreground")}>acervo</span>
            <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => usarComoTrilha(null, a)}>
              Usar
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 space-y-2">
        <Deslizante rotulo="Música abaixo da voz" valor={mix.trilha_abaixo_da_voz_db} min={12} max={36} passo={1} formatar={(v) => `${Math.round(v)} dB`} onMudar={(v) => ctx.onOps([{ op: "mixagem", campos: { trilha_abaixo_da_voz_db: v } }], "Música abaixo da voz")} />
        <Deslizante rotulo="Sobe nas pausas" valor={mix.subida_nas_pausas_db} min={0} max={12} passo={1} formatar={(v) => `${Math.round(v)} dB`} onMudar={(v) => ctx.onOps([{ op: "mixagem", campos: { subida_nas_pausas_db: v } }], "Subida nas pausas")} />
        <label className="flex items-center text-[13px]">
          <input type="checkbox" className="mr-2 h-3.5 w-3.5 accent-primary" checked={mix.duck} onChange={(e) => ctx.onOps([{ op: "mixagem", campos: { duck: e.target.checked } }], e.target.checked ? "Ducking ligado" : "Ducking desligado")} />
          Abaixar a música quando a pessoa fala (ducking)
        </label>
      </div>
      <Subtitulo ajuda="Sons livres (CC0) com o comprovante de cada um em public/editor/sons/licencas.">Efeitos sonoros</Subtitulo>
      <PainelDeSkills projeto={p} contexto={{ agora: new Date().toISOString(), selecionados: ctx.selecao }} controle={ctx.controle} ids={["efeitos_sonoros"]} />
      <ul className="mt-1 divide-y divide-border">
        {BIBLIOTECA_DE_SONS.map((s) => (
          <li key={s.id} className="flex min-w-0 items-center py-1 text-[13px]">
            <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => ouvir(s.id, caminhoDoSom(s))} aria-label={tocando === s.id ? `Parar ${s.rotulo}` : `Ouvir ${s.rotulo}`}>
              {tocando === s.id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
            </button>
            <span className="min-w-0 flex-1 truncate" title={s.uso}>
              {s.rotulo}
            </span>
            <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => somNoCursor(s.id)} aria-label={`Pôr ${s.rotulo} no cursor`}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- Motion

function CamposDaPeca({ d, valores, mudar }: { d: DefinicaoDaPeca; valores: Record<string, string>; mudar: (k: string, v: string) => void }) {
  return (
    <div className="mt-2 space-y-2">
      {d.parametros.map((x) => (
        <label key={x.chave} className="block min-w-0">
          <span className={texto.rotulo}>
            {x.rotulo}
            {x.obrigatorio ? " *" : ""}
          </span>
          {x.tipo === "escolha" ? (
            <select className={juntar(campo, "mt-1 h-8")} value={valores[x.chave] || String(x.padrao || (x.opcoes || [])[0] || "")} onChange={(e) => mudar(x.chave, e.target.value)}>
              {(x.opcoes || []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : x.tipo === "cor" ? (
            <input type="color" className={juntar(campo, "mt-1 h-8 p-1")} value={valores[x.chave] || "#00ff66"} onChange={(e) => mudar(x.chave, e.target.value)} />
          ) : (
            <input className={juntar(campo, "mt-1 h-8")} value={valores[x.chave] || ""} onChange={(e) => mudar(x.chave, e.target.value)} placeholder={x.tipo === "lista" ? "Itens separados por ;" : x.tipo === "numero" ? "Só o número dito" : ""} />
          )}
        </label>
      ))}
    </div>
  );
}

export function PainelDeMotion({ ctx }: { ctx: ContextoDoPainel }) {
  const { clientId } = useMesa();
  const p = ctx.projeto;
  const marca = useMarcaDoEditor();
  const [aberta, setAberta] = useState<IdDaPeca | null>(null);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [densidade, setDensidade] = useState<"poucas" | "medias">("medias");
  const [sugerindo, setSugerindo] = useState(false);

  const pecas = CATALOGO_DE_MOTION.filter((d) => d.id !== "logo");
  // 02/10: a polaroide mostra uma foto de verdade (antes saía o quadro cinza vazio): a foto vem da mídia do projeto.
  const fotos = Object.keys(p.fontes).filter((k) => p.fontes[k].midia === "imagem" || p.fontes[k].midia === "video");
  const [foto, setFoto] = useState<string>("");
  const fotoEscolhida = foto && p.fontes[foto] ? foto : fotos.find((k) => p.fontes[k].midia === "imagem") || fotos[0] || "";
  const por = (d: DefinicaoDaPeca) =>
    aplicarMontando(ctx, d.rotulo, (m) => {
      const params: Record<string, unknown> = {};
      d.parametros.forEach((x) => {
        const v = valores[x.chave];
        if (v === undefined || v === "") return;
        params[x.chave] = x.tipo === "lista" ? v.split(/\s*;\s*/).filter(Boolean) : v;
      });
      if (!params.cor && marca && marca.cor && d.parametros.some((x) => x.chave === "cor")) params.cor = marca.cor;
      if (d.id === "polaroide" && !fotoEscolhida) throw new Error("Ponha uma foto na linha do tempo ou na Mídia do projeto antes da polaroide.");
      const r = porPeca(m, { peca: d.id, inicio_s: ctx.cursor(), params, fonte: d.id === "polaroide" ? fotoEscolhida : undefined });
      setAberta(null);
      setValores({});
      return `${d.rotulo} em ${tempoFino(r.inicio_s)}.`;
    });

  const sugerir = async () => {
    setSugerindo(true);
    try {
      const r = await sugerirAnimacoesNaTela(chamarEditorVideo, clientId, p, densidade);
      if (r.operacoes.length) ctx.onOps(r.operacoes, "Animações sugeridas");
      toast[r.operacoes.length ? "success" : "info"](r.texto.slice(0, 180), { description: r.operacoes.length ? "Ctrl+Z desfaz." : undefined });
    } catch (e) {
      toast.error("A IA não sugeriu agora", { description: textoDoErro(e) });
      console.error("[editor] sugerir animações", e);
    } finally {
      setSugerindo(false);
    }
  };

  const logo = (onde: "canto" | "sting" | "cartao_final") =>
    aplicarMontando(ctx, "Logo", (m) => {
      if (!marca || !marca.logo_path) throw new Error("A marca aberta não tem logo no kit. Suba a logo em Marca.");
      porLogo(m, { storage_path: marca.logo_path, nome: marca.nome ? `Logo ${marca.nome}` : null }, onde);
      return onde === "canto" ? "Logo no canto." : onde === "sting" ? "Logo na abertura." : "Logo no fim.";
    });

  return (
    <div data-painel="motion">
      <TituloDoPainel titulo="Motion" ajuda="Peças animadas da casa (rótulo, carimbo, lista, passo a passo, contador, notificação, polaroide, lettering, barra, preço, comentário, selo e cartão final), no tempo da fala. Número, preço e porcentagem só entram se foram ditos. A IA acha os momentos na fala e escolhe a peça (Jev)." />
      <div className="flex items-center">
        <select className={juntar(campo, "mr-2 h-8 w-auto")} value={densidade} onChange={(e) => setDensidade(e.target.value === "poucas" ? "poucas" : "medias")} aria-label="Quantas animações">
          <option value="medias">No ritmo</option>
          <option value="poucas">Poucas</option>
        </select>
        <button type="button" className={juntar(botao.primario, "h-8")} onClick={() => void sugerir()} disabled={sugerindo}>
          {sugerindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
          Sugerir na fala (IA)
        </button>
      </div>
      <Subtitulo>Logo da marca</Subtitulo>
      <div className="flex flex-wrap">
        {(["sting", "canto", "cartao_final"] as const).map((o) => (
          <button key={o} type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8 px-2.5 text-[12px]")} onClick={() => logo(o)} disabled={!marca || !marca.logo_path} title={!marca || !marca.logo_path ? "Sem logo no kit da marca" : undefined}>
            {o === "sting" ? "Na abertura" : o === "canto" ? "No canto" : "No fim"}
          </button>
        ))}
      </div>
      <Subtitulo ajuda="Abra a peça, preencha e ponha no cursor.">Peça no cursor</Subtitulo>
      <ul className="divide-y divide-border">
        {pecas.map((d) => (
          <li key={d.id} className="py-1.5" data-peca={d.id}>
            <div className="flex min-w-0 items-center">
              <span className="min-w-0 flex-1 truncate text-[13px]" title={d.quando}>
                {d.rotulo}
              </span>
              <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => {
                setAberta(aberta === d.id ? null : d.id);
                setValores({});
              }} aria-expanded={aberta === d.id}>
                {aberta === d.id ? "Fechar" : "Abrir"}
              </button>
            </div>
            {aberta === d.id && (
              <>
                <p className={juntar(texto.auxiliar, "mt-1")}>{d.quando}</p>
                <CamposDaPeca d={d} valores={valores} mudar={(k, v) => setValores((x) => ({ ...x, [k]: v }))} />
                {d.id === "polaroide" && (
                  <label className="mt-2 block min-w-0">
                    <span className={texto.rotulo}>Foto</span>
                    <select className={juntar(campo, "mt-1 h-8")} value={fotoEscolhida} onChange={(e) => setFoto(e.target.value)} aria-label="Foto da polaroide" disabled={!fotos.length}>
                      {!fotos.length && <option value="">Sem foto no projeto</option>}
                      {fotos.map((k) => (
                        <option key={k} value={k}>
                          {p.fontes[k].nome}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button type="button" className={juntar(botao.secundario, "mt-2 h-8")} onClick={() => por(d)} disabled={d.id === "polaroide" && !fotos.length}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Pôr no cursor
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
