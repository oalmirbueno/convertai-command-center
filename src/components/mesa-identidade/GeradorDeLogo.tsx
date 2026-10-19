import { useMemo, useState } from "react";
import { Check, Loader2, Shapes, Shuffle, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { botao, campo, foco, juntar, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { custoAConfirmar } from "@/lib/laboratorio/api";
import type { LogoDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { fioDaMarca } from "../../../supabase/functions/mesa-identidade/modulos/coerencia-da-marca";
import { ESTILOS_DE_LOGO, type EstiloDeLogo, LIMITES_DA_LOGO, normalizarRespostaDaLogo, pedidoDaLogo, type RodadaDeLogo, type VariacaoDeLogo } from "../../../supabase/functions/mesa-identidade/modulos/nucleo-da-marca";
import { chamarLaboratorio, corpoDoLogoGerar } from "./identidadeApi";
import { enviarLogo } from "./arquivosDaMarca";
import { EscolhaDoJev, Pastilha, useProjetoDaMesa } from "./Comuns";
import { useNucleoDaMarca } from "./NucleoDaMarca";

/**
 * Logo de verdade (19/10/2026). Dono: "melhore a inteligência da área de
 * identidade". Gera variações de logo (símbolo + logotipo, fundo liso) pelo
 * Laboratório (função `laboratorio`, ação logo_gerar) com o núcleo da marca:
 * o nome escolhido, o conceito, a estratégia, a paleta e as fontes já
 * decididos. O Jev aponta a melhor e diz por quê; a equipe escolhe, refaz ou
 * varia a partir de uma. A escolhida vira a logo principal do Sistema (arquivo
 * na pasta do projeto) e fica em sistema.logo_gerada. Custo antes de gerar:
 * o primeiro pedido vai sem `confirmado` e a função devolve só o custo
 * ('confirmacao_necessaria'); o "Gerar" da faixa de custo reenvia com
 * `confirmado: true`.
 */

type LogoGerada = { rodadas?: RodadaDeLogo[]; escolhida?: { rodada_id: string; variacao_id: string; caminho: string; logo: LogoDoBrandbook; jev: boolean; motivo_jev: string | null; estilo: string; em: string } | null };

const QUANTAS = [2, 4, 6, 8];

/** O que a rodada guarda no projeto (imagem em data: fica só na tela: pesada demais para o banco). */
const paraGuardar = (r: RodadaDeLogo): RodadaDeLogo => ({ ...r, imagens: r.imagens.map((v) => ({ ...v, url: /^data:/i.test(v.url) ? "" : v.url })) });

export default function GeradorDeLogo({ onUsar }: { onUsar: (logo: LogoDoBrandbook) => Promise<void> }) {
  const mesa = useMesa();
  const { projeto, salvarParte } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const nucleo = useNucleoDaMarca();
  const arquetipoId = useMemo(() => {
    const f = fioDaMarca(projeto.dados || {});
    return f.arquetipo ? f.arquetipo.id : null;
  }, [projeto.dados]);
  const sistema = (projeto.dados.sistema || {}) as Record<string, any>;
  const salva = (sistema.logo_gerada || {}) as LogoGerada;
  const rodadasSalvas = Array.isArray(salva.rodadas) ? salva.rodadas : [];
  const [nova, setNova] = useState<RodadaDeLogo | null>(null);
  const rodada = nova || rodadasSalvas[0] || null;
  const [estilo, setEstilo] = useState<EstiloDeLogo | "">("");
  const [quantas, setQuantas] = useState<number>(LIMITES_DA_LOGO.padrao);
  const [pedido, setPedido] = useState("");
  const [aPartirDe, setAPartirDe] = useState<VariacaoDeLogo | null>(null);
  const [usando, setUsando] = useState<string | null>(null);
  const [quebradas, setQuebradas] = useState<string[]>([]);
  const [gerando, setGerando] = useState(false);
  /** O custo que a função disse (confirmacao_necessaria) e o pedido que será reenviado com confirmado. */
  const [confirmar, setConfirmar] = useState<{ total: number; corpo: Record<string, unknown>; quantas: number } | null>(null);

  const vaiJunto = [
    nucleo.nome ? `nome ${nucleo.nome}` : "",
    nucleo.conceito ? `conceito ${nucleo.conceito.nome}` : "",
    nucleo.arquetipo,
    nucleo.paleta.length ? `${nucleo.paleta.length} cores${nucleo.paleta_do_caminho ? " do conceito" : ""}` : "",
    nucleo.fontes.length ? nucleo.fontes.map((t) => t.familia).filter((x, i, l) => l.indexOf(x) === i).join(" + ") : "",
  ].filter(Boolean);
  const avisos: string[] = [];
  if (nucleo.faltam.indexOf("nome") >= 0) avisos.push("sem nome escolhido: vai o nome do cliente");
  if (!nucleo.paleta.length) avisos.push("sem paleta: o Laboratório escolhe as cores");
  if (!nucleo.conceito && !nucleo.posicionamento) avisos.push("sem conceito nem estratégia: a logo sai genérica");

  // O corpo que a função lê (nome, conceito, paleta em texto, estilo, n e a referência ao variar).
  const pedidoAtual = () => corpoDoLogoGerar(pedidoDaLogo(nucleo, { clientId: mesa.clientId, estilo, quantas, pedido: pedido.trim(), aPartirDe: aPartirDe ? aPartirDe.url : null, arquetipoId }), aPartirDe ? aPartirDe.path : null);

  const concluir = (d: unknown) => {
    const r = normalizarRespostaDaLogo(d, new Date().toISOString(), { estilo, quantas, aPartirDe: aPartirDe ? aPartirDe.path || null : null });
    if (!r.imagens.length) {
      toast.error("O Laboratório não devolveu imagens", { description: "Tente de novo; se repetir, avise a equipe do Laboratório." });
      return;
    }
    setNova(r);
    setAPartirDe(null);
    setQuebradas([]);
    void guardarRodada(r);
  };

  /** 1º passo: sem confirmado, a função só diz o custo. */
  const pedirCusto = async () => {
    if (gerando || !nucleo.nome) return;
    setGerando(true);
    const corpo = pedidoAtual();
    try {
      concluir(await chamarLaboratorio("logo_gerar", corpo));
    } catch (e) {
      const c = custoAConfirmar(e);
      if (c) setConfirmar({ total: c.total_usd, corpo, quantas });
      else avisarErro(e, "Logo da marca");
    } finally {
      setGerando(false);
    }
  };

  /** 2º passo: o mesmo pedido, com confirmado: true. */
  const gerar = async () => {
    if (gerando || !confirmar) return;
    setGerando(true);
    try {
      const d = await chamarLaboratorio("logo_gerar", { ...confirmar.corpo, confirmado: true });
      setConfirmar(null);
      concluir(d);
    } catch (e) {
      avisarErro(e, "Logo da marca");
    } finally {
      mesa.atualizarCusto();
      setGerando(false);
    }
  };

  const guardarRodada = async (r: RodadaDeLogo) => {
    try {
      await salvarParte("sistema", { logo_gerada: { ...salva, rodadas: [paraGuardar(r)].concat(rodadasSalvas.filter((x) => x.id !== r.id)).slice(0, 3) } });
    } catch (e) {
      avisarErro(e, "As variações apareceram, mas não ficaram guardadas no projeto");
    }
  };

  const usar = async (v: VariacaoDeLogo) => {
    if (!rodada) return;
    setUsando(v.id);
    try {
      const res = await fetch(v.url);
      if (!res.ok) throw new Error("A imagem desta variação não abriu mais. Gere de novo.");
      const blob = await res.blob();
      const tipo = /jpe?g/i.test(blob.type) ? "image/jpeg" : /webp/i.test(blob.type) ? "image/webp" : "image/png";
      const ext = tipo === "image/jpeg" ? "jpg" : tipo === "image/webp" ? "webp" : "png";
      const arquivo = new File([blob], `logo-gerada-${v.id}.${ext}`, { type: tipo });
      // O arquivo vai para a pasta do projeto (mesa/<cliente>/marca/identidade/<projeto>/logos/), com a prévia PNG.
      const logo = await enviarLogo(mesa.clientId, projeto.id, arquivo, "principal", "Logo gerada");
      await onUsar(logo);
      await salvarParte("sistema", {
        logo_gerada: {
          ...salva,
          rodadas: [paraGuardar(rodada)].concat(rodadasSalvas.filter((x) => x.id !== rodada.id)).slice(0, 3),
          escolhida: { rodada_id: rodada.id, variacao_id: v.id, caminho: logo.caminho, logo, jev: rodada.jev.id === v.id, motivo_jev: rodada.jev.id === v.id ? rodada.jev.motivo : null, estilo: rodada.estilo, em: new Date().toISOString() },
        },
      });
    } catch (e) {
      avisarErro(e, "A logo não foi guardada");
    } finally {
      setUsando(null);
    }
  };

  const escolhidaId = salva.escolhida && rodada && salva.escolhida.rodada_id === rodada.id ? salva.escolhida.variacao_id : null;
  const doJev = rodada && rodada.jev.id ? rodada.imagens.filter((v) => v.id === rodada.jev.id)[0] || null : null;

  return (
    <div className="min-w-0" data-gerador-de-logo="">
      <p className={juntar(texto.auxiliar, "mb-2 whitespace-normal")} data-nucleo-da-logo="">
        Vai junto: {vaiJunto.length ? vaiJunto.join(" · ") : "só o nome do cliente"}
        {avisos.length > 0 && <span className="block text-warning">{avisos.join("; ")}</span>}
      </p>
      <div className="-m-1 mb-2 flex min-w-0 flex-wrap items-center">
        <select className={juntar(campo, "m-1 h-8 w-auto min-w-0 max-w-[170px] text-[12px]")} value={estilo} onChange={(e) => setEstilo(e.target.value as EstiloDeLogo | "")} aria-label="Estilo da logo" title="Estilo da logo">
          <option value="">Estilo pelo arquétipo</option>
          {ESTILOS_DE_LOGO.map((x) => (
            <option key={x.valor} value={x.valor}>
              {x.rotulo}
            </option>
          ))}
        </select>
        <select className={juntar(campo, "m-1 h-8 w-auto text-[12px]")} value={String(quantas)} onChange={(e) => setQuantas(Number(e.target.value))} aria-label="Quantas variações" title="Quantas variações">
          {QUANTAS.map((q) => (
            <option key={q} value={q}>
              {q} variações
            </option>
          ))}
        </select>
        <input className={juntar(campo, "m-1 h-8 min-w-0 flex-1 basis-40")} value={pedido} maxLength={400} placeholder="Pedido para a logo (opcional)" onChange={(e) => setPedido(e.target.value)} aria-label="Pedido para a logo" />
        <button
          type="button"
          className={juntar(botao.primario, "m-1 h-8 gap-1 px-2")}
          disabled={!nucleo.nome || gerando}
          onClick={() => void pedirCusto()}
          title={aPartirDe ? `Gerar ${quantas} variações a partir da escolhida (mostra o custo antes)` : `Gerar ${quantas} variações de logo com o núcleo da marca (mostra o custo antes)`}
          data-pedir-logo=""
        >
          {gerando && !confirmar ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : aPartirDe ? <Shuffle className="h-4 w-4" aria-hidden="true" /> : <Shapes className="h-4 w-4" aria-hidden="true" />}
          <span className="sr-only">{aPartirDe ? "Gerar variações da escolhida" : rodada ? "Gerar de novo" : "Gerar logo"}</span>
        </button>
      </div>
      {confirmar && (
        <div className="mb-2 flex min-w-0 flex-wrap items-center rounded-md border border-border px-2 py-1.5" data-custo-da-logo="">
          <span className={juntar(texto.auxiliar, "min-w-0 flex-1")}>
            {confirmar.quantas} variações + escolha do Jev: {usd(confirmar.total)}, da carteira do cliente. Falha não cobra.
          </span>
          <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setConfirmar(null)} disabled={gerando}>
            Cancelar
          </button>
          <button type="button" className={juntar(botao.primario, "ml-1 h-8 gap-1 px-2")} onClick={() => void gerar()} disabled={gerando} data-confirmar-logo="">
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Gerar · {usd(confirmar.total)}
          </button>
        </div>
      )}
      {aPartirDe && (
        <p className={juntar(texto.auxiliar, "mb-2 flex min-w-0 items-center")} data-variar-de={aPartirDe.id}>
          <span className="min-w-0 flex-1 truncate">Próxima rodada: variações da opção {rodada ? rodada.imagens.indexOf(aPartirDe) + 1 : ""}</span>
          <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setAPartirDe(null)} aria-label="Não variar desta" title="Não variar desta">
            <X className="h-4 w-4" />
          </button>
        </p>
      )}

      {rodada && rodada.imagens.length > 0 && (
        <>
          <ul className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Variações de logo" data-rodada-de-logo={rodada.id}>
            {rodada.imagens.map((v, i) => {
              const ehJev = !!doJev && doJev.id === v.id;
              const usada = escolhidaId === v.id;
              const quebrada = !v.url || quebradas.indexOf(v.id) >= 0;
              return (
                <li key={v.id} className="min-w-0" data-variacao-de-logo={v.id} data-do-jev={ehJev ? "sim" : undefined} data-escolhida={usada ? "sim" : undefined}>
                  <div className={juntar("relative flex aspect-square items-center justify-center overflow-hidden rounded-md border bg-white p-2", ehJev ? "border-primary ring-1 ring-primary" : "border-border", usada && "ring-2 ring-primary")}>
                    {quebrada ? (
                      <span className={juntar(texto.etiqueta, "text-center text-muted-foreground")}>Imagem expirou</span>
                    ) : (
                      <img src={v.url} alt={`Variação ${i + 1} da logo`} loading="lazy" className="max-h-full max-w-full object-contain" onError={() => setQuebradas((q) => (q.indexOf(v.id) >= 0 ? q : q.concat([v.id])))} />
                    )}
                    {(ehJev || usada) && (
                      <span className="absolute left-1 top-1">
                        <Pastilha tom="bom">{usada ? "Na marca" : "Jev"}</Pastilha>
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center justify-end">
                    <span className={juntar(texto.etiqueta, "mr-auto text-muted-foreground")}>{i + 1}</span>
                    {/* Só ícone (nome no aria-label e no title). */}
                    <button type="button" className={juntar(botao.icone, "disabled:opacity-50")} disabled={!!usando || quebrada || usada} onClick={() => void usar(v)} aria-label={`Usar a variação ${i + 1} como logo principal`} title="Usar como logo principal" data-usar-logo={v.id}>
                      {usando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    </button>
                    <button type="button" className={juntar(botao.icone, foco, "disabled:opacity-50", aPartirDe && aPartirDe.id === v.id && "text-primary")} disabled={quebrada} onClick={() => setAPartirDe(aPartirDe && aPartirDe.id === v.id ? null : v)} aria-pressed={!!aPartirDe && aPartirDe.id === v.id} aria-label={`Variar a partir da variação ${i + 1}`} title="Variar a partir desta" data-variar-logo={v.id}>
                      <Shuffle className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {doJev && rodada.jev.motivo && <EscolhaDoJev className="mt-2" linha={`Escolha do Jev (opção ${rodada.imagens.indexOf(doJev) + 1}): ${rodada.jev.motivo}`} />}
          {!doJev && <p className={juntar(texto.auxiliar, "mt-2")}>O Jev não apontou uma escolha nesta rodada.</p>}
        </>
      )}
      {!rodada && <p className={texto.auxiliar}>Símbolo + logotipo em fundo liso, a partir do que a marca já decidiu. A escolhida vira a logo principal; o vetor final (SVG) a equipe faz no editor.</p>}
    </div>
  );
}
