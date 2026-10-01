import { useEffect, useState } from "react";
import { ArrowRight, Download, Loader2, Plus, Sparkles, X } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import Secao from "@/components/sistema/Secao";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { brandMd, textoDaProva, type BeatDoFilme, type BrandDoFilme, type ProvaReal } from "../../../supabase/functions/mesa-motion/modulos/motion-metodo";
import { ComFilme, ModeloDaAcao, useModeloDaAcao } from "./FilmeAberto";
import ListaDeProvas from "./ListaDeProvas";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";

/**
 * Etapa 3: o BRAND.md do filme (prevalece sobre o padrão do kit) e a beat
 * sheet. Gera tudo com o modelo escolhido na hora (custo antes) e cada campo
 * tem "Preencher com IA" com prévia e Desfazer. Provas só com fonte.
 */

const CAMPOS: Array<{ chave: keyof BrandDoFilme; rotulo: string; longo?: boolean; dica: string }> = [
  { chave: "essencia", rotulo: "Essência", dica: "uma ou duas frases" },
  { chave: "publico", rotulo: "Público", dica: "quem assiste" },
  { chave: "promessa", rotulo: "Promessa", dica: "o que a marca entrega, sem prometer resultado" },
  { chave: "tom", rotulo: "Tom", dica: "como fala" },
  { chave: "evitar", rotulo: "Evitar", longo: true, dica: "o que o filme não pode fazer" },
  { chave: "movimento", rotulo: "Movimento", dica: "curvas, ritmo e assinatura de movimento" },
  { chave: "regras", rotulo: "Regras do filme", longo: true, dica: "regras extras" },
];

const MOMENTOS: BeatDoFilme["momento"][] = ["gancho", "tensao", "virada", "promessa", "prova", "marca"];

/** O BRAND.md guarda até 8 provas (lerBrand corta o resto). */
const MAXIMO_DE_PROVAS = 8;

