import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, espaco, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, Pastilha, partesDoCusto, useProjetoDaMesa } from "./Comuns";

type Referencia = { titulo: string; link: string; nota: string; tipo: "concorrente" | "referencia" };

const linkValido = (s: string) => (/^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : "");

/**
 * Etapa 3, Pesquisa e referências: concorrentes e referências visuais (as
 * da equipe, as do contexto do cliente e as da pesquisa com IA, que custa e
 * mostra o preço antes). O resumo da pesquisa guia os caminhos criativos.
 */
export default function EtapaPesquisa() {
  const mesa = useMesa();
  const { projeto, salvarParte, guardar } = useProjetoDaMesa();
  const avisarErro = useAvisarErro();
  const pesquisa = (projeto.dados.pesquisa || {}) as { referencias?: Referencia[]; resumo?: string; ia?: any };
  const [refs, setRefs] = useState<Referencia[]>([]);
  const [resumo, setResumo] = useState("");
  const [nova, setNova] = useState<Referencia>({ titulo: "", link: "", nota: "", tipo: "referencia" });
  const [salvando, setSalvando] = useState(false);
  const [trazendo, setTrazendo] = useState(false);

  useEffect(() => {
    setRefs(Array.isArray(pesquisa.referencias) ? pesquisa.referencias : []);
    setResumo(pesquisa.resumo || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projeto.id, projeto.versao]);

  const salvar = async (lista_: Referencia[] = refs, resumo_: string = resumo) => {
    setSalvando(true);
    try {
      await salvarParte("pesquisa", { referencias: lista_.slice(0, 40), resumo: resumo_.slice(0, 3000) });
      toast.success("Pesquisa salva");
    } catch (e) {
      avisarErro(e, "A pesquisa não foi salva");
    } finally {
      setSalvando(false);
    }
  };

  const acrescentar = (r: Referencia) => {
    if (!r.titulo.trim()) return;
    const novas = refs.concat([{ ...r, titulo: r.titulo.trim().slice(0, 120), link: linkValido(r.link), nota: r.nota.trim().slice(0, 300) }]);
    setRefs(novas);
    void salvar(novas);
  };

  const trazerDoContexto = async () => {
    setTrazendo(true);
    try {
      const r = await chamarIdentidade<{ referencias: Array<{ url_origem: string | null; leitura: string | null; origem: string }> }>("pesquisa_referencias", { projeto_id: projeto.id });
      const vindas: Referencia[] = (r.referencias || [])
        .filter((x) => !refs.some((y) => y.link && y.link === (x.url_origem || "")))
        .slice(0, 12)
        .map((x) => ({ titulo: (x.leitura || x.url_origem || "Referência do contexto").slice(0, 80), link: linkValido(x.url_origem || ""), nota: (x.leitura || "").slice(0, 300), tipo: "referencia" }));
      if (!vindas.length) {
        toast.info("Nada novo no contexto do cliente.");
        return;
      }
      const novas = refs.concat(vindas);
      setRefs(novas);
      await salvar(novas);
    } catch (e) {
      avisarErro(e, "As referências não vieram");
    } finally {
      setTrazendo(false);
    }
  };

  const ia = pesquisa.ia as { resumo?: string; concorrentes?: Array<{ nome: string; comunica: string; link: string }>; referencias?: Array<{ titulo: string; por_que: string; link: string }>; cliches?: string[] } | undefined;

  return (
    <div className={espaco.pagina} data-etapa-pesquisa="">
      <CabecalhoDaEtapa
        etapa="pesquisa"
        ajuda="Junte concorrentes e referências (de qualquer segmento) e escreva o resumo do que a pesquisa mostrou. A pesquisa com IA busca na web e mostra o custo antes; link que a busca não trouxe não aparece."
        acoes={
          <>
            <button type="button" className={juntar(botao.secundario, "m-1 h-8")} onClick={() => void trazerDoContexto()} disabled={trazendo}>
              {trazendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />} Do contexto
            </button>
            <BotaoComCusto
              rotulo="Pesquisar com IA"
              titulo="Pesquisa de mercado"
              partes={() => partesDoCusto(mesa.catalogo, "pesquisa")}
              executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("pesquisa_ia", { projeto_id: projeto.id })}
              aoConcluir={(d) => guardar(d && d.projeto)}
              variant="outline"
              className="m-1 h-8"
            />
          </>
        }
      />

      <Secao titulo="Referências e concorrentes" descricao={`${refs.length} guardadas`} recolher={`mesa-identidade:${projeto.id}:pesquisa:refs`}>
        {refs.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria, "mb-4")} aria-label="Referências guardadas">
            {refs.map((r, i) => (
              <li key={`${r.titulo}-${i}`} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center">
                    <span className={juntar(texto.corpo, "mr-2 truncate font-medium")}>{r.titulo}</span>
                    <Pastilha>{r.tipo === "concorrente" ? "Concorrente" : "Referência"}</Pastilha>
                  </span>
                  {r.nota && <span className={juntar(texto.auxiliar, "block truncate")}>{r.nota}</span>}
                </span>
                {r.link && (
                  <a href={r.link} target="_blank" rel="noopener noreferrer" className={botao.icone} aria-label={`Abrir ${r.titulo}`}>
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <button
                  type="button"
                  className={botao.icone}
                  aria-label={`Tirar ${r.titulo}`}
                  onClick={() => {
                    const novas = refs.filter((_, k) => k !== i);
                    setRefs(novas);
                    void salvar(novas);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid min-w-0 grid-cols-1 items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_140px_auto]">
          <CampoDeFormulario rotulo="Nome">
            <input className={campo} value={nova.titulo} maxLength={120} onChange={(e) => setNova({ ...nova, titulo: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Link">
            <input className={campo} value={nova.link} maxLength={400} placeholder="https://" onChange={(e) => setNova({ ...nova, link: e.target.value })} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Tipo">
            <select className={campo} value={nova.tipo} onChange={(e) => setNova({ ...nova, tipo: e.target.value === "concorrente" ? "concorrente" : "referencia" })}>
              <option value="referencia">Referência</option>
              <option value="concorrente">Concorrente</option>
            </select>
          </CampoDeFormulario>
          <button
            type="button"
            className={botao.secundario}
            disabled={!nova.titulo.trim()}
            onClick={() => {
              acrescentar(nova);
              setNova({ titulo: "", link: "", nota: "", tipo: nova.tipo });
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Guardar
          </button>
        </div>
      </Secao>

      {ia && (
        <Secao titulo="Pesquisa com IA" descricao={ia.concorrentes ? `${ia.concorrentes.length} concorrentes` : undefined} divisoria recolher={`mesa-identidade:${projeto.id}:pesquisa:ia`}>
          {ia.resumo && <p className={juntar(texto.corpo, "mb-3 whitespace-pre-line")}>{ia.resumo}</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Achados da pesquisa">
            {(ia.concorrentes || []).map((c, i) => (
              <li key={`c-${i}`} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{c.comunica}</span>
                </span>
                <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => acrescentar({ titulo: c.nome, link: c.link, nota: c.comunica, tipo: "concorrente" })}>
                  Guardar
                </button>
              </li>
            ))}
            {(ia.referencias || []).map((c, i) => (
              <li key={`r-${i}`} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.titulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{c.por_que}</span>
                </span>
                <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => acrescentar({ titulo: c.titulo, link: c.link, nota: c.por_que, tipo: "referencia" })}>
                  Guardar
                </button>
              </li>
            ))}
          </ul>
          {ia.cliches && ia.cliches.length > 0 && <p className={juntar(texto.auxiliar, "mt-3")}>Evitar: {ia.cliches.join("; ")}</p>}
        </Secao>
      )}

      <Secao titulo="Resumo da pesquisa" divisoria recolher={`mesa-identidade:${projeto.id}:pesquisa:resumo`}>
        <textarea className={juntar(campoTexto, "min-h-[110px]")} value={resumo} maxLength={3000} onChange={(e) => setResumo(e.target.value)} placeholder="O que a pesquisa mostrou e onde está o espaço para a marca" aria-label="Resumo da pesquisa" />
        <div className="mt-2 flex justify-end">
          <button type="button" className={botao.secundario} onClick={() => void salvar()} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Salvar
          </button>
        </div>
      </Secao>
    </div>
  );
}
