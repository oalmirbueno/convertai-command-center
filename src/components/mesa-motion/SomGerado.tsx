import { useState } from "react";
import { Loader2, Music, Trash2, Waves } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { duracaoTotal, normalizarFilme } from "../../../supabase/functions/_shared/motion-metodo";
import { estimarEfeito, estimarMusica, promptDaTrilha } from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { chamarMotion, type Filme, uidDoClique, useGuardarFilme } from "./motionApi";

/**
 * Som gerado pela ElevenLabs na etapa Voz e som (frente MOV): a trilha
 * instrumental no tamanho do filme (ElevenLabs Music, pedido já escrito pelo
 * clima da entrevista e o tom da marca, custo antes, batidas medidas em
 * seguida) e o efeito sob medida numa cena, no segundo pedido. Os arquivos
 * vão para a Mídia do cliente; o filme só guarda o caminho.
 */

export function GerarTrilha({ filme, temChave }: { filme: Filme; temChave: boolean }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const total = Math.round(Math.max(10, duracaoTotal(filme.cenas) + 1.5));
  const inicial = () => promptDaTrilha({ clima: typeof filme.entrevista.clima === "string" ? filme.entrevista.clima : null, tom: filme.brand.tom || null, ritmo: typeof filme.entrevista.ritmo === "string" ? filme.entrevista.ritmo : null, duracao_s: total, comVoz: filme.som.narracao.ligada });
  const [aberta, setAberta] = useState(false);
  const [prompt, setPrompt] = useState(inicial);
  const [duracao, setDuracao] = useState(total);
  const [indo, setIndo] = useState(false);

  const abrir = () => {
    setPrompt(inicial());
    setDuracao(total);
    setAberta(true);
  };

  const gerar = async () => {
    setIndo(true);
    try {
      const d = await chamarMotion<{ filme: Filme; links: Record<string, string>; anterior: unknown; custo_usd: number; avisos: string[] }>("trilha_gerar", { filme_id: filme.id, prompt, duracao_s: duracao, uid: uidDoClique("trilha") });
      guardar(d.filme, d.links);
      atualizarCusto();
      setAberta(false);
      toast.success("Trilha gerada e escolhida", {
        description: `Custo real: ${usd(d.custo_usd)}. As batidas estão sendo medidas.${d.avisos && d.avisos.length ? ` ${d.avisos.join(" ")}` : ""}`,
        duration: 15000,
        action: { label: "Desfazer", onClick: () => void desfazer(d.filme, d.anterior) },
      });
    } catch (e) {
      avisarErro(e, "A trilha não foi gerada");
    } finally {
      setIndo(false);
    }
  };

  /**
   * Desfazer: volta a trilha de antes (a gerada fica na Mídia) e pede as
   * batidas dela de novo. A narração e os efeitos ficam como estão no servidor.
   */
  const desfazer = async (bruto: unknown, anterior: unknown) => {
    const lido = normalizarFilme(bruto);
    if (!lido) return;
    try {
      const som: Record<string, unknown> = { ...lido.som, trilha: anterior || null };
      delete som.narracao;
      delete som.efeitos_sob_medida;
      const d = await chamarMotion<{ filme: Filme; links?: Record<string, string> }>("filme_salvar", { filme_id: lido.id, som });
      guardar(d.filme, d.links);
      if (anterior) {
        const b = await chamarMotion<{ pedido: unknown }>("batidas_pedir", { filme_id: lido.id, uid: uidDoClique("batidas") });
        if (!b.pedido) toast.message("A trilha anterior voltou; meça as batidas de novo na etapa Som.");
      }
      toast.success("Voltou a trilha de antes");
    } catch (e) {
      avisarErro(e, "A trilha de antes não voltou");
    }
  };

  return (
    <>
      <button type="button" className={botao.secundario} onClick={abrir} disabled={!temChave} title={temChave ? "Compor uma trilha instrumental no tamanho do filme" : "Precisa da chave da ElevenLabs no servidor"} data-gerar-trilha="">
        <Music className="mr-1 h-3.5 w-3.5" />
        Gerar trilha
      </button>
      <JanelaCentral
        aberta={aberta}
        onMudar={(v) => !v && setAberta(false)}
        titulo="Gerar a trilha"
        icone={<Music className="h-4 w-4" />}
        largura="md"
        ajuda="ElevenLabs Music (music_v2_5), instrumental, no tamanho do filme. O pedido já vem do clima da entrevista, do ritmo e do tom da marca; ajuste à vontade. O uso comercial segue o plano da conta da agência na ElevenLabs."
        descricaoOculta="Pedido e custo da trilha"
        rodape={
          <div className="flex min-w-0 justify-end">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setAberta(false)}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void gerar()} disabled={indo || prompt.trim().length < 10} data-confirmar-trilha="">
              {indo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Music className="mr-1 h-3.5 w-3.5" />}
              Gerar · {usd(estimarMusica(duracao))}
            </button>
          </div>
        }
      >
        <div className="min-w-0 space-y-3">
          <label className="block min-w-0">
            <span className={texto.rotulo}>Pedido da trilha</span>
            <textarea className={juntar(campoTexto, "min-h-[96px]")} value={prompt} maxLength={900} onChange={(e) => setPrompt(e.target.value)} aria-label="Pedido da trilha" />
          </label>
          <label className="block min-w-0 sm:max-w-[200px]">
            <span className={texto.rotulo}>Duração (s)</span>
            <input className={campo} type="number" min={10} max={180} value={duracao} onChange={(e) => setDuracao(Math.max(10, Math.min(180, Number(e.target.value) || total)))} />
          </label>
          {indo && <p className={texto.auxiliar}>Compondo: pode levar um minuto.</p>}
        </div>
      </JanelaCentral>
    </>
  );
}

