import { useMemo, useState } from "react";
import { ArrowRight, Link2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AjudaRecolhida, JanelaCentral } from "@/components/sistema";
import { botao, foco, juntar, lista, texto, toqueCompacto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { rotuloDaEtapa } from "../../../supabase/functions/mesa-identidade/modulos/identidade-etapas";
import { ROTULO_DA_CATEGORIA } from "../../../supabase/functions/_shared/tipografia-da-marca";
import {
  type Coerencia,
  conferirPorCodigo,
  DIRECAO_DO_ARQUETIPO,
  fioDaMarca,
  type ItemDaCoerencia,
  juntarCoerencia,
} from "../../../supabase/functions/mesa-identidade/modulos/coerencia-da-marca";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, podeIrPara, useProjetoDaMesa } from "./Comuns";

/**
 * O fio da marca (frente IDR, 30/09). Dono: "deixe mais inteligente o motor
 * e mais organizado ali da identidade visual, mas curti o fluxo". Uma linha
 * só no alto de cada etapa, com o que a marca já decidiu (nome, arquétipo,
 * cores, fontes e tagline) e a coerência entre as peças. Tocar abre a janela
 * central com cada peça contra a estratégia (regras do código e a nota do
 * Jev) e leva à etapa que ajusta. O fluxo das etapas não muda.
 */

const TOM: Record<ItemDaCoerencia["situacao"], "bom" | "alerta" | "neutro"> = { ok: "bom", atencao: "alerta", falta: "neutro" };
const ROTULO_DA_SITUACAO: Record<ItemDaCoerencia["situacao"], string> = { ok: "coerente", atencao: "conferir", falta: "falta" };

/** A coerência da tela: a do Jev gravada, se ainda vale para o projeto como está; senão só o código. */
export function coerenciaDaTela(projeto: ProjetoDeIdentidade): { coerencia: Coerencia; desatualizada: boolean } {
  const f = fioDaMarca(projeto.dados || {});
  const codigo = conferirPorCodigo(f);
  const salva = projeto.dados && projeto.dados.coerencia ? (projeto.dados.coerencia as Coerencia) : null;
  if (!salva || !Array.isArray(salva.itens)) return { coerencia: juntarCoerencia(codigo, null), desatualizada: false };
  // O código vale sempre (é de agora); a nota do Jev fica com cada dimensão até a próxima conferência.
  const itens = codigo.map((i) => {
    const antes = salva.itens.filter((x) => x.dimensao === i.dimensao)[0];
    return antes && antes.nota_jev !== null ? { ...i, nota_jev: antes.nota_jev, motivos: i.motivos.concat(antes.motivos.filter((m) => /Jev/.test(m))), situacao: i.situacao === "ok" && antes.situacao === "atencao" ? ("atencao" as const) : i.situacao } : i;
  });
  const conjunto = salva.itens.filter((x) => x.dimensao === "conjunto")[0];
  if (conjunto) itens.push(conjunto);
  const desatualizada = !!projeto.atualizado_em && !!salva.em && projeto.atualizado_em > salva.em && Date.parse(projeto.atualizado_em) - Date.parse(salva.em) > 5000;
  return { coerencia: { ...salva, itens }, desatualizada };
}

function Amostras({ cores }: { cores: Array<{ hex: string; nome: string }> }) {
  if (!cores.length) return null;
  return (
    <span className="ml-1 inline-flex shrink-0 items-center" aria-label={`Paleta: ${cores.map((c) => c.hex).join(", ")}`}>
      {cores.slice(0, 6).map((c) => (
        <span key={c.hex} className="-ml-1 inline-block h-4 w-4 rounded-full border border-background first:ml-0" style={{ background: c.hex }} title={`${c.nome || c.hex} ${c.hex}`} />
      ))}
    </span>
  );
}

