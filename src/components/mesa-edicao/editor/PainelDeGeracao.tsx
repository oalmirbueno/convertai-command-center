import { useEffect, useState } from "react";
import { Camera, Film, Loader2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { EstadoVazio } from "@/components/sistema/Estados";
import { campo, juntar, texto } from "@/components/sistema/estilos";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { acharClipe, fimDoClipe, type Operacao } from "@/lib/editor/operacoes";
import { apelidosDoProjeto } from "@/lib/editor/apelidos";
import { anguloDaPose, corpoDoAngulo, DISTANCIAS, POSES_DE_CAMERA, textoDeContinuidade, type AcaoDeGeracao, type Distancia, type IdDaPose, type Manter } from "@/lib/editor/geracao";
import { blobDoDataUrl, extrairQuadro, lerImagem, tempoDoQuadro, tempoDoUltimoQuadro, type Quadro } from "@/lib/editor/quadros";
import { subirDoEditor } from "@/lib/editor/api";
import type { ItemDaBiblioteca } from "@/lib/editor/biblioteca";
import { tempoFino } from "@/lib/editor/tempo";
import GeracaoComCusto from "./GeracaoComCusto";

/**
 * Gerar a partir do editor (frente V-B): troca de câmera (tipo Higgsfield:
 * mesmo personagem de outro ângulo), continuar a partir do último quadro,
 * transição entre dois clipes e virar clipe a partir de imagem. O quadro sai
 * do navegador no tempo exato (meio do quadro), sobe só na hora de Preparar,
 * e nada gasta antes do "Gerar por US$ X". O resultado entra na Mídia e dali
 * vai para a linha do tempo (depois do clipe atual).
 */

export type PedidoDeGeracao =
  | { tipo: "angulo_gerar"; clipe: string | null }
  | { tipo: "continuar_video"; clipe: string }
  | { tipo: "transicao_gerar"; clipe: string; clipeB: string }
  | { tipo: "gerar_cena"; item: ItemDaBiblioteca };

async function quadroDoClipe(p: ProjetoDeEdicao, urls: Record<string, string>, id: string, qual: "cursor" | "inicio" | "fim", cursor: number, largura = 1280): Promise<Quadro | null> {
  const a = acharClipe(p, id);
  if (!a || !a.clipe.fonte) return null;
  const f = p.fontes[a.clipe.fonte];
  const url = urls[a.clipe.fonte];
  if (!f || !url) return null;
  if (f.midia === "imagem") return lerImagem(url, largura, 0.9);
  const c = a.clipe;
  let t = c.entrada_s;
  // PNG sem perda (o contrato da V-A pede o quadro em PNG).
  if (qual === "fim") return extrairQuadro(url, tempoDoUltimoQuadro(c.saida_s, p.fps), { largura, png: true });
  if (qual === "cursor" && cursor > c.inicio_s && cursor < fimDoClipe(c)) t = c.entrada_s + (cursor - c.inicio_s) * c.velocidade;
  return extrairQuadro(url, tempoDoQuadro(t, p.fps), { largura, png: true });
}

function Miniatura({ q, rotulo }: { q: Quadro | null | "lendo"; rotulo: string }) {
  return (
    <figure className="min-w-0">
      <div className="relative w-full overflow-hidden rounded-md bg-black" style={{ paddingBottom: "56.25%" }}>
        {q === "lendo" ? (
          <Loader2 className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/60" />
        ) : q ? (
          <img src={q.dataUrl} alt={rotulo} className="absolute left-0 top-0 h-full w-full object-contain" />
        ) : (
          <Film className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 text-white/40" />
        )}
      </div>
      <figcaption className={juntar(texto.auxiliar, "mt-1 truncate")}>{q && q !== "lendo" ? `${rotulo} · ${tempoFino(q.tempo_s)} da fonte` : q === "lendo" ? "Lendo o quadro" : `${rotulo}: sem quadro (a mídia não deixa ler aqui)`}</figcaption>
    </figure>
  );
}

export default function PainelDeGeracao({
  projeto,
  urls,
  urlsExtras,
  pedido,
  selecao,
  cursor,
  onOps,
}: {
  projeto: ProjetoDeEdicao;
  urls: Record<string, string>;
  urlsExtras: Record<string, string>;
  pedido: PedidoDeGeracao;
  selecao: string[];
  cursor: number;
  onOps: (ops: Operacao[], rotulo: string) => void;
}) {
  const { clientId } = useMesa();
  const a = apelidosDoProjeto(projeto);
  const [pose, setPose] = useState<IdDaPose>("tres_quartos_dir");
  const [distancia, setDistancia] = useState<Distancia>("medio");
  const [manter, setManter] = useState<Manter>("ambos");
  const [variacoes, setVariacoes] = useState(2);
  const [duracao, setDuracao] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [q1, setQ1] = useState<Quadro | null | "lendo">(null);
  const [q2, setQ2] = useState<Quadro | null | "lendo">(null);
  // O quadro do cursor é pego quando o painel abre e no botão (não a cada quadro tocando).
  const [cursorFixo, setCursorFixo] = useState(cursor);

  const clipeAlvo = pedido.tipo === "gerar_cena" ? null : pedido.tipo === "angulo_gerar" ? pedido.clipe || selecao[0] || null : pedido.clipe;
  const chaveDoQuadro = `${pedido.tipo}:${clipeAlvo}:${pedido.tipo === "transicao_gerar" ? pedido.clipeB : ""}:${pedido.tipo === "gerar_cena" ? pedido.item.storage_path : ""}:${pedido.tipo === "angulo_gerar" ? cursorFixo.toFixed(3) : ""}`;

  useEffect(() => {
    let vivo = true;
    setQ1("lendo");
    setQ2(pedido.tipo === "transicao_gerar" ? "lendo" : null);
    (async () => {
      let a1: Quadro | null = null;
      let a2: Quadro | null = null;
      if (pedido.tipo === "gerar_cena") {
        const url = urlsExtras[`@${pedido.item.storage_path}`];
        a1 = url ? await lerImagem(url, 1024, 0.9) : null;
      } else if (clipeAlvo) {
        a1 = await quadroDoClipe(projeto, urls, clipeAlvo, pedido.tipo === "angulo_gerar" ? "cursor" : "fim", cursorFixo);
        if (pedido.tipo === "transicao_gerar") a2 = await quadroDoClipe(projeto, urls, pedido.clipeB, "inicio", cursorFixo);
      }
      if (!vivo) return;
      setQ1(a1);
      setQ2(pedido.tipo === "transicao_gerar" ? a2 : null);
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveDoQuadro, urls, urlsExtras]);

  const continuidade = projeto.continuidade;
  const subir = async (q: Quadro | null | "lendo") => {
    if (!q || q === "lendo") throw new Error("Sem o quadro não dá para gerar. Tente outro ponto do clipe.");
    const blob = blobDoDataUrl(q.dataUrl);
    return subirDoEditor(clientId, "quadros", blob, blob.type === "image/png" ? "png" : "jpg");
  };

  // Corpos no formato de docs/video/CONTRATOS.md (V-A). A continuidade vai no prompt.
  const montarCorpo = async (): Promise<Record<string, unknown>> => {
    const cont = { personagem: continuidade.personagem, cenario: continuidade.cenario };
    const texto = [prompt.trim(), textoDeContinuidade(cont)].filter(Boolean).join(" ") || undefined;
    if (pedido.tipo === "angulo_gerar") {
      const caminho = await subir(q1);
      return corpoDoAngulo({ client_id: clientId, imagem_path: caminho, angulo: anguloDaPose(pose, distancia), variacoes, manter, continuidade: cont });
    }
    if (pedido.tipo === "transicao_gerar") {
      const a1 = await subir(q1);
      const b1 = await subir(q2);
      return { client_id: clientId, quadro_a_path: a1, quadro_b_path: b1, prompt: texto, duracao_s: duracao, formato: projeto.formato, variacoes: 1 };
    }
    if (pedido.tipo === "continuar_video") {
      const achado = acharClipe(projeto, pedido.clipe);
      const f = achado && achado.clipe.fonte ? projeto.fontes[achado.clipe.fonte] : null;
      const caminho = await subir(q1);
      return { client_id: clientId, arquivo_id: f ? f.arquivo_id : null, quadro_path: caminho, usar_extensao: true, prompt: texto, duracao_s: duracao, formato: projeto.formato, variacoes: 1 };
    }
    const caminho = await subir(q1);
    return { client_id: clientId, modo: "primeiro_quadro", quadro_inicial_path: caminho, prompt: texto, duracao_s: duracao, formato: projeto.formato, variacoes: 1 };
  };

  const acao: AcaoDeGeracao = pedido.tipo;
  const semQuadro = !q1 || q1 === "lendo" || (pedido.tipo === "transicao_gerar" && (!q2 || q2 === "lendo"));
  if (pedido.tipo === "angulo_gerar" && !clipeAlvo) return <EstadoVazio compacto icone={<Camera className="h-5 w-5" />} titulo="Escolha um clipe de vídeo." descricao="O quadro do cursor vira a referência do novo ângulo." />;

  return (
    <div className="space-y-3" data-painel-de-geracao={pedido.tipo}>
      <p className={texto.rotulo}>
        {pedido.tipo === "angulo_gerar" && `Trocar câmera de ${a.porId[String(clipeAlvo)] || "clipe"}`}
        {pedido.tipo === "continuar_video" && `Continuar ${a.porId[pedido.clipe] || "clipe"} a partir do último quadro`}
        {pedido.tipo === "transicao_gerar" && `Transição de ${a.porId[pedido.clipe]} para ${a.porId[pedido.clipeB]}`}
        {pedido.tipo === "gerar_cena" && `Virar clipe: ${pedido.item.nome}`}
      </p>
      <div className={juntar("grid min-w-0 gap-2", pedido.tipo === "transicao_gerar" ? "grid-cols-2" : "grid-cols-1")}>
        <Miniatura q={q1} rotulo={pedido.tipo === "transicao_gerar" ? "Último quadro" : pedido.tipo === "continuar_video" ? "Último quadro" : "Quadro"} />
        {pedido.tipo === "transicao_gerar" && <Miniatura q={q2} rotulo="Primeiro quadro" />}
      </div>
      {pedido.tipo === "angulo_gerar" && Math.abs(cursor - cursorFixo) > 0.001 && (
        <button type="button" className="text-[12px] text-primary underline-offset-2 hover:underline" onClick={() => setCursorFixo(cursor)}>
          Usar o quadro do cursor ({tempoFino(cursor)})
        </button>
      )}

      {pedido.tipo === "angulo_gerar" && (
        <>
          <div>
            <p className={juntar(texto.rotulo, "mb-1")}>Ângulo</p>
            <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Ângulo da câmera">
              {POSES_DE_CAMERA.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={pose === p.id}
                  className={juntar("h-8 truncate rounded-md border px-1 text-[11.5px]", pose === p.id ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted")}
                  onClick={() => setPose(p.id)}
                  title={`azimute ${p.azimute}°, elevação ${p.elevacao}°`}
                >
                  {p.rotulo}
                </button>
              ))}
            </div>
          </div>
          <SeletorCompacto rotulo="Distância da câmera" valor={distancia} onEscolher={(v) => setDistancia(v as Distancia)} opcoes={DISTANCIAS.map((d) => ({ valor: d.valor, rotulo: d.rotulo }))} />
          <div className="grid grid-cols-2 gap-2">
            <label className="block min-w-0">
              <span className={texto.rotulo}>Manter igual</span>
              <select className={juntar(campo, "mt-1 h-8")} value={manter} onChange={(e) => setManter(e.target.value as Manter)}>
                <option value="ambos">Personagem e cenário</option>
                <option value="personagem">Só o personagem</option>
                <option value="cenario">Só o cenário</option>
              </select>
            </label>
            <label className="block min-w-0">
              <span className={texto.rotulo}>Variações</span>
              <select className={juntar(campo, "mt-1 h-8")} value={variacoes} onChange={(e) => setVariacoes(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
      {pedido.tipo !== "angulo_gerar" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="block min-w-0">
            <span className={texto.rotulo}>Duração</span>
            <select className={juntar(campo, "mt-1 h-8")} value={duracao} onChange={(e) => setDuracao(Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n} s
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-0">
            <span className={texto.rotulo}>O que acontece (opcional)</span>
            <input className={juntar(campo, "mt-1 h-8")} value={prompt} maxLength={400} onChange={(e) => setPrompt(e.target.value)} placeholder="Ex.: ela sorri e vira" />
          </label>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
        <label className="block min-w-0">
          <span className={texto.rotulo}>Personagem (manter)</span>
          <input
            className={juntar(campo, "mt-1 h-8")}
            defaultValue={continuidade.personagem || ""}
            key={`p:${continuidade.personagem}`}
            maxLength={400}
            placeholder="Ex.: mulher, 30 anos, blusa verde"
            onBlur={(e) => e.target.value !== (continuidade.personagem || "") && onOps([{ op: "continuidade", campos: { personagem: e.target.value || null } }], "Personagem")}
          />
        </label>
        <label className="block min-w-0">
          <span className={texto.rotulo}>Cenário (manter)</span>
          <input
            className={juntar(campo, "mt-1 h-8")}
            defaultValue={continuidade.cenario || ""}
            key={`c:${continuidade.cenario}`}
            maxLength={400}
            placeholder="Ex.: cozinha clara, bancada de madeira"
            onBlur={(e) => e.target.value !== (continuidade.cenario || "") && onOps([{ op: "continuidade", campos: { cenario: e.target.value || null } }], "Cenário")}
          />
        </label>
      </div>
      <GeracaoComCusto key={chaveDoQuadro} acao={acao} montarCorpo={montarCorpo} desativado={semQuadro} motivo={semQuadro ? "Esperando o quadro." : null} />
    </div>
  );
}
