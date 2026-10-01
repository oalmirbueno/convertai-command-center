import { useEffect, useState, type ReactNode } from "react";
import { ArrowRightLeft, Camera, Columns2, Scissors, Trash2, Wand2 } from "lucide-react";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import {
  duracaoDoClipe,
  MODOS_DE_COMPARAR,
  ROTULO_DA_TRILHA,
  ROTULO_DO_MODO_DE_COMPARAR,
  TIPOS_DE_TRANSICAO,
  type ClipeDoProjeto,
  type ModoDeComparar,
  type ProjetoDeEdicao,
  type TipoDeTransicao,
} from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { acharClipe, emOrdem, fimDoClipe, type Operacao } from "@/lib/editor/operacoes";
import { apelidosDoProjeto, rotuloDoClipe } from "@/lib/editor/apelidos";
import { segundosDoTexto, tempoFino } from "@/lib/editor/tempo";
import { EFEITOS_DE_AJUSTE, MODOS_DE_ZOOM, ROTULO_DO_EFEITO, efeitoDoClipe } from "@/lib/editor/efeitos";
import { LOOKS } from "@/lib/editor/cor";
import { FONTES_DE_TEXTO, POSICOES_DE_TEXTO, PRESETS_DE_LEGENDA, PRESETS_DE_TEXTO } from "@/lib/editor/estilosDeTexto";

/**
 * Propriedades do clipe escolhido (frente V-B). Cada campo grava ao sair do
 * campo ou no Enter (um passo no desfazer por mudança, não por tecla).
 */

export const ROTULO_DA_TRANSICAO: Record<TipoDeTransicao, string> = { corte: "Corte seco", fade: "Fade", dissolver: "Dissolver", deslizar: "Deslizar", zoom: "Zoom", flash: "Flash", whip: "Chicote (whip)", desfoque: "Desfoque" };
const VELOCIDADES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

function CampoDeTempo({ rotulo, valor, onMudar, desativado }: { rotulo: string; valor: number; onMudar: (s: number) => void; desativado?: boolean }) {
  const [t, setT] = useState(tempoFino(valor));
  useEffect(() => setT(tempoFino(valor)), [valor]);
  const gravar = () => {
    const s = segundosDoTexto(t);
    if (s === null || Math.abs(s - valor) < 0.0005) return setT(tempoFino(valor));
    onMudar(s);
  };
  return (
    <label className="block min-w-0">
      <span className={texto.rotulo}>{rotulo}</span>
      <input className={juntar(campo, "mt-1 h-8 tabular-nums")} value={t} disabled={desativado} onChange={(e) => setT(e.target.value)} onBlur={gravar} onKeyDown={(e) => e.key === "Enter" && gravar()} />
    </label>
  );
}