export function EfeitosSobMedida({ filme, links, temChave }: { filme: Filme; links: Record<string, string>; temChave: boolean }) {
  const { atualizarCusto } = useMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const [aberta, setAberta] = useState(false);
  const [descricao, setDescricao] = useState("");
  const [cenaGuardada, setCenaId] = useState(filme.cenas[0] ? filme.cenas[0].id : "");
  // As cenas mudaram (outro storyboard, cena apagada): o id guardado que não existe mais vira a primeira cena (o select e o pedido usam o mesmo valor).
  const cenaId = filme.cenas.some((c) => c.id === cenaGuardada) ? cenaGuardada : filme.cenas[0] ? filme.cenas[0].id : "";
  const [t, setT] = useState(0.3);
  const [duracao, setDuracao] = useState(2);
  const [indo, setIndo] = useState<string | null>(null);
  const efeitos = filme.som.efeitos_sob_medida;

  const gerar = async () => {
    setIndo("gerar");
    try {
      const d = await chamarMotion<{ filme: Filme; links: Record<string, string>; custo_usd: number }>("efeito_gerar", { filme_id: filme.id, descricao, cena_id: cenaId, t_s: t, duracao_s: duracao });
      guardar(d.filme, d.links);
      atualizarCusto();
      setAberta(false);
      setDescricao("");
      toast.success("Efeito gerado", { description: `Custo real: ${usd(d.custo_usd)}.` });
    } catch (e) {
      avisarErro(e, "O efeito não foi gerado");
    } finally {
      setIndo(null);
    }
  };

  const remover = async (id: string) => {
    setIndo(id);
    try {
      const d = await chamarMotion<{ filme: Filme }>("efeito_remover", { filme_id: filme.id, efeito_id: id });
      guardar(d.filme);
    } catch (e) {
      avisarErro(e, "O efeito não saiu");
    } finally {
      setIndo(null);
    }
  };

  return (
    <div className="min-w-0" data-efeitos-sob-medida="">
      <div className="flex min-w-0 items-center justify-between">
        <span className={texto.rotulo}>Efeitos sob medida ({efeitos.length})</span>
        <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setAberta(true)} disabled={!temChave || !filme.cenas.length} data-novo-efeito="">
          <Waves className="mr-1 h-3.5 w-3.5" />
          Gerar efeito
        </button>
      </div>
      {efeitos.length > 0 && (
        <ul className={juntar(lista.aberta, "mt-1")}>
          {efeitos.map((e) => {
            const i = filme.cenas.findIndex((c) => c.id === e.cena_id);
            return (
              <li key={e.id} className={juntar(lista.linha, "flex-wrap")}>
                <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 truncate")}>
                  {e.nome} · cena {i + 1} em {e.t_s} s
                </span>
                {links[e.path] && <audio controls preload="none" className="mr-2 h-8 w-[180px] max-w-full" src={links[e.path]} aria-label={e.nome} />}
                <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => void remover(e.id)} disabled={indo === e.id} aria-label={`Tirar ${e.nome}`}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <JanelaCentral
        aberta={aberta}
        onMudar={(v) => !v && setAberta(false)}
        titulo="Gerar efeito sob medida"
        icone={<Waves className="h-4 w-4" />}
        largura="sm"
        ajuda="Um som que a biblioteca não tem (porta de vidro, máquina de café, estádio), gerado pela ElevenLabs e posto no segundo que você escolher da cena. O arquivo fica na Mídia do cliente."
        descricaoOculta="Pedido do efeito"
        rodape={
          <div className="flex min-w-0 justify-end">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setAberta(false)}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} onClick={() => void gerar()} disabled={indo === "gerar" || descricao.trim().length < 4 || !cenaId}>
              {indo === "gerar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Waves className="mr-1 h-3.5 w-3.5" />}
              Gerar · {usd(estimarEfeito(duracao))}
            </button>
          </div>
        }
      >
        <div className="min-w-0 space-y-3">
          <label className="block min-w-0">
            <span className={texto.rotulo}>O som</span>
            <input className={campo} value={descricao} maxLength={450} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: porta de vidro abrindo numa loja silenciosa" />
          </label>
          <div className="grid min-w-0 grid-cols-3 gap-3">
            <label className="min-w-0">
              <span className={texto.rotulo}>Cena</span>
              <select className={campo} value={cenaId} onChange={(e) => setCenaId(e.target.value)}>
                {filme.cenas.map((c, i) => (
                  <option key={c.id} value={c.id}>
                    {i + 1}. {c.titulo}
                  </option>
                ))}
              </select>
            </label>
            <label className="min-w-0">
              <span className={texto.rotulo}>No segundo</span>
              <input className={campo} type="number" min={0} max={12} step={0.1} value={t} onChange={(e) => setT(Math.max(0, Number(e.target.value) || 0))} />
            </label>
            <label className="min-w-0">
              <span className={texto.rotulo}>Duração (s)</span>
              <input className={campo} type="number" min={0.5} max={10} step={0.5} value={duracao} onChange={(e) => setDuracao(Math.max(0.5, Math.min(10, Number(e.target.value) || 2)))} />
            </label>
          </div>
        </div>
      </JanelaCentral>
    </div>
  );
}