export default function FioDaMarca() {
  const mesa = useMesa();
  const { projeto, guardar, irPara } = useProjetoDaMesa();
  const [aberta, setAberta] = useState(false);
  const [conferindo, setConferindo] = useState(false);
  const f = useMemo(() => fioDaMarca(projeto.dados || {}), [projeto.dados]);
  const { coerencia, desatualizada } = useMemo(() => coerenciaDaTela(projeto), [projeto]);
  const atencao = coerencia.itens.filter((i) => i.situacao === "atencao").length;
  const faltam = coerencia.itens.filter((i) => i.situacao === "falta").length;
  const direcao = f.arquetipo ? DIRECAO_DO_ARQUETIPO[f.arquetipo.id as keyof typeof DIRECAO_DO_ARQUETIPO] : null;
  const titulo = f.fontes.filter((t) => t.uso === "titulo")[0] || f.fontes[0];
  const vazio = !f.nome && !f.arquetipo && !f.cores.length && !f.fontes.length;
  if (vazio && projeto.etapa === "briefing") return null;

  const conferir = async () => {
    setConferindo(true);
    try {
      const r = await chamarIdentidade<{ projeto: ProjetoDeIdentidade; coerencia: Coerencia; custo_usd: number }>("coerencia_conferir", { projeto_id: projeto.id });
      guardar(r.projeto);
      mesa.atualizarCusto();
      if (r.coerencia.aviso) toast.info("Coerência conferida só pelo código", { description: r.coerencia.aviso });
      else toast.success(r.coerencia.nota === null ? "Coerência conferida" : `Coerência ${r.coerencia.nota} de 100`);
    } catch (e) {
      toast.error("A coerência não foi conferida", { description: textoDoErro(e) });
    } finally {
      setConferindo(false);
    }
  };

  const resumo = coerencia.nota !== null ? `Coerência ${coerencia.nota}` : atencao ? `${atencao} para conferir` : faltam ? `Falta${faltam === 1 ? "" : "m"} ${faltam}` : "Coerente";
  const tomDoResumo = coerencia.nota !== null ? (coerencia.nota >= 70 ? "bom" : coerencia.nota >= 45 ? "neutro" : "alerta") : atencao ? "alerta" : faltam ? "neutro" : "bom";

  return (
    <div className="mb-3 flex min-w-0 flex-wrap items-center border-b border-border/60 pb-2" data-fio-da-marca="" data-coerencia={coerencia.nota === null ? "" : String(coerencia.nota)}>
      <span className={juntar(texto.rotulo, "mr-2 inline-flex shrink-0 items-center")}>
        <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Fio da marca
      </span>
      <span className={juntar(texto.corpo, "mr-3 min-w-0 max-w-[220px] truncate font-medium")} title={f.nome || "Sem nome"}>
        {f.nome || "Sem nome"}
      </span>
      {f.arquetipo && <span className={juntar(texto.auxiliar, "mr-3 shrink-0")}>{f.arquetipo.rotulo}</span>}
      <Amostras cores={f.cores} />
      {titulo && <span className={juntar(texto.auxiliar, "ml-3 min-w-0 max-w-[200px] truncate")}>{f.fontes.map((t) => t.familia).filter((x, i, l) => l.indexOf(x) === i).join(" + ")}</span>}
      {f.tagline && <span className={juntar(texto.auxiliar, "ml-3 hidden min-w-0 max-w-[260px] truncate italic md:inline")}>{f.tagline}</span>}
      <span className="min-w-0 flex-1" />
      <button
        type="button"
        className={juntar(toqueCompacto, "ml-2 inline-flex h-7 shrink-0 items-center rounded-md px-1.5 hover:bg-muted", foco)}
        onClick={() => setAberta(true)}
        aria-label={`${resumo}. Ver a coerência da marca`}
        data-abrir-coerencia=""
      >
        <Pastilha tom={tomDoResumo}>{resumo}</Pastilha>
        {desatualizada && <span className={juntar(texto.etiqueta, "ml-1 text-muted-foreground")}>mudou</span>}
      </button>

      <JanelaCentral
        aberta={aberta}
        onMudar={setAberta}
        titulo="Coerência da marca"
        icone={<ShieldCheck className="h-4 w-4" />}
        descricao={coerencia.nota !== null ? `Nota ${coerencia.nota} de 100${desatualizada ? " · o projeto mudou depois da conferência" : ""}` : "Regras do código; a nota vem do Jev"}
        ajuda="Cada peça contra a estratégia. As regras fixas (contraste, leitura, cor da logo na paleta, tamanho do nome e o que o arquétipo pede de cor e letra) valem na hora. O Jev dá a nota de quanto nome, paleta, tipografia, tagline e o conjunto expressam a estratégia. É aviso: nada muda sozinho; a equipe decide e ajusta na etapa."
        largura="md"
        rodape={
          <div className="flex min-w-0 flex-wrap items-center justify-end">
            <span className={juntar(texto.auxiliar, "m-1 min-w-0 flex-1")}>Jev: menos de 1 centavo</span>
            <button type="button" className={juntar(botao.primario, "m-1 h-8")} onClick={() => void conferir()} disabled={conferindo} data-conferir-coerencia="">
              {conferindo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />} {coerencia.jev ? "Conferir de novo com o Jev" : "Conferir com o Jev"}
            </button>
          </div>
        }
      >
        {coerencia.aviso && <p className={juntar(texto.auxiliar, "mb-2")}>{coerencia.aviso}</p>}
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Peças da marca">
          {coerencia.itens.map((i) => (
            <li key={i.dimensao} className={juntar(lista.linha, "items-start")} data-dimensao={i.dimensao} data-situacao={i.situacao}>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center">
                  <span className={juntar(texto.corpo, "font-medium")}>{i.rotulo}</span>
                  <span className="ml-2">
                    <Pastilha tom={TOM[i.situacao]}>{ROTULO_DA_SITUACAO[i.situacao]}</Pastilha>
                  </span>
                  {i.nota_jev !== null && <span className={juntar(texto.etiqueta, "ml-2 tabular-nums text-muted-foreground")}>Jev {Math.round(i.nota_jev * 100)}</span>}
                </span>
                {i.motivos.map((m) => (
                  <span key={m} className={juntar(texto.auxiliar, "mt-0.5 block whitespace-normal")}>
                    {m}
                  </span>
                ))}
              </span>
              {i.situacao !== "ok" && podeIrPara(projeto, i.etapa) && (
                <button
                  type="button"
                  className={juntar(botao.discreto, "ml-2 h-8 shrink-0")}
                  onClick={() => {
                    setAberta(false);
                    irPara(i.etapa);
                  }}
                >
                  {rotuloDaEtapa(i.etapa)} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {direcao && f.arquetipo && (
          <div className="mt-4 border-t border-border pt-3" data-direcao-do-arquetipo={f.arquetipo.id}>
            <p className={juntar(texto.rotulo, "mb-1.5 flex items-center")}>
              O que o {f.arquetipo.rotulo} costuma pedir
              <AjudaRecolhida rotulo="Sobre a direção do arquétipo" className="ml-1">
                Ponto de partida da direção de arte, não regra: entra nos pedidos de paleta, fontes e nomes para as propostas nascerem coerentes. A equipe pode ousar, sabendo por quê.
              </AjudaRecolhida>
            </p>
            <ul className={juntar(lista.aberta)} aria-label="Direção do arquétipo">
              <li className={juntar(lista.linha, "py-1.5")}>
                <span className={juntar(texto.rotulo, "w-20 shrink-0")}>Cor</span>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{direcao.cor.ideia}</span>
              </li>
              <li className={juntar(lista.linha, "py-1.5")}>
                <span className={juntar(texto.rotulo, "w-20 shrink-0")}>Letra</span>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>
                  {direcao.letra.ideia}
                  {direcao.letra.evitar.length ? `; evitar ${direcao.letra.evitar.map((c) => ROTULO_DA_CATEGORIA[c].toLowerCase()).join(", ")}` : ""}
                </span>
              </li>
              <li className={juntar(lista.linha, "py-1.5")}>
                <span className={juntar(texto.rotulo, "w-20 shrink-0")}>Nome</span>
                <span className={juntar(texto.corpo, "min-w-0 flex-1")}>{direcao.nome}</span>
              </li>
            </ul>
          </div>
        )}
      </JanelaCentral>
    </div>
  );
}