function Conteudo({ filme, irPara }: { filme: Filme; irPara: IrPara }) {
  const { clientId, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const { modelo } = useModeloDaAcao("brand");
  const [b, setB] = useState<BrandDoFilme>(filme.brand);
  const [pedido, setPedido] = useState("");
  const [gerando, setGerando] = useState(false);
  const [custo, setCusto] = useState<number | null>(null);
  useEffect(() => setB(filme.brand), [filme.brand]);

  const salvar = async (novo: BrandDoFilme): Promise<boolean> => {
    try {
      const d = await chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, brand: novo });
      guardar(d.filme);
      return true;
    } catch (e) {
      avisarErro(e, "O BRAND.md não foi salvo");
      return false;
    }
  };

  const gerar = async () => {
    // O que está na tela (com edição ainda não salva) é o que o Desfazer devolve.
    const antes = b;
    const tinha = !!(antes.essencia || antes.publico || antes.promessa || antes.tom || antes.evitar || antes.movimento || antes.regras || antes.beats.length || antes.provas.length);
    setGerando(true);
    try {
      const d = await chamarMotion<{ filme: Filme; custo_usd: number }>("brand_gerar", { filme_id: filme.id, modelo_id: modelo ? modelo.id : undefined, pedido: pedido.trim() || undefined });
      guardar(d.filme);
      setCusto(d.custo_usd);
      atualizarCusto();
      if (tinha) toast.success("BRAND.md novo", { description: "O custo da geração não volta.", duration: 15000, action: { label: "Desfazer", onClick: () => void salvar(antes) } });
    } catch (e) {
      avisarErro(e, "O BRAND.md não foi gerado");
    } finally {
      setGerando(false);
    }
  };

  const md = brandMd(filme.nome, b, { nome: marca ? marca.nome : filme.nome, paleta: [], fontes: [] }, filme.entrevista);
  const baixar = () => {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "BRAND.md";
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const camposDaIA: CampoParaPreencher[] = CAMPOS.map((c) => ({ chave: String(c.chave), rotulo: c.rotulo, tipo: c.longo ? "texto_longo" : "texto", valorAtual: b[c.chave] as string, dica: `${c.dica}. Só o que está no kit, no dossiê e na entrevista.` }));
  const aplicar = (v: Record<string, unknown>) => {
    const novo = { ...b } as Record<string, unknown>;
    Object.keys(v).forEach((k) => (novo[k] = String(v[k] ?? "")));
    setB(novo as unknown as BrandDoFilme);
    return salvar(novo as unknown as BrandDoFilme).then(() => undefined);
  };
  const total = b.beats.reduce((s, x) => s + x.duracao_s, 0);
  const provasDosInsumos = (Array.isArray(filme.insumos.provas) ? (filme.insumos.provas as ProvaReal[]) : []).filter((p) => p && p.texto && p.fonte);
  const faltamNoBrand = provasDosInsumos.filter((p) => !b.provas.some((q) => textoDaProva(q.texto) === textoDaProva(p.texto)));
  const brandCheio = b.provas.length >= MAXIMO_DE_PROVAS;

  return (
    <div className="min-w-0 space-y-6">
      <Secao
        titulo="Gerar com IA"
        descricao={b.essencia ? "BRAND.md pronto (pode gerar de novo)" : "Ainda não gerado"}
        ajuda="Lê o kit, o dossiê, as provas com fonte e a entrevista. Nada de número ou prova sem fonte: campo sem base volta vazio."
        acao={
          <button type="button" className={botao.primario} onClick={() => void gerar()} disabled={gerando} data-gerar-brand="">
            {gerando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            {b.essencia ? "Gerar de novo" : "Gerar BRAND.md e beat sheet"}
          </button>
        }
      >
        <ModeloDaAcao chave="brand" alvo="brand" />
        <input value={pedido} onChange={(e) => setPedido(e.target.value)} maxLength={600} placeholder="Pedido extra (opcional): mais sóbrio, falar de atendimento..." className={juntar(campo, "mt-2")} aria-label="Pedido extra para o BRAND.md" />
        {custo !== null && <p className={juntar(texto.auxiliar, "mt-2")}>Custo desta geração: {usd(custo)}</p>}
      </Secao>

      <Secao
        titulo="BRAND.md"
        ajuda="Prevalece sobre os padrões do kit neste filme."
        acao={
          <>
            <PreencherComIA papel="motion" clientId={clientId} marcaId={marca ? marca.id : null} campos={camposDaIA} rotulo="Preencher tudo" onAplicar={aplicar} onDesfazer={aplicar} />
            <button type="button" className={juntar(botao.discreto, "ml-2")} onClick={baixar} aria-label="Baixar o BRAND.md">
              <Download className="h-4 w-4" />
            </button>
          </>
        }
      >
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          {CAMPOS.map((c) => (
            <label key={String(c.chave)} className="block min-w-0">
              <span className="flex min-w-0 items-center justify-between">
                <span className={texto.rotulo}>{c.rotulo}</span>
                <PreencherComIA papel="motion" clientId={clientId} marcaId={marca ? marca.id : null} compacto campos={[camposDaIA.find((x) => x.chave === c.chave)!]} onAplicar={aplicar} onDesfazer={aplicar} />
              </span>
              {c.longo ? (
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={b[c.chave] as string} onChange={(e) => setB({ ...b, [c.chave]: e.target.value })} onBlur={() => void salvar(b)} />
              ) : (
                <input className={campo} value={b[c.chave] as string} onChange={(e) => setB({ ...b, [c.chave]: e.target.value })} onBlur={() => void salvar(b)} />
              )}
            </label>
          ))}
        </div>
      </Secao>

      <Secao
        titulo="Provas com fonte"
        descricao={`${b.provas.length} de ${MAXIMO_DE_PROVAS}`}
        ajuda="Só estas podem virar número, depoimento ou prova na tela. 'Usar' traz uma prova dos Insumos para cá sem gerar de novo: vale para os próximos storyboards e cenas e para a conferência de números. As cenas já escritas não mudam sozinhas."
        recolher="mesa-motion:brand-provas"
      >
        {faltamNoBrand.length > 0 && (
          <div className="mb-3 min-w-0" data-provas-dos-insumos="">
            <span className={texto.rotulo}>Das provas de Insumos</span>
            <ul className={juntar(lista.aberta, "mt-1")}>
              {faltamNoBrand.map((p, i) => (
                <li key={`${p.texto}-${i}`} className={lista.linha}>
                  <span className={juntar(texto.corpo, "mr-2 min-w-0 flex-1")}>
                    {p.texto} <span className={texto.auxiliar}>({p.fonte})</span>
                  </span>
                  <button type="button" className={botao.barra} disabled={brandCheio} title={brandCheio ? `Até ${MAXIMO_DE_PROVAS} provas` : undefined} onClick={() => void salvar({ ...b, provas: b.provas.concat([p]).slice(0, MAXIMO_DE_PROVAS) })}>
                    Usar
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <ListaDeProvas provas={b.provas} maximo={MAXIMO_DE_PROVAS} onMudar={(novas) => salvar({ ...b, provas: novas })} />
        {!b.provas.length && <p className={texto.auxiliar}>Sem prova com fonte: o filme fala do método, sem número.</p>}
      </Secao>

      <Secao titulo="Beat sheet" descricao={`${b.beats.length} momentos · ${Math.round(total)} s`} ajuda="O arco do filme: gancho, tensão, virada, promessa, prova e marca." recolher="mesa-motion:beats">
        <ol className="min-w-0 space-y-2">
          {b.beats.map((x, i) => (
            <li key={i} className="flex min-w-0 flex-wrap items-center">
              <select className={juntar(campo, "mb-1 mr-2 w-auto")} value={x.momento} onChange={(e) => setB({ ...b, beats: b.beats.map((y, j) => (j === i ? { ...y, momento: e.target.value as BeatDoFilme["momento"] } : y)) })} onBlur={() => void salvar(b)} aria-label="Momento">
                {MOMENTOS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input className={juntar(campo, "mb-1 mr-2 min-w-[180px] flex-1")} value={x.texto} onChange={(e) => setB({ ...b, beats: b.beats.map((y, j) => (j === i ? { ...y, texto: e.target.value } : y)) })} onBlur={() => void salvar(b)} aria-label="O que acontece" />
              <input className={juntar(campo, "mb-1 mr-2 w-20")} type="number" min={2} max={12} step={0.5} value={x.duracao_s} onChange={(e) => setB({ ...b, beats: b.beats.map((y, j) => (j === i ? { ...y, duracao_s: Number(e.target.value) } : y)) })} onBlur={() => void salvar(b)} aria-label="Segundos" />
              <button type="button" className={botao.icone} aria-label="Tirar o momento" onClick={() => void salvar({ ...b, beats: b.beats.filter((_, j) => j !== i) })}>
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className={juntar(botao.discreto, "mt-2")} onClick={() => setB({ ...b, beats: b.beats.concat([{ momento: "gancho", texto: "", duracao_s: 4 }]) })}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Momento
        </button>
      </Secao>

      <Secao titulo="Prévia do BRAND.md" recolher="mesa-motion:brand-md" recolhidaDeInicio>
        <pre className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{md}</pre>
      </Secao>

      <button type="button" className={botao.primario} disabled={!b.essencia} onClick={() => void chamarMotion<{ filme: Filme }>("filme_salvar", { filme_id: filme.id, etapa: "storyboards" }).then((d) => (guardar(d.filme), irPara("storyboards"))).catch((e) => avisarErro(e, "Não foi salvo"))}>
        Seguir para os storyboards
        <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export default function EtapaBrand({ irPara }: { irPara: IrPara }) {
  return <ComFilme irPara={irPara}>{(filme) => <Conteudo key={filme.id} filme={filme} irPara={irPara} />}</ComFilme>;
}
