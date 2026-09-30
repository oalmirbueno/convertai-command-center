import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, History, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  GrupoDeCampos,
  MenuMais,
  Secao,
  SeletorCompacto,
  botao,
  campo as estiloDoCampo,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import { chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import EditorDeCampos from "./EditorDeCampos";
import {
  type BlocoDoBriefing,
  type CampoDoBriefing,
  MODELOS_DE_FABRICA,
  type ModeloDeBriefing,
  type SlugDoModelo,
  SLUGS_DE_BRIEFING,
} from "../../../supabase/functions/_shared/briefing-modelos";
import { chaveNova, moverItem } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Editor de modelos de briefing (frente BRF2, 30/09/2026), na aba Modelos de
 * /briefings. O dono muda as perguntas na tela (arrastar, tipo, condição,
 * obrigatória, blocos) e salva uma VERSÃO NOVA: a anterior fica no histórico
 * e os links já gerados seguem com a cópia deles. Só admin salva (a mesma
 * régua do banco); a equipe vê.
 */

type Versao = { id: string; versao: number; titulo: string | null; nota: string | null; ativo: boolean; criado_em: string; conteudo: unknown };
type RespostaDasVersoes = { vigente: ModeloDeBriefing; versoes: Versao[]; fabrica: ModeloDeBriefing };

const copia = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
};

/** Troca as chaves provisórias das perguntas novas pela chave do texto (e as condições que apontam para elas). */
function chavesDefinitivas(m: ModeloDeBriefing, novas: string[]): ModeloDeBriefing {
  const todas: string[] = [];
  m.blocos.forEach((b) => b.campos.forEach((c) => todas.push(c.key)));
  const troca: Record<string, string> = {};
  novas.forEach((k) => {
    const c = m.blocos.reduce<CampoDoBriefing | null>((achado, b) => achado || b.campos.find((x) => x.key === k) || null, null);
    if (!c || !c.pergunta.trim()) return;
    const usadas = todas.filter((x) => x !== k).concat(Object.keys(troca).map((x) => troca[x]));
    troca[k] = chaveNova(c.pergunta, usadas);
  });
  return {
    ...m,
    blocos: m.blocos.map((b) => ({
      ...b,
      campos: b.campos.map((c) => ({
        ...c,
        key: troca[c.key] || c.key,
        mostrarSe: c.mostrarSe ? { ...c.mostrarSe, key: troca[c.mostrarSe.key] || c.mostrarSe.key } : undefined,
      })),
    })),
  };
}

