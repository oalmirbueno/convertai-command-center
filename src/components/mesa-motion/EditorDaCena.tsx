import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { useMesa, useMarcaDaMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { PECAS_DO_KIT, pecaPorId, type IdDaPeca } from "../../../supabase/functions/_shared/cena-hf";
import { type CenaDaLinha, TRANSICOES_DA_CENA } from "../../../supabase/functions/_shared/motion-metodo";
import { chamarMotion, deTexto, type Filme, paraTexto, useGuardarFilme } from "./motionApi";

/**
 * Edição de uma cena (textos da peça, duração, fundo e tema), em Stills e na
 * Construção. Salva sozinho ao sair de cada campo (os selects e as imagens,
 * ao escolher), um salvamento por vez; nada muda, nada vai ao servidor. Quem
 * decide se o still perde a aprovação é o servidor (só quando a cena mudou).
 * Trocar a peça é ação explícita ("Trocar a peça"). Os campos de texto têm
 * "Preencher com IA" (papel motion) com prévia e Desfazer. Número só com
 * fonte (o servidor tira o que não está nas provas).
 */

/** transicao "" = a do filme (entrevista); "auto" no pedido tira a da cena. */
type Rascunho = { titulo: string; duracao_s: number; fundo: "marca" | "transparente"; tema: "escuro" | "claro"; transicao: string; params: Record<string, string> };

function rascunhoDa(cena: CenaDaLinha): Rascunho {
  const peca = cena.modo === "sob_medida" ? null : cena.peca ? pecaPorId(cena.peca) : null;
  const params: Record<string, string> = {};
  (peca ? peca.parametros : []).forEach((p) => (params[p.chave] = paraTexto(cena.params[p.chave], p.tipo)));
  return { titulo: cena.titulo, duracao_s: cena.duracao_s, fundo: cena.fundo, tema: cena.tema, transicao: cena.transicao || "", params };
}

const mesmo = (a: Rascunho, b: Rascunho) => JSON.stringify(a) === JSON.stringify(b);

/** O pedido de cena_salvar do rascunho (sem still_aprovado: o servidor decide). */
function pedidoDa(x: Rascunho, c: CenaDaLinha): Record<string, unknown> {
  const sob = c.modo === "sob_medida";
  const def = !sob && c.peca ? pecaPorId(c.peca) : null;
  const params: Record<string, unknown> = {};
  (def ? def.parametros : []).forEach((p) => {
    const v = x.params[p.chave];
    if (v !== undefined && v !== "") params[p.chave] = deTexto(v, p.tipo);
  });
  return { id: c.id, titulo: x.titulo, duracao_s: x.duracao_s, peca: sob ? null : c.peca, modo: sob ? "sob_medida" : "kit", fundo: x.fundo, tema: x.tema, transicao: x.transicao || "auto", params: sob ? c.params : params };
}

const nomeDoArquivo = (p: string) => p.split("/").pop() || p;

export default function EditorDaCena({ filme, cena, prints, links = {} }: { filme: Filme; cena: CenaDaLinha; prints: Array<{ path: string; nome: string }>; links?: Record<string, string> }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const pecaSalva = cena.modo === "sob_medida" ? null : cena.peca;
  const [r, setR] = useState<Rascunho>(() => rascunhoDa(cena));
  const [pecaNoSeletor, setPecaNoSeletor] = useState<IdDaPeca | null>(pecaSalva);
  const [estado, setEstado] = useState<"" | "salvando" | "salvo">("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const rAtual = useRef(r);
  const cenaAtual = useRef(cena);
  cenaAtual.current = cena;
  const emVoo = useRef(false);
  const pendente = useRef(false);

  const mudarRascunho = (novo: Rascunho) => {
    rAtual.current = novo;
    setR(novo);
  };

  // Outra cena, outra peça ou outro modo (trocou a peça): o rascunho volta ao que está salvo.
  useEffect(() => {
    mudarRascunho(rascunhoDa(cena));
    setPecaNoSeletor(cena.modo === "sob_medida" ? null : cena.peca);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cena.id, cena.peca, cena.modo]);

  /**
   * Um salvamento por vez: o que chega durante a gravação fica pendente e sai
   * no fim, com o rascunho mais novo (resposta velha não passa por cima da nova).
   * `troca` manda a peça nova (ação explícita, sempre vai ao servidor).
   */
  const gravar = async (troca?: { peca: IdDaPeca | null }): Promise<void> => {
    if (emVoo.current) {
      pendente.current = true;
      return;
    }
    const c = cenaAtual.current;
    const x = rAtual.current;
    if (!troca && mesmo(x, rascunhoDa(c))) return;
    let pedido = pedidoDa(x, c);
    if (troca) {
      const def = troca.peca ? pecaPorId(troca.peca) : null;
      const params: Record<string, unknown> = {};
      (def ? def.parametros : []).forEach((p) => {
        const v = x.params[p.chave];
        if (v) params[p.chave] = deTexto(v, p.tipo);
      });
      pedido = { ...pedido, peca: troca.peca, modo: troca.peca ? "kit" : "sob_medida", params: troca.peca ? params : c.params };
    }
    emVoo.current = true;
    setEstado("salvando");
    try {
      const d = await chamarMotion<{ filme: Filme; avisos: string[] }>("cena_salvar", { filme_id: filme.id, cena: pedido });
      guardar(d.filme);
      setAvisos(d.avisos || []);
      const nova = d.filme && Array.isArray(d.filme.cenas) ? d.filme.cenas.find((y) => y.id === c.id) : null;
      if (nova) {
        cenaAtual.current = nova;
        // Nada digitado durante a gravação: o campo mostra o que ficou salvo (número sem fonte some junto com o aviso).
        if (rAtual.current === x && !troca) mudarRascunho(rascunhoDa(nova));
      }
      setEstado("salvo");
    } catch (e) {
      avisarErro(e, "A cena não foi salva");
      setEstado("");
    } finally {
      emVoo.current = false;
      if (pendente.current) {
        pendente.current = false;
        void gravar();
      }
    }
  };

  // Saiu da tela com mudança sem salvar (sem o blur): grava na saída.
  useEffect(
    () => () => {
      if (!mesmo(rAtual.current, rascunhoDa(cenaAtual.current))) void gravar();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const mudarESalvar = (novo: Rascunho) => {
    mudarRascunho(novo);
    void gravar();
  };

  const peca = pecaSalva ? pecaPorId(pecaSalva) : null;
  const trocouPeca = pecaNoSeletor !== pecaSalva;

  const camposDaIA: CampoParaPreencher[] = (peca ? peca.parametros : [])
    .filter((p) => p.tipo === "texto" || p.tipo === "lista")
    .map((p) => ({ chave: p.chave, rotulo: p.rotulo, tipo: p.tipo === "lista" ? ("lista" as const) : ("texto" as const), valorAtual: r.params[p.chave] || "", maximo: p.maximo, dica: `${p.dica ? `${p.dica}. ` : ""}Nunca inventar número, nome ou depoimento: só o que está no BRAND.md e nas provas.` }));

  const aplicarDaIA = (valores: Record<string, unknown>) => {
    const params = { ...rAtual.current.params };
    Object.keys(valores).forEach((k) => (params[k] = Array.isArray(valores[k]) ? (valores[k] as unknown[]).map(String).join("\n") : String(valores[k] ?? "")));
    mudarRascunho({ ...rAtual.current, params });
    return gravar();
  };

  const imagensMarcadas = (chave: string) => (r.params[chave] || "").split("\n").filter(Boolean);
  const alternarImagem = (chave: string, path: string) => {
    const antes = imagensMarcadas(chave);
    const ligadas = antes.indexOf(path) >= 0 ? antes.filter((x) => x !== path) : antes.concat([path]);
    // Na ordem dos prints, como antes; imagem que não é print do filme (ex.: da identidade) fica no fim.
    const ordem = prints.map((x) => x.path).filter((x) => ligadas.indexOf(x) >= 0);
    const fora = ligadas.filter((x) => ordem.indexOf(x) < 0);
    mudarESalvar({ ...rAtual.current, params: { ...rAtual.current.params, [chave]: ordem.concat(fora).join("\n") } });
  };

  return (
    <div className="min-w-0 space-y-3" data-editor-da-cena={cena.id}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={texto.rotulo}>Título da cena</span>
          <input className={campo} value={r.titulo} maxLength={80} onChange={(e) => mudarRascunho({ ...r, titulo: e.target.value })} onBlur={() => void gravar()} />
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Duração (s)</span>
          <input className={campo} type="number" min={2} max={12} step={0.5} value={r.duracao_s} onChange={(e) => mudarRascunho({ ...r, duracao_s: Number(e.target.value) })} onBlur={() => void gravar()} />
        </label>
        <div className="min-w-0">
          <label className="block min-w-0">
            <span className={texto.rotulo}>Peça do kit</span>
            <select className={campo} value={pecaNoSeletor || ""} onChange={(e) => setPecaNoSeletor((e.target.value || null) as IdDaPeca | null)}>
              {(cena.escrita || cena.modo === "sob_medida") && <option value="">Sob medida (escrita pelo modelo)</option>}
              {PECAS_DO_KIT.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.rotulo}
                </option>
              ))}
            </select>
          </label>
          {trocouPeca && (
            <div className="mt-2 flex min-w-0 flex-wrap items-center">
              <button type="button" className={juntar(botao.secundario, "mr-2 h-8")} disabled={estado === "salvando"} onClick={() => void gravar({ peca: pecaNoSeletor })} data-trocar-peca="">
                Trocar a peça
              </button>
              <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setPecaNoSeletor(pecaSalva)}>
                Manter
              </button>
            </div>
          )}
        </div>
        <label className="min-w-0">
          <span className={texto.rotulo}>Fundo e tema</span>
          <select className={campo} value={`${r.fundo}:${r.tema}`} onChange={(e) => {
            const [f, t] = e.target.value.split(":");
            mudarESalvar({ ...r, fundo: f as Rascunho["fundo"], tema: t as Rascunho["tema"] });
          }}>
            <option value="marca:escuro">Fundo da marca, escuro</option>
            <option value="marca:claro">Fundo da marca, claro</option>
            <option value="transparente:escuro">Transparente (por cima de vídeo)</option>
          </select>
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Entrada da cena</span>
          <select className={campo} value={r.transicao} onChange={(e) => mudarESalvar({ ...r, transicao: e.target.value })} aria-label="Transição de entrada da cena">
            <option value="">A do filme (entrevista)</option>
            {TRANSICOES_DA_CENA.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.rotulo}
              </option>
            ))}
          </select>
        </label>
      </div>
      {peca && (
        <div className="min-w-0 space-y-3">
          <div className="flex min-w-0 items-center justify-between">
            <span className={texto.rotulo}>{peca.quando}</span>
            {camposDaIA.length > 0 && (
              <PreencherComIA
                papel="motion"
                clientId={clientId}
                marcaId={marca ? marca.id : null}
                campos={camposDaIA}
                contexto={`Cena "${r.titulo}" do filme "${filme.nome}". Ideia: ${cena.ideia || "-"}. Promessa: ${filme.brand.promessa || "-"}.`}
                onAplicar={aplicarDaIA}
                onDesfazer={aplicarDaIA}
              />
            )}
          </div>
          {peca.parametros.map((p) =>
            p.tipo === "imagens" ? (
              <div key={p.chave} className="min-w-0" role="group" aria-label={p.rotulo}>
                <span className={texto.rotulo}>{p.rotulo}</span>
                {(() => {
                  const marcadas = imagensMarcadas(p.chave);
                  const opcoes = prints.concat(marcadas.filter((x) => !prints.some((pr) => pr.path === x)).map((x) => ({ path: x, nome: nomeDoArquivo(x) })));
                  if (!opcoes.length) return <p className={juntar(texto.auxiliar, "mt-1")}>Sem prints no filme: suba em Insumos.</p>;
                  return (
                    <ul className={juntar(lista.aberta, "mt-1")}>
                      {opcoes.map((x) => (
                        <li key={x.path} className={lista.linha}>
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center">
                            <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-primary" checked={marcadas.indexOf(x.path) >= 0} onChange={() => alternarImagem(p.chave, x.path)} />
                            {links[x.path] ? <img src={links[x.path]} alt="" className="mr-2 h-8 w-8 shrink-0 rounded object-cover" /> : null}
                            <span className={juntar(texto.corpo, "min-w-0 truncate")}>{x.nome}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  );
                })()}
              </div>
            ) : (
              <label key={p.chave} className="block min-w-0">
                <span className={juntar(texto.rotulo, "flex items-center")}>
                  {p.rotulo}
                  {p.tipo === "lista" || p.tipo === "numeros" ? " (um por linha)" : ""}
                  {p.tipo === "numeros" && (
                    <AjudaRecolhida className="ml-1.5" rotulo="Como escrever os números">
                      Cada linha: valor;rótulo;fonte. Ex.: 4,8;nota no Google;print de 12/09. Sem fonte, o número não entra.
                    </AjudaRecolhida>
                  )}
                </span>
                {p.tipo === "texto" ? (
                  <input className={campo} value={r.params[p.chave] || ""} maxLength={p.maximo} onChange={(e) => mudarRascunho({ ...r, params: { ...r.params, [p.chave]: e.target.value } })} onBlur={() => void gravar()} />
                ) : (
                  <textarea className={juntar(campoTexto, "min-h-[72px]")} value={r.params[p.chave] || ""} onChange={(e) => mudarRascunho({ ...r, params: { ...r.params, [p.chave]: e.target.value } })} onBlur={() => void gravar()} />
                )}
              </label>
            ),
          )}
        </div>
      )}
      {avisos.length > 0 && (
        <ul className="space-y-1" role="alert">
          {avisos.map((a) => (
            <li key={a} className={juntar(texto.auxiliar, "text-warning")}>
              {a}
            </li>
          ))}
        </ul>
      )}
      {estado && (
        <p className={juntar(texto.auxiliar, "flex items-center")} data-salvar-cena={estado} aria-live="polite">
          {estado === "salvando" ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
          {estado === "salvando" ? "Salvando" : "Salvo"}
        </p>
      )}
    </div>
  );
}