function Linha({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 grid-cols-2 gap-2">{children}</div>;
}

export default function Inspector({
  projeto,
  selecao,
  cursor,
  onOps,
  onDividir,
  onRemover,
  abrirCamera,
  abrirComparar,
  gerarContinuacao,
  gerarTransicao,
}: {
  projeto: ProjetoDeEdicao;
  selecao: string[];
  cursor: number;
  onOps: (ops: Operacao[], rotulo: string) => void;
  onDividir: () => void;
  onRemover: (ondular: boolean) => void;
  abrirCamera: () => void;
  abrirComparar: () => void;
  gerarContinuacao: (clipeId: string) => void;
  gerarTransicao: (a: string, b: string) => void;
}) {
  const a = apelidosDoProjeto(projeto);
  if (!selecao.length) return <EstadoVazio compacto titulo="Nenhum clipe escolhido." descricao="Clique num clipe da linha do tempo." />;
  if (selecao.length > 1) {
    return (
      <div className="space-y-2">
        <p className={texto.corpo}>{selecao.length} clipes: {selecao.map((id) => a.porId[id]).join(", ")}</p>
        <div className="flex flex-wrap">
          <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={abrirComparar} disabled={selecao.length !== 2}>
            <Columns2 className="mr-1.5 h-3.5 w-3.5" />
            Comparar
          </button>
          <button type="button" className={juntar(botao.discreto, "mb-1 h-8")} onClick={() => onRemover(false)}>
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Tirar
          </button>
        </div>
      </div>
    );
  }
  const achado = acharClipe(projeto, selecao[0]);
  if (!achado) return <EstadoVazio compacto titulo="Esse clipe saiu da linha do tempo." />;
  const { clipe: c, trilha } = achado;
  const fonte = c.fonte ? projeto.fontes[c.fonte] : null;
  const ap = a.porId[c.id];
  const mudar = (campos: Partial<ClipeDoProjeto>, rotulo: string) => onOps([{ op: "propriedades", clipe: c.id, campos }], `${rotulo} ${ap}`);
  const visual = trilha.tipo === "video" || trilha.tipo === "sobreposicao";
  const temTexto = trilha.tipo === "texto" || trilha.tipo === "legenda";
  const ordem = emOrdem(trilha);
  const proximo = ordem[ordem.findIndex((x) => x.id === c.id) + 1] || null;
  const fontesVisuais = Object.keys(projeto.fontes).filter((k) => projeto.fontes[k].midia !== "audio" && k !== c.fonte);
  const dentro = cursor > c.inicio_s && cursor < fimDoClipe(c);

  return (
    <div className="space-y-3" data-inspector={c.id}>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold">
          <span className="mr-1 text-muted-foreground">{ap}</span>
          {rotuloDoClipe(projeto, c)}
        </p>
        <p className={texto.auxiliar}>
          {ROTULO_DA_TRILHA[trilha.tipo]} · {tempoFino(duracaoDoClipe(c))}
          {c.origem && c.origem.tipo !== "manual" ? ` · veio de ${c.origem.tipo}` : ""}
        </p>
      </div>
      <div className="flex flex-wrap">
        <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={onDividir} disabled={!dentro} title="S">
          <Scissors className="mr-1.5 h-3.5 w-3.5" />
          Dividir
        </button>
        <button type="button" className={juntar(botao.discreto, "mb-1 mr-1 h-8")} onClick={() => onRemover(false)} title="Delete (Shift + Delete puxa o resto)">
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Tirar
        </button>
      </div>
      <Linha>
        <CampoDeTempo rotulo="Começa em" valor={c.inicio_s} onMudar={(s) => onOps([{ op: "mover", clipe: c.id, inicio_s: s }], `Mover ${ap}`)} />
        <CampoDeTempo rotulo="Termina em" valor={fimDoClipe(c)} onMudar={(s) => onOps([{ op: "aparar", clipe: c.id, lado: "fim", tempo_s: s }], `Aparar ${ap}`)} />
      </Linha>
      {fonte && fonte.midia !== "imagem" && (
        <Linha>
          <CampoDeTempo rotulo="Entrada na fonte" valor={c.entrada_s} onMudar={(s) => onOps([{ op: "aparar", clipe: c.id, lado: "inicio", tempo_s: c.inicio_s + (s - c.entrada_s) / c.velocidade }], `Aparar ${ap}`)} />
          <CampoDeTempo rotulo="Saída na fonte" valor={c.saida_s} onMudar={(s) => onOps([{ op: "aparar", clipe: c.id, lado: "fim", tempo_s: c.inicio_s + (s - c.entrada_s) / c.velocidade }], `Aparar ${ap}`)} />
        </Linha>
      )}
      {temTexto && (
        <label className="block">
          <span className={texto.rotulo}>Texto</span>
          <textarea
            className={juntar(campo, "mt-1 h-16 py-1.5")}
            defaultValue={c.texto || ""}
            key={`${c.id}:${c.texto}`}
            maxLength={500}
            onBlur={(e) => e.target.value !== (c.texto || "") && mudar({ texto: e.target.value || null }, "Texto de")}
          />
        </label>
      )}
      {(fonte || visual) && (
        <Linha>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Velocidade</span>
            <select className={juntar(campo, "mt-1 h-8")} value={String(c.velocidade)} onChange={(e) => mudar({ velocidade: Number(e.target.value) }, "Velocidade de")}>
              {VELOCIDADES.map((v) => (
                <option key={v} value={v}>
                  {String(v).replace(".", ",")}x
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Volume {Math.round(c.volume * 100)}%</span>
            <input type="range" min={0} max={200} step={5} defaultValue={Math.round(c.volume * 100)} key={`${c.id}:${c.volume}`} className="mt-3 w-full" onMouseUp={(e) => mudar({ volume: Number((e.target as HTMLInputElement).value) / 100 }, "Volume de")} onKeyUp={(e) => mudar({ volume: Number((e.target as HTMLInputElement).value) / 100 }, "Volume de")} onTouchEnd={(e) => mudar({ volume: Number((e.target as HTMLInputElement).value) / 100 }, "Volume de")} aria-label="Volume" />
          </label>
        </Linha>
      )}
      {visual && (
        <Linha>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Zoom (punch-in)</span>
            <select
              className={juntar(campo, "mt-1 h-8")}
              value={c.zoom ? `${c.zoom.de}-${c.zoom.para}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return mudar({ zoom: null }, "Zoom de");
                const [de, para] = v.split("-").map(Number);
                mudar({ zoom: { de, para } }, "Zoom de");
              }}
            >
              <option value="">Sem zoom</option>
              <option value="1.08-1.08">Punch-in 1,08</option>
              <option value="1.15-1.15">Punch-in 1,15</option>
              <option value="1-1.1">Empurrão 1,00 a 1,10</option>
              <option value="1-1.2">Empurrão 1,00 a 1,20</option>
              <option value="1.2-1">Recuo 1,20 a 1,00</option>
              {c.zoom && ["1.08-1.08", "1.15-1.15", "1-1.1", "1-1.2", "1.2-1"].indexOf(`${c.zoom.de}-${c.zoom.para}`) < 0 && <option value={`${c.zoom.de}-${c.zoom.para}`}>{`${c.zoom.de} a ${c.zoom.para}`}</option>}
            </select>
          </label>
          <span />
        </Linha>
      )}
      <Linha>
        {(["transicao_entrada", "transicao_saida"] as const).map((k) => (
          <label key={k} className="block min-w-0">
            <span className={texto.rotulo}>{k === "transicao_entrada" ? "Entrada" : "Saída"}</span>
            <select
              className={juntar(campo, "mt-1 h-8")}
              value={c[k] ? c[k]!.tipo : "corte"}
              onChange={(e) => mudar({ [k]: e.target.value === "corte" ? null : { tipo: e.target.value as TipoDeTransicao, duracao_s: 0.3 } }, "Transição de")}
            >
              {TIPOS_DE_TRANSICAO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_DA_TRANSICAO[t]}
                </option>
              ))}
            </select>
          </label>
        ))}
      </Linha>
      {visual && (
        <div className="border-t border-border pt-3">
          <p className={juntar(texto.rotulo, "mb-1")}>Antes e depois</p>
          {c.comparar ? (
            <Linha>
              <select className={juntar(campo, "h-8")} value={c.comparar.modo} onChange={(e) => mudar({ comparar: { ...c.comparar!, modo: e.target.value as ModoDeComparar } }, "Antes e depois de")}>
                {MODOS_DE_COMPARAR.map((m) => (
                  <option key={m} value={m}>
                    {ROTULO_DO_MODO_DE_COMPARAR[m]}
                  </option>
                ))}
              </select>
              <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => mudar({ comparar: null }, "Tirar antes e depois de")}>
                Desfazer montagem
              </button>
            </Linha>
          ) : (
            <select
              className={juntar(campo, "h-8")}
              value=""
              onChange={(e) => e.target.value && mudar({ comparar: { fonte_b: e.target.value, entrada_b_s: 0, modo: "cortina", rotulos: true, rotulo_a: "Antes", rotulo_b: "Depois" } }, "Antes e depois em")}
              disabled={!fontesVisuais.length}
              aria-label="Mídia do depois"
            >
              <option value="">{fontesVisuais.length ? "Escolha a mídia do depois" : "Sem outra mídia no projeto"}</option>
              {fontesVisuais.map((k) => (
                <option key={k} value={k}>
                  {projeto.fontes[k].nome}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {visual && fonte && (
        <div className="border-t border-border pt-3">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Gerar a partir deste clipe</p>
          <div className="flex flex-wrap">
            <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={abrirCamera}>
              <Camera className="mr-1.5 h-3.5 w-3.5" />
              Trocar câmera
            </button>
            {fonte.midia === "video" && (
              <button type="button" className={juntar(botao.secundario, "mb-1 mr-1 h-8")} onClick={() => gerarContinuacao(c.id)}>
                <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                Continuar a partir daqui
              </button>
            )}
            {proximo && proximo.fonte && (
              <button type="button" className={juntar(botao.secundario, "mb-1 h-8")} onClick={() => gerarTransicao(c.id, proximo.id)}>
                <ArrowRightLeft className="mr-1.5 h-3.5 w-3.5" />
                Transição para {a.porId[proximo.id]}
              </button>
            )}
          </div>
        </div>
      )}
      {trilha.tipo === "ajuste" && <AjusteDoEfeito c={c} mudar={mudar} />}
      {temTexto && <EstiloDoTexto c={c} legenda={trilha.tipo === "legenda"} mudar={mudar} letraDaMarca={projeto.identidade && projeto.identidade.fonte ? projeto.identidade.fonte : null} />}
      {trilha.tipo === "video" && fonte && fonte.midia !== "audio" && <FocoDoRecorte c={c} mudar={mudar} temRosto={!!(projeto.rostos || {})[fonte.chave]} />}
      <label className="block">
        <span className={texto.rotulo}>Nota</span>
        <input className={juntar(campo, "mt-1 h-8")} defaultValue={c.nota || ""} key={`${c.id}:nota:${c.nota}`} maxLength={300} onBlur={(e) => e.target.value !== (c.nota || "") && mudar({ nota: e.target.value || null }, "Nota de")} />
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- frente EDT, rodada 2

type Mudar = (campos: Partial<ClipeDoProjeto>, rotulo: string) => void;
const estiloDe = (c: ClipeDoProjeto) => (c.estilo || {}) as Record<string, unknown>;

/** Deslizante que grava ao soltar (um passo do desfazer por mudança). */
function DeslizanteDoClipe({ id, rotulo, valor, min, max, passo, onSoltar }: { id: string; rotulo: string; valor: number; min: number; max: number; passo: number; onSoltar: (v: number) => void }) {
  const soltar = (ev: { target: EventTarget }) => onSoltar(Number((ev.target as HTMLInputElement).value));
  return <input type="range" min={min} max={max} step={passo} defaultValue={valor} key={`${id}:${valor}`} className="mt-2 w-full" onMouseUp={soltar} onKeyUp={soltar} onTouchEnd={soltar} aria-label={rotulo} />;
}

/** Efeito da camada de ajuste: qual efeito e os números dele. */
function AjusteDoEfeito({ c, mudar }: { c: ClipeDoProjeto; mudar: Mudar }) {
  const e = efeitoDoClipe(c);
  const efeito = e ? e.efeito : "zoom";
  const params = e ? e.params : {};
  const mudarParams = (novos: Record<string, unknown>, rotulo: string) => mudar({ estilo: { ...estiloDe(c), efeito, params: { ...params, ...novos } } }, rotulo);
  const escala = Number(params.escala || 1.15);
  const forca = Number(params.forca !== undefined ? params.forca : 0.5);
  return (
    <div className="space-y-2 border-t border-border pt-3" data-ajuste-do-efeito={efeito}>
      <Linha>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Efeito</span>
          <select className={juntar(campo, "mt-1 h-8")} value={efeito} onChange={(ev) => mudar({ estilo: { ...estiloDe(c), efeito: ev.target.value, params: ev.target.value === "cor" ? { look: "pb" } : {} } }, "Efeito de")}>
            {EFEITOS_DE_AJUSTE.map((x) => (
              <option key={x} value={x}>
                {ROTULO_DO_EFEITO[x]}
              </option>
            ))}
          </select>
        </label>
        {efeito === "zoom" ? (
          <label className="block min-w-0">
            <span className={texto.rotulo}>Movimento</span>
            <select className={juntar(campo, "mt-1 h-8")} value={String(params.modo || "punch")} onChange={(ev) => mudarParams({ modo: ev.target.value, entrada_s: ev.target.value === "punch" ? 0.12 : 0 }, "Zoom de")}>
              {MODOS_DE_ZOOM.map((x) => (
                <option key={x.valor} value={x.valor}>
                  {x.rotulo}
                </option>
              ))}
            </select>
          </label>
        ) : efeito === "cor" ? (
          <label className="block min-w-0">
            <span className={texto.rotulo}>Look do trecho</span>
            <select className={juntar(campo, "mt-1 h-8")} value={String(params.look || "natural")} onChange={(ev) => mudarParams({ look: ev.target.value }, "Cor de")}>
              {LOOKS.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.rotulo}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span />
        )}
      </Linha>
      {efeito === "zoom" && (
        <label className="block">
          <span className={texto.rotulo}>Escala {escala.toFixed(2).replace(".", ",")}x</span>
          <DeslizanteDoClipe id={`${c.id}:escala`} rotulo="Escala do zoom" valor={escala} min={1} max={2} passo={0.01} onSoltar={(v) => mudarParams({ escala: v }, "Escala de")} />
        </label>
      )}
      {(efeito === "tremor" || efeito === "flash" || efeito === "desfoque") && (
        <label className="block">
          <span className={texto.rotulo}>Força {Math.round(forca * 100)}%</span>
          <DeslizanteDoClipe id={`${c.id}:forca`} rotulo="Força do efeito" valor={forca} min={0} max={1} passo={0.05} onSoltar={(v) => mudarParams({ forca: v }, "Força de")} />
        </label>
      )}
    </div>
  );
}

/** Estilo do texto ou da legenda (catálogo da casa, posição, cor e letra). */
function EstiloDoTexto({ c, legenda, mudar, letraDaMarca }: { c: ClipeDoProjeto; legenda: boolean; mudar: Mudar; letraDaMarca?: string | null }) {
  const e = estiloDe(c);
  const presets = legenda ? PRESETS_DE_LEGENDA : PRESETS_DE_TEXTO;
  const preset = String(e.preset || (legenda ? "destaque" : "simples"));
  const cor = /^#[0-9a-fA-F]{6}$/.test(String(e.cor || "")) ? String(e.cor) : "";
  const sem = (k: string) => {
    const copia = { ...e };
    delete copia[k];
    return copia;
  };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <Linha>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Estilo</span>
          <select className={juntar(campo, "mt-1 h-8")} value={preset} onChange={(ev) => mudar({ estilo: { ...e, preset: ev.target.value } }, "Estilo de")}>
            {presets.map((x) => (
              <option key={x.valor} value={x.valor} title={x.quando}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Onde</span>
          <select className={juntar(campo, "mt-1 h-8")} value={String(e.posicao || (legenda ? "auto" : "meio"))} onChange={(ev) => mudar({ estilo: { ...e, posicao: ev.target.value } }, "Posição de")}>
            {POSICOES_DE_TEXTO.map((x) => (
              <option key={x.valor} value={x.valor}>
                {x.rotulo}
              </option>
            ))}
          </select>
        </label>
      </Linha>
      <Linha>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Cor de destaque</span>
          <input type="color" className={juntar(campo, "mt-1 h-8 p-1")} value={cor || "#00ff66"} onChange={(ev) => mudar({ estilo: { ...e, cor: ev.target.value } }, "Cor de")} aria-label="Cor de destaque" />
        </label>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Letra</span>
          <select className={juntar(campo, "mt-1 h-8")} value={String(e.fonte || "")} onChange={(ev) => mudar({ estilo: ev.target.value ? { ...e, fonte: ev.target.value } : sem("fonte") }, "Letra de")}>
            <option value="">{letraDaMarca ? `Da marca (${letraDaMarca})` : "Do estilo"}</option>
            {FONTES_DE_TEXTO.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
      </Linha>
      {cor && (
        <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={() => mudar({ estilo: sem("cor") }, "Cor da marca em")}>
          Voltar à cor da marca
        </button>
      )}
    </div>
  );
}

/** Foco manual do recorte (vence o rosto rastreado neste clipe). */
function FocoDoRecorte({ c, mudar, temRosto }: { c: ClipeDoProjeto; mudar: Mudar; temRosto: boolean }) {
  const e = estiloDe(c);
  const manual = e.foco_x !== undefined && e.foco_x !== null;
  const fx = manual ? Number(e.foco_x) : 0.5;
  const fy = manual ? Number(e.foco_y) : 0.4;
  const gravar = (x: number, y: number) => mudar({ estilo: { ...e, foco_x: Math.round(x * 1000) / 1000, foco_y: Math.round(y * 1000) / 1000 } }, "Foco de");
  const automatico = () => {
    const copia = { ...e };
    delete copia.foco_x;
    delete copia.foco_y;
    mudar({ estilo: Object.keys(copia).length ? copia : null }, "Foco automático em");
  };
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <p className={texto.rotulo}>Foco do recorte: {manual ? "manual" : temRosto ? "segue o rosto" : "centro"}</p>
      <Linha>
        <label className="block min-w-0">
          <span className={texto.auxiliar}>Horizontal {Math.round(fx * 100)}%</span>
          <DeslizanteDoClipe id={`${c.id}:fx`} rotulo="Foco horizontal" valor={fx} min={0} max={1} passo={0.01} onSoltar={(v) => gravar(v, fy)} />
        </label>
        <label className="block min-w-0">
          <span className={texto.auxiliar}>Vertical {Math.round(fy * 100)}%</span>
          <DeslizanteDoClipe id={`${c.id}:fy`} rotulo="Foco vertical" valor={fy} min={0} max={1} passo={0.01} onSoltar={(v) => gravar(fx, v)} />
        </label>
      </Linha>
      {manual && (
        <button type="button" className={juntar(botao.discreto, "h-7 px-2 text-[12px]")} onClick={automatico}>
          {temRosto ? "Voltar a seguir o rosto" : "Voltar ao centro"}
        </button>
      )}
    </div>
  );
}