export default function EditorDeModelos({ podeSalvar }: { podeSalvar: boolean }) {
  const qc = useQueryClient();
  const [slug, setSlug] = useState<SlugDoModelo>("site");
  const [rascunho, setRascunho] = useState<ModeloDeBriefing | null>(null);
  const [novas, setNovas] = useState<string[]>([]);
  const [nota, setNota] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);

  const versoes = useQuery({
    queryKey: ["briefing-modelos", slug],
    queryFn: () => chamarAgenteDoBriefing<RespostaDasVersoes>("versoes_do_modelo", { slug }),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (versoes.data) {
      setRascunho(copia(versoes.data.vigente));
      setNovas([]);
      setAvisos([]);
    }
  }, [versoes.data]);

  const todasAsChaves = useMemo(() => {
    const k: string[] = [];
    (rascunho ? rascunho.blocos : []).forEach((b) => b.campos.forEach((c) => k.push(c.key)));
    return k;
  }, [rascunho]);

  const mudou = !!rascunho && !!versoes.data && JSON.stringify(rascunho) !== JSON.stringify(versoes.data.vigente);
  const semTexto = !!rascunho && rascunho.blocos.some((b) => !b.titulo.trim() || b.campos.some((c) => !c.pergunta.trim()));

  const mudarBlocos = (blocos: BlocoDoBriefing[]) => rascunho && setRascunho({ ...rascunho, blocos });
  const mudarCampos = (i: number, campos: CampoDoBriefing[]) => {
    if (!rascunho) return;
    campos.forEach((c) => {
      if (todasAsChaves.indexOf(c.key) < 0 && novas.indexOf(c.key) < 0) setNovas((l) => l.concat(c.key));
    });
    mudarBlocos(rascunho.blocos.map((b, k) => (k === i ? { ...b, campos } : b)));
  };

  const salvar = async () => {
    if (!rascunho) return;
    setSalvando(true);
    try {
      const conteudo = chavesDefinitivas(rascunho, novas);
      const r = await chamarAgenteDoBriefing<{ versao: number; avisos: string[] }>("salvar_modelo", { slug, conteudo, nota });
      setAvisos(r.avisos || []);
      setNota("");
      toast.success(`Versão ${r.versao} salva. Os links novos já usam esta versão; os antigos seguem com a deles.`);
      void qc.invalidateQueries({ queryKey: ["briefing-modelos", slug] });
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível salvar a versão."));
    } finally {
      setSalvando(false);
    }
  };

  const usarComoBase = (m: unknown, rotulo: string) => {
    if (!m || typeof m !== "object") return;
    setRascunho({ ...copia(m as ModeloDeBriefing), slug });
    setNovas([]);
    toast.info(`${rotulo} carregada no editor. Salve para virar a versão nova.`);
  };

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex min-w-0 flex-wrap items-center">
        <SeletorCompacto
          rotulo="Modelo"
          listaQuandoNaoCabe
          valor={slug}
          onEscolher={(v) => {
            if (mudou && !window.confirm("Há mudanças não salvas neste modelo. Trocar mesmo assim?")) return;
            setSlug(v as SlugDoModelo);
          }}
          opcoes={SLUGS_DE_BRIEFING.map((s) => ({ valor: s, rotulo: MODELOS_DE_FABRICA[s].nome }))}
        />
        {versoes.data && <span className={juntar(texto.auxiliar, "ml-3")}>Versão em uso: {versoes.data.vigente.versao}</span>}
      </div>

      {versoes.isLoading || !rascunho ? (
        versoes.isError ? (
          <EstadoDeErro titulo="Não foi possível abrir o modelo." descricao={textoDoErroDoBriefing(versoes.error)} acao={<button type="button" onClick={() => void versoes.refetch()} className={botao.secundario}>Tentar de novo</button>} />
        ) : (
          <Carregando linhas={4} rotulo="Abrindo o modelo" />
        )
      ) : (
        <>
          <Secao titulo="Dados do modelo" recolher={`briefing-editor:dados:${slug}`} resumo={rascunho.titulo}>
            <GrupoDeCampos colunas={2}>
              <CampoDeFormulario rotulo="Título">
                <input className={estiloDoCampo} value={rascunho.titulo} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, titulo: e.target.value })} aria-label="Título do modelo" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Nome curto">
                <input className={estiloDoCampo} value={rascunho.nome} maxLength={40} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} aria-label="Nome curto" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Linha de estado">
                <input className={estiloDoCampo} value={rascunho.descricao} maxLength={90} onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value })} aria-label="Linha de estado" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Minutos para responder">
                <input className={estiloDoCampo} inputMode="numeric" value={String(rascunho.minutos)} onChange={(e) => setRascunho({ ...rascunho, minutos: Math.max(1, Math.min(90, Number(e.target.value) || 1)) })} aria-label="Minutos" />
              </CampoDeFormulario>
            </GrupoDeCampos>
          </Secao>

          {rascunho.blocos.map((b, i) => (
            <Secao
              key={`${b.id}-${i}`}
              titulo={b.titulo || "Bloco sem título"}
              descricao={`${b.campos.length} ${b.campos.length === 1 ? "pergunta" : "perguntas"}`}
              recolher={`briefing-editor:${slug}:${b.id}`}
              divisoria
              acao={
                <span className="flex items-center">
                  <button type="button" onClick={() => mudarBlocos(moverItem(rascunho.blocos, i, i - 1))} disabled={i === 0} className={botao.icone} aria-label={`Subir o bloco ${b.titulo}`}>
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => mudarBlocos(moverItem(rascunho.blocos, i, i + 1))} disabled={i === rascunho.blocos.length - 1} className={botao.icone} aria-label={`Descer o bloco ${b.titulo}`}>
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => mudarBlocos(rascunho.blocos.filter((_, k) => k !== i))} disabled={rascunho.blocos.length <= 1} className={botao.icone} aria-label={`Tirar o bloco ${b.titulo}`}>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              }
            >
              <CampoDeFormulario rotulo="Título do bloco">
                <input className={juntar(estiloDoCampo, "sm:max-w-[360px]")} value={b.titulo} maxLength={80} onChange={(e) => mudarBlocos(rascunho.blocos.map((x, k) => (k === i ? { ...x, titulo: e.target.value } : x)))} aria-label="Título do bloco" />
              </CampoDeFormulario>
              <div className="mt-3 min-w-0">
                <EditorDeCampos
                  rotulo={`Perguntas do bloco ${b.titulo}`}
                  campos={b.campos}
                  anteriores={rascunho.blocos.slice(0, i).reduce<CampoDoBriefing[]>((acc, x) => acc.concat(x.campos), [])}
                  todasAsChaves={todasAsChaves}
                  onMudar={(campos) => mudarCampos(i, campos)}
                />
              </div>
            </Secao>
          ))}

          <button
            type="button"
            onClick={() => mudarBlocos(rascunho.blocos.concat({ id: `bloco${Date.now().toString(36)}`, titulo: "Novo bloco", campos: [] }))}
            className={juntar(botao.discreto, "-ml-2 h-8 px-2 text-[12px]")}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Novo bloco
          </button>

          {avisos.length > 0 && (
            <ul className="list-disc space-y-1 pl-5" aria-label="Avisos da versão salva">
              {avisos.map((a, i) => <li key={i} className="text-[12px] leading-5 text-amber-700 dark:text-amber-300">{a}</li>)}
            </ul>
          )}

          <div className="flex min-w-0 flex-wrap items-end justify-end border-t border-border pt-4 [&>*]:mt-2">
            <CampoDeFormulario rotulo="Nota da versão" className="mr-2 min-w-[220px] flex-1">
              <input className={estiloDoCampo} value={nota} maxLength={300} onChange={(e) => setNota(e.target.value)} placeholder="O que mudou" aria-label="Nota da versão" disabled={!podeSalvar} />
            </CampoDeFormulario>
            <button type="button" onClick={() => versoes.data && setRascunho(copia(versoes.data.vigente))} disabled={!mudou || salvando} className={juntar(botao.secundario, "mr-2")}>Descartar</button>
            <button type="button" onClick={() => void salvar()} disabled={!podeSalvar || !mudou || semTexto || salvando} className={botao.primario} title={podeSalvar ? (semTexto ? "Toda pergunta e todo bloco precisam de texto." : undefined) : "Só um admin salva versão nova."}>
              {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Salvar como versão nova
            </button>
          </div>

          <Secao titulo="Versões" descricao={`${(versoes.data?.versoes || []).length} salvas`} recolher={`briefing-editor:versoes:${slug}`} recolhidaDeInicio divisoria>
            <ul className={juntar(lista.aberta, lista.divisoria)}>
              {(versoes.data?.versoes || []).map((v) => (
                <li key={v.id} className={lista.linha}>
                  <History className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-foreground">Versão {v.versao}{v.versao === versoes.data!.vigente.versao ? " (em uso)" : ""}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{dataCurta(v.criado_em)}{v.nota ? ` · ${v.nota}` : ""}</span>
                  </span>
                  <MenuMais itens={[{ rotulo: "Usar como base", aoEscolher: () => usarComoBase(v.conteudo, `A versão ${v.versao}`) }]} />
                </li>
              ))}
              <li className={lista.linha}>
                <History className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">Versão de fábrica</span>
                <MenuMais itens={[{ rotulo: "Usar como base", aoEscolher: () => usarComoBase(versoes.data?.fabrica, "A versão de fábrica") }]} />
              </li>
            </ul>
          </Secao>
        </>
      )}
    </div>
  );
}
