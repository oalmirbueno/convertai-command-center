import { useMemo, useState } from "react";
import { Check, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { PreencherComIA } from "@/components/sistema";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import BotaoComIcone from "@/components/sistema/BotaoComIcone";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, campoTexto, espaco, juntar, lista, texto } from "@/components/sistema/estilos";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { CabecalhoDaEtapa, contextoParaPreencher, Pastilha, partesDoCusto, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";
import { useGravacoesDaMesa, useValorSalvo } from "./gravacao";
import Moodboard from "./Moodboard";
// Frente CUS (01/10): o navegador do agente pesquisa os concorrentes visuais (logo, cores, fontes e o que comunicam).
import { BotaoDoNavegador, TarefasDoNavegador, type InsumoDoNavegador } from "@/components/agentes/NavegadorDoAgente";
import { concorrentesParaIdentidade } from "@/lib/agentes/insumosDoNavegador";

type Referencia = { titulo: string; link: string; nota: string; tipo: "concorrente" | "referencia" };

const linkValido = (s: string) => (/^https?:\/\/\S+$/i.test(s.trim()) ? s.trim() : "");
const MAXIMO_DE_REFERENCIAS = 40;
const chaveDoTexto = (s: string) => String(s || "").trim().toLowerCase();

/** Já está na lista? O link bate (quando tem) ou nome e tipo batem (sem diferença de maiúsculas e sem espaço nas pontas). */
export function jaGuardada(lista_: Referencia[], r: { titulo: string; link: string; tipo: Referencia["tipo"] }): boolean {
  const link = linkValido(r.link || "");
  return lista_.some((x) => (link && linkValido(x.link || "") === link) || (chaveDoTexto(x.titulo) === chaveDoTexto(r.titulo) && x.tipo === r.tipo));
}

/**
 * Etapa 3, Pesquisa e referências: concorrentes e referências visuais (as
 * da equipe, as do contexto do cliente e as da pesquisa com IA, que custa e
 * mostra o preço antes). O resumo da pesquisa guia os caminhos criativos.
 *
 * UXS 30/09: o resumo grava sozinho; da "Pesquisa com IA", "Usar este resumo"
 * e "Guardar todos" fecham a etapa com 1 ou 2 cliques (com Desfazer); o item
 * já guardado mostra "Guardada" (nada repete, nem no formulário).
 */
export default function EtapaPesquisa() {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, salvarParte, guardar } = useProjetoDaMesa();
  const gravacoes = useGravacoesDaMesa();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const avisarErro = useAvisarErro();
  const pesquisa = (projeto.dados.pesquisa || {}) as { referencias?: Referencia[]; resumo?: string; ia?: any };
  const pRefs = useValorSalvo<Referencia[]>({
    id: "pesquisa:referencias",
    servidor: Array.isArray(pesquisa.referencias) ? pesquisa.referencias : [],
    paraSalvar: (l) => l.slice(0, MAXIMO_DE_REFERENCIAS),
    gravar: (n) => salvarParte("pesquisa", { referencias: n }),
  });
  const pResumo = useValorSalvo<string>({
    id: "pesquisa:resumo",
    servidor: pesquisa.resumo || "",
    paraSalvar: (t) => t.slice(0, 3000),
    gravar: (n) => salvarParte("pesquisa", { resumo: n }),
  });
  const refs = pRefs.valor;
  const resumo = pResumo.valor;
  const [nova, setNova] = useState<Referencia>({ titulo: "", link: "", nota: "", tipo: "referencia" });
  const [trazendo, setTrazendo] = useState(false);

  const gravarRefs = async (novas: Referencia[], frase?: string, antes?: Referencia[]) => {
    try {
      await pRefs.trocarESalvar(novas);
      if (frase && antes) toast.success(frase, { duration: 10_000, action: { label: "Desfazer", onClick: () => void gravarRefs(antes) } });
      else if (frase) toast.success(frase);
    } catch (e) {
      avisarErro(e, "A pesquisa não foi salva");
    }
  };

  const limpa = (r: Referencia): Referencia => ({ ...r, titulo: r.titulo.trim().slice(0, 120), link: linkValido(r.link), nota: r.nota.trim().slice(0, 300) });

  /** Sites dos concorrentes já guardados (preenchem a pesquisa visual do navegador). */
  const sitesDosConcorrentes = refs.filter((r) => r.tipo === "concorrente" && linkValido(r.link)).map((r) => r.link);
  /** Cartão da pesquisa visual: cada concorrente lido entra como referência "concorrente", com Desfazer. */
  const guardarConcorrentes: InsumoDoNavegador = {
    rotulo: "Guardar como concorrentes",
    aoUsar: async (c) => {
      const novas = concorrentesParaIdentidade(c).map(limpa).filter((r) => !jaGuardada(refs, r));
      if (!novas.length) throw new Error("Esses concorrentes já estão guardados.");
      const cabem = novas.slice(0, Math.max(0, MAXIMO_DE_REFERENCIAS - refs.length));
      if (!cabem.length) throw new Error(`A pesquisa já tem ${MAXIMO_DE_REFERENCIAS} referências. Tire alguma antes.`);
      await gravarRefs(refs.concat(cabem), `${cabem.length} concorrente(s) guardado(s) com cores e tipografia`, refs);
      return "";
    },
  };

  const acrescentar = (r: Referencia) => {
    if (!r.titulo.trim()) return;
    if (jaGuardada(refs, r)) {
      toast.info("Essa referência já está guardada.");
      return;
    }
    if (refs.length >= MAXIMO_DE_REFERENCIAS) {
      toast.info(`A pesquisa já tem ${MAXIMO_DE_REFERENCIAS} referências.`);
      return;
    }
    void gravarRefs(refs.concat([limpa(r)]));
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
      await pRefs.trocarESalvar(refs.concat(vindas));
      toast.success(vindas.length === 1 ? "1 referência do contexto" : `${vindas.length} referências do contexto`);
    } catch (e) {
      avisarErro(e, "As referências não vieram");
    } finally {
      setTrazendo(false);
    }
  };

  const ia = pesquisa.ia as { resumo?: string; concorrentes?: Array<{ nome: string; comunica: string; link: string }>; referencias?: Array<{ titulo: string; por_que: string; link: string }>; cliches?: string[] } | undefined;
  const achados: Referencia[] = useMemo(
    () =>
      ia
        ? (ia.concorrentes || []).map((c): Referencia => ({ titulo: c.nome, link: c.link, nota: c.comunica, tipo: "concorrente" })).concat((ia.referencias || []).map((c): Referencia => ({ titulo: c.titulo, link: c.link, nota: c.por_que, tipo: "referencia" })))
        : [],
    [ia],
  );
  const faltamGuardar = achados.filter((a) => a.titulo && !jaGuardada(refs, a));

  const guardarTodos = () => {
    const livres = Math.max(0, MAXIMO_DE_REFERENCIAS - refs.length);
    const entram = faltamGuardar.slice(0, livres).map(limpa);
    const fora = faltamGuardar.length - entram.length;
    if (!entram.length) {
      toast.info(`A pesquisa já tem ${MAXIMO_DE_REFERENCIAS} referências.`);
      return;
    }
    const antes = refs;
    void gravarRefs(refs.concat(entram), fora ? `${entram.length} guardadas; ${fora} ficaram de fora (limite de ${MAXIMO_DE_REFERENCIAS})` : entram.length === 1 ? "1 guardada" : `${entram.length} guardadas`, antes);
  };

  const usarResumoDaIa = () => {
    if (!ia || !ia.resumo) return;
    const antes = resumo;
    const trocou = !!antes.trim();
    pResumo
      .trocarESalvar(ia.resumo)
      .then(() =>
        toast.success(trocou ? "O resumo foi trocado pelo da pesquisa" : "Resumo da pesquisa usado", {
          duration: 10_000,
          action: { label: "Desfazer", onClick: () => void pResumo.trocarESalvar(antes).catch((e) => avisarErro(e, "Não foi possível desfazer")) },
        }),
      )
      .catch((e) => avisarErro(e, "O resumo não foi salvo"));
  };

  const botaoGuardar = (r: Referencia, i: string) => {
    const ja = jaGuardada(refs, r);
    return (
      <button key={i} type="button" className={juntar(botao.discreto, "h-8")} disabled={ja} onClick={() => acrescentar(r)} data-guardar-achado={ja ? "guardada" : "guardar"}>
        {ja ? (
          <>
            <Check className="mr-1.5 h-3.5 w-3.5" /> Guardada
          </>
        ) : (
          "Guardar"
        )}
      </button>
    );
  };

  return (
    <div
      className={espaco.pagina}
      data-etapa-pesquisa=""
      onBlur={() => {
        if (gravacoes && gravacoes.temPendente()) void gravacoes.salvarTudo().catch(() => undefined);
      }}
    >
      <CabecalhoDaEtapa
        etapa="pesquisa"
        ajuda="Junte concorrentes e referências (de qualquer segmento) e escreva o resumo do que a pesquisa mostrou. A pesquisa com IA busca na web e mostra o custo antes; link que a busca não trouxe não aparece. Tudo grava sozinho."
        acoes={
          <>
            <BotaoComIcone
              variante="secundario"
              className="m-1 h-8"
              icone={trazendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              rotulo="Do contexto"
              aria-label="Trazer as referências do contexto do cliente"
              onClick={() => void trazerDoContexto()}
              disabled={trazendo}
            />
            <SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} className="max-w-[180px]" />
            <BotaoComCusto
              rotulo="Pesquisar com IA"
              titulo="Pesquisa de mercado"
              partes={() => partesDoCusto(mesa.catalogo, "pesquisa", modeloId)}
              executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("pesquisa_ia", { projeto_id: projeto.id, modelo_id: modeloId || undefined })}
              aoConcluir={(d) => guardar(d && d.projeto)}
              variant="outline"
              className="m-1 h-8"
            />
          </>
        }
      />

      <Secao titulo="Referências e concorrentes" descricao={`${refs.length} guardadas`} recolher={`mesa-identidade:${projeto.id}:pesquisa:refs`} data-bloco-da-etapa="refs">
        <div className="mb-2 min-w-0" data-concorrentes-visuais="">
          <BotaoDoNavegador caso="concorrentes_visuais" clientId={mesa.clientId} origem="mesa_identidade" url={sitesDosConcorrentes[0] || ""} urls={sitesDosConcorrentes.slice(1, 5).join("\n")} rotulo="Pesquisar concorrentes visuais" compacto />
        </div>
        <TarefasDoNavegador clientId={mesa.clientId} origem="mesa_identidade" titulo="Pesquisas visuais do navegador" casos={["concorrentes_visuais"]} insumo={guardarConcorrentes} />
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
                <button type="button" className={botao.icone} aria-label={`Tirar ${r.titulo}`} onClick={() => void gravarRefs(refs.filter((_, k) => k !== i), "Referência tirada", refs)}>
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
        <Secao
          titulo="Pesquisa com IA"
          descricao={ia.concorrentes ? `${ia.concorrentes.length} concorrentes` : undefined}
          divisoria
          recolher={`mesa-identidade:${projeto.id}:pesquisa:ia`}
          data-bloco-da-etapa="pesquisa-ia"
          acao={
            <>
              {ia.resumo && ia.resumo !== resumo && (
                <button type="button" className={juntar(botao.discreto, "m-1 h-8")} onClick={usarResumoDaIa} data-usar-resumo-da-ia="">
                  Usar este resumo
                </button>
              )}
              {achados.length > 0 && (
                <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={!faltamGuardar.length} onClick={guardarTodos} data-guardar-todos="">
                  Guardar todos
                </button>
              )}
            </>
          }
        >
          {ia.resumo && <p className={juntar(texto.corpo, "mb-3 whitespace-pre-line")}>{ia.resumo}</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Achados da pesquisa">
            {(ia.concorrentes || []).map((c, i) => (
              <li key={`c-${i}`} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{c.comunica}</span>
                </span>
                {botaoGuardar({ titulo: c.nome, link: c.link, nota: c.comunica, tipo: "concorrente" }, `gc-${i}`)}
              </li>
            ))}
            {(ia.referencias || []).map((c, i) => (
              <li key={`r-${i}`} className={lista.linha}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.titulo}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{c.por_que}</span>
                </span>
                {botaoGuardar({ titulo: c.titulo, link: c.link, nota: c.por_que, tipo: "referencia" }, `gr-${i}`)}
              </li>
            ))}
          </ul>
          {ia.cliches && ia.cliches.length > 0 && <p className={juntar(texto.auxiliar, "mt-3")}>Evitar: {ia.cliches.join("; ")}</p>}
        </Secao>
      )}

      <Moodboard />

      <Secao
        titulo="Resumo da pesquisa"
        divisoria
        descricao={pResumo.pendente ? "Não salvo" : undefined}
        recolher={`mesa-identidade:${projeto.id}:pesquisa:resumo`}
        data-bloco-da-etapa="resumo"
        acao={
          <PreencherComIA
            papel="identidade"
            clientId={mesa.clientId}
            marcaId={projeto.marca_id || (marca && !marca.principal ? marca.id : null)}
            campos={[{ chave: "resumo", rotulo: "Resumo da pesquisa", tipo: "texto_longo", valorAtual: resumo, dica: "Como as marcas do segmento se apresentam e onde está o espaço para a marca. Só com o que as fontes mostram.", maximo: 3000 }]}
            contexto={contextoParaPreencher(projeto, refs.length ? `Referências guardadas: ${refs.slice(0, 12).map((r) => `${r.titulo} (${r.tipo}): ${r.nota}`).join("; ")}` : undefined)}
            fontes={["contexto", "briefing", "dossie", "web"]}
            onAplicar={(v) => pResumo.trocarESalvar(String(v.resumo || ""))}
            onDesfazer={(a) => pResumo.trocarESalvar(String(a.resumo || ""))}
          />
        }
      >
        <textarea className={juntar(campoTexto, "min-h-[110px]")} value={resumo} maxLength={3000} onChange={(e) => pResumo.mudar(e.target.value)} placeholder="O que a pesquisa mostrou e onde está o espaço para a marca" aria-label="Resumo da pesquisa" />
      </Secao>
    </div>
  );
}
