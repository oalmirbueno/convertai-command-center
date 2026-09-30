import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Loader2, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { EstadoDeErro } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { CREDITO_DA_BASE } from "@/lib/uiux/carregar";
import EscolhaDoProduto from "@/components/uiux/EscolhaDoProduto";
import { normalizarHex } from "../../../supabase/functions/_shared/cores-da-marca";
import { ROTULO_DO_PAPEL_DO_APOIO, type ApoioDaPaleta, type PapelDoApoio } from "../../../supabase/functions/_shared/uiux/apoio-da-paleta";
import { lerBaseDaMarca } from "../../../supabase/functions/_shared/uiux/consultas";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { useProjetoDaMesa } from "./Comuns";
import { Faixa } from "./PaletaDaMarca";

/** Jev da marca: as listas de produto e de pares (~12 mil tokens) a US$ 0,042 por milhão. */
export const CUSTO_DO_JEV_DA_MARCA = (12_000 * 0.042) / 1e6;

type Cor = { nome: string; papel: string; hex: string };

/**
 * O tipo de produto da marca (frente UXM), guardado em
 * dados.sistema.base_de_design: a lista com busca ou a sugestão do Jev.
 * Serve à paleta do setor e aos pares da base.
 */
export function ProdutoDaMarca() {
  const { projeto, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const base = lerBaseDaMarca(((projeto.dados.sistema || {}) as Record<string, unknown>).base_de_design);
  const [aberta, setAberta] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [sugeridos, setSugeridos] = useState<Array<{ id: string; prob: number }>>([]);

  const salvar = async (no: string, origem: "jev" | "equipe") => {
    setOcupado("salvar");
    try {
      const d = await chamarIdentidade<{ projeto: ProjetoDeIdentidade; anterior: unknown }>("base_salvar_marca", { projeto_id: projeto.id, produto: no, origem, versao: projeto.versao });
      guardar(d && d.projeto);
      toast.success("Tipo de produto salvo", {
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            const antes = lerBaseDaMarca(d && d.anterior);
            chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("base_salvar_marca", { projeto_id: projeto.id, produto: antes.produto, par: antes.par, paleta_setor: antes.paleta_setor })
              .then((x) => guardar(x && x.projeto))
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "O tipo de produto não foi salvo");
    } finally {
      setOcupado(null);
    }
  };

  const sugerir = async () => {
    setOcupado("jev");
    try {
      const d = await chamarIdentidade<{ produto: { escolhido: { id: string; prob: number } | null; top: Array<{ id: string; prob: number }> }; sem_jev: boolean; aviso?: string }>("base_sugerir_marca", { projeto_id: projeto.id });
      setSugeridos(d.produto ? d.produto.top : []);
      if (d.sem_jev) toast.warning(d.aviso || "Escolha à mão: o Jev não respondeu.");
      setAberta(true);
    } catch (e) {
      avisarErro(e, "O Jev não sugeriu");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center" data-produto-da-marca={base.produto ? base.produto.id : ""}>
      <span className={juntar(texto.rotulo, "mr-2")}>Tipo de produto</span>
      <span className={juntar(texto.corpo, "mr-2 min-w-0 truncate")}>{base.produto ? base.produto.rotulo || base.produto.id : "não escolhido"}</span>
      <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => setAberta(true)}>
        {base.produto ? "Trocar" : "Escolher"}
      </button>
      <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => void sugerir()} title={`Custo do Jev: ~${usd(CUSTO_DO_JEV_DA_MARCA)}`}>
        {ocupado === "jev" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
        Sugerir com o Jev
      </button>
      <EscolhaDoProduto
        aberta={aberta}
        onFechar={() => setAberta(false)}
        atual={base.produto ? base.produto.id : null}
        sugeridos={sugeridos}
        onEscolher={(no) => {
          setAberta(false);
          void salvar(no, sugeridos.some((s) => s.id === no) ? "jev" : "equipe");
        }}
      />
    </div>
  );
}

const ORIGEM: Record<string, string> = { marca: "da marca", ajuste: "ajuste" };

/**
 * Paleta do setor (frente UXM): a referência do setor na base UI UX Pro Max
 * (recolhida) e o apoio para a marca. Primária, secundária e destaque da
 * marca nunca mudam; da base só entram fundo, texto, cartão, suave, borda,
 * erro e anel de foco, no matiz da marca e com o contraste AA conferido por
 * código. "Usar como proposta" vai para as propostas de paleta (a paleta do
 * sistema não muda; a passagem para o kit continua pelo kit_sugerir).
 */
export default function PaletaDoSetor({ cores }: { cores: Cor[] }) {
  const { projeto, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const base = lerBaseDaMarca(((projeto.dados.sistema || {}) as Record<string, unknown>).base_de_design);
  const [aberto, setAberto] = useEstadoDaTela<boolean>(`mesa-identidade:${projeto.id}:paleta-do-setor`, false, { validar: (v): v is boolean => typeof v === "boolean" });
  const [verSetor, setVerSetor] = useState(false);
  const [propondo, setPropondo] = useState(false);
  const assinatura = cores.map((c) => `${normalizarHex(c.hex) || ""}:${c.papel}`).join("|");
  const q = useQuery({
    queryKey: ["mesa-identidade", "paleta-do-setor", projeto.id, base.produto ? base.produto.id : null, assinatura],
    queryFn: () => chamarIdentidade<{ setor: Record<string, string>; apoio: ApoioDaPaleta; produto: { rotulo: string }; citacao: string }>("paleta_do_setor", { projeto_id: projeto.id, produto: base.produto ? base.produto.id : undefined }),
    enabled: aberto && !!base.produto,
    staleTime: 5 * 60_000,
    retry: false,
  });

  const propor = async () => {
    setPropondo(true);
    try {
      const d = await chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("base_proposta", { projeto_id: projeto.id, tipo: "paleta", produto: base.produto ? base.produto.id : undefined });
      guardar(d && d.projeto);
      toast.success("Proposta guardada nas paletas do diretor");
    } catch (e) {
      avisarErro(e, "A proposta não foi guardada");
    } finally {
      setPropondo(false);
    }
  };

  const setor = q.data ? q.data.setor : null;
  const doSetor = setor
    ? (["primaria", "secundaria", "destaque", "fundo", "texto", "borda", "erro", "anel"] as const).map((k) => ({ hex: String(setor[k] || ""), nome: k })).filter((c) => /^#[0-9a-f]{6}$/i.test(c.hex))
    : [];
  const apoio = q.data ? q.data.apoio : null;
  return (
    <div className="mt-6 min-w-0 border-t border-border pt-5" data-paleta-do-setor="">
      <div className="mb-2 flex min-w-0 items-center">
        <button type="button" className={juntar(botao.discreto, "relative -left-1 px-1")} aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
          <span className={texto.rotulo}>Do setor</span>
        </button>
        <span className={juntar(texto.auxiliar, "ml-1 min-w-0 truncate")} title={CREDITO_DA_BASE}>
          {base.produto ? base.produto.rotulo || base.produto.id : "escolha o tipo de produto"}
        </span>
      </div>
      {aberto && (
        <div className="min-w-0 space-y-3">
          <ProdutoDaMarca />
          {base.produto && q.isLoading && <p className={juntar(texto.auxiliar, "flex items-center")}><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> Calculando o apoio</p>}
          {q.error && <EstadoDeErro titulo="A paleta do setor não abriu" descricao={textoDoErro(q.error)} acao={<button type="button" className={botao.secundario} onClick={() => void q.refetch()}>Tentar de novo</button>} />}
          {setor && (
            <div className="min-w-0">
              <button type="button" className={juntar(botao.discreto, "relative -left-1 px-1")} aria-expanded={verSetor} onClick={() => setVerSetor(!verSetor)}>
                {verSetor ? <ChevronDown className="mr-1 h-3.5 w-3.5" /> : <ChevronRight className="mr-1 h-3.5 w-3.5" />}
                Referência do setor ({q.data ? q.data.citacao : ""})
              </button>
              {verSetor && <Faixa cores={doSetor} altura={32} />}
            </div>
          )}
          {apoio && (
            <div className="min-w-0" data-apoio-da-paleta="">
              <div className="mb-1.5 flex min-w-0 items-center">
                <span className={juntar(texto.rotulo, "min-w-0 flex-1")}>Apoio para a sua marca</span>
                <button type="button" className={juntar(botao.discreto, "h-8 shrink-0")} disabled={propondo || !cores.length} onClick={() => void propor()} title={cores.length ? undefined : "A marca ainda não tem cores no sistema"}>
                  {propondo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                  Usar como proposta
                </button>
              </div>
              <Faixa cores={apoio.papeis.map((p) => ({ hex: p.hex, nome: ROTULO_DO_PAPEL_DO_APOIO[p.papel as PapelDoApoio] || p.papel }))} altura={40} />
              <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-4 sm:grid-cols-3 lg:grid-cols-5">
                {apoio.papeis.map((p) => (
                  <span key={p.papel} className={juntar(texto.etiqueta, "truncate text-muted-foreground")} title={p.origem}>
                    {ROTULO_DO_PAPEL_DO_APOIO[p.papel as PapelDoApoio] || p.papel}: {ORIGEM[p.origem] || "do setor"}
                  </span>
                ))}
              </div>
              {apoio.avisos.map((a) => (
                <p key={a} className={juntar(texto.auxiliar, "mt-1 whitespace-normal text-warning")}>
                  {a}
                </p>
              ))}
              {!apoio.avisos.length && <span className={juntar(etiqueta, "mt-2 inline-block bg-primary/10 text-primary")}>contraste conferido</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
