import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { useMesa, useMarcaDaMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { PreencherComIA, type CampoParaPreencher } from "@/components/sistema";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { PECAS_DO_KIT, pecaPorId, type IdDaPeca, type NumeroReal } from "../../../supabase/functions/_shared/cena-hf";
import type { CenaDaLinha } from "../../../supabase/functions/_shared/motion-metodo";
import { chamarMotion, type Filme, useGuardarFilme } from "./motionApi";

/**
 * Edição de uma cena (textos da peça, duração, fundo e tema). Os campos de
 * texto têm "Preencher com IA" (papel motion) pelo contrato da peça comum:
 * prévia antes de aplicar e Desfazer. Número só com fonte (o servidor tira o
 * que não está nas provas).
 */

type Rascunho = { titulo: string; duracao_s: number; peca: IdDaPeca | null; fundo: "marca" | "transparente"; tema: "escuro" | "claro"; params: Record<string, string> };

function paraTexto(v: unknown, tipo: string): string {
  if (tipo === "lista" || tipo === "imagens") return Array.isArray(v) ? (v as unknown[]).map(String).join("\n") : "";
  if (tipo === "numeros") return Array.isArray(v) ? (v as NumeroReal[]).map((n) => `${n.valor};${n.rotulo};${n.fonte}`).join("\n") : "";
  return typeof v === "string" ? v : "";
}

function deTexto(t: string, tipo: string): unknown {
  if (tipo === "lista" || tipo === "imagens") return t.split("\n").map((x) => x.trim()).filter(Boolean);
  if (tipo === "numeros")
    return t
      .split("\n")
      .map((l) => l.split(";").map((x) => x.trim()))
      .filter((l) => l[0])
      .map((l) => ({ valor: Number(String(l[0]).replace(/\./g, "").replace(",", ".")), rotulo: l[1] || "", fonte: l[2] || "" }));
  return t;
}

export default function EditorDaCena({ filme, cena, prints }: { filme: Filme; cena: CenaDaLinha; prints: Array<{ path: string; nome: string }> }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const guardar = useGuardarFilme();
  const avisarErro = useAvisarErro();
  const inicial = (): Rascunho => {
    const peca = cena.peca ? pecaPorId(cena.peca) : null;
    const params: Record<string, string> = {};
    (peca ? peca.parametros : []).forEach((p) => (params[p.chave] = paraTexto(cena.params[p.chave], p.tipo)));
    return { titulo: cena.titulo, duracao_s: cena.duracao_s, peca: cena.peca, fundo: cena.fundo, tema: cena.tema, params };
  };
  const [r, setR] = useState<Rascunho>(inicial);
  const [salvando, setSalvando] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setR(inicial()), [cena.id, cena.peca, cena.modo]);
  const peca = r.peca ? pecaPorId(r.peca) : null;

  const salvar = async (mudado?: Partial<Rascunho>) => {
    const x = { ...r, ...(mudado || {}) };
    const def = x.peca ? pecaPorId(x.peca) : null;
    const params: Record<string, unknown> = {};
    (def ? def.parametros : []).forEach((p) => {
      const v = x.params[p.chave];
      if (v !== undefined && v !== "") params[p.chave] = deTexto(v, p.tipo);
    });
    setSalvando(true);
    try {
      const d = await chamarMotion<{ filme: Filme; avisos: string[] }>("cena_salvar", {
        filme_id: filme.id,
        cena: { id: cena.id, titulo: x.titulo, duracao_s: x.duracao_s, peca: x.peca, modo: cena.modo === "sob_medida" && x.peca === cena.peca ? "sob_medida" : "kit", fundo: x.fundo, tema: x.tema, params: cena.modo === "sob_medida" && x.peca === cena.peca ? cena.params : params, still_aprovado: false },
      });
      guardar(d.filme);
      setAvisos(d.avisos || []);
    } catch (e) {
      avisarErro(e, "A cena não foi salva");
    } finally {
      setSalvando(false);
    }
  };

  const camposDaIA: CampoParaPreencher[] = (peca ? peca.parametros : [])
    .filter((p) => p.tipo === "texto" || p.tipo === "lista")
    .map((p) => ({ chave: p.chave, rotulo: p.rotulo, tipo: p.tipo === "lista" ? ("lista" as const) : ("texto" as const), valorAtual: r.params[p.chave] || "", maximo: p.maximo, dica: `${p.dica ? `${p.dica}. ` : ""}Nunca inventar número, nome ou depoimento: só o que está no BRAND.md e nas provas.` }));

  return (
    <div className="min-w-0 space-y-3" data-editor-da-cena={cena.id}>
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="min-w-0">
          <span className={texto.rotulo}>Título da cena</span>
          <input className={campo} value={r.titulo} maxLength={80} onChange={(e) => setR({ ...r, titulo: e.target.value })} />
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Duração (s)</span>
          <input className={campo} type="number" min={2} max={12} step={0.5} value={r.duracao_s} onChange={(e) => setR({ ...r, duracao_s: Number(e.target.value) })} />
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Peça do kit</span>
          <select className={campo} value={r.peca || ""} onChange={(e) => setR({ ...r, peca: (e.target.value || null) as IdDaPeca | null })}>
            {cena.modo === "sob_medida" && <option value="">Sob medida (escrita pelo modelo)</option>}
            {PECAS_DO_KIT.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rotulo}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0">
          <span className={texto.rotulo}>Fundo e tema</span>
          <select className={campo} value={`${r.fundo}:${r.tema}`} onChange={(e) => {
            const [f, t] = e.target.value.split(":");
            setR({ ...r, fundo: f as Rascunho["fundo"], tema: t as Rascunho["tema"] });
          }}>
            <option value="marca:escuro">Fundo da marca, escuro</option>
            <option value="marca:claro">Fundo da marca, claro</option>
            <option value="transparente:escuro">Transparente (por cima de vídeo)</option>
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
                onAplicar={(valores) => {
                  const params = { ...r.params };
                  Object.keys(valores).forEach((k) => (params[k] = Array.isArray(valores[k]) ? (valores[k] as unknown[]).map(String).join("\n") : String(valores[k] ?? "")));
                  setR({ ...r, params });
                  return salvar({ params });
                }}
                onDesfazer={(anteriores) => {
                  const params = { ...r.params };
                  Object.keys(anteriores).forEach((k) => (params[k] = Array.isArray(anteriores[k]) ? (anteriores[k] as unknown[]).map(String).join("\n") : String(anteriores[k] ?? "")));
                  setR({ ...r, params });
                  return salvar({ params });
                }}
              />
            )}
          </div>
          {peca.parametros.map((p) => (
            <label key={p.chave} className="block min-w-0">
              <span className={texto.rotulo}>
                {p.rotulo}
                {p.tipo === "lista" ? " (um por linha)" : p.tipo === "numeros" ? " (valor;rótulo;fonte, um por linha)" : ""}
              </span>
              {p.tipo === "imagens" ? (
                <select
                  multiple
                  className={juntar(campoTexto, "min-h-[88px]")}
                  value={(r.params[p.chave] || "").split("\n").filter(Boolean)}
                  onChange={(e) => setR({ ...r, params: { ...r.params, [p.chave]: Array.from(e.target.selectedOptions).map((o) => o.value).join("\n") } })}
                >
                  {prints.map((x) => (
                    <option key={x.path} value={x.path}>
                      {x.nome}
                    </option>
                  ))}
                </select>
              ) : p.tipo === "texto" ? (
                <input className={campo} value={r.params[p.chave] || ""} maxLength={p.maximo} onChange={(e) => setR({ ...r, params: { ...r.params, [p.chave]: e.target.value } })} />
              ) : (
                <textarea className={juntar(campoTexto, "min-h-[72px]")} value={r.params[p.chave] || ""} onChange={(e) => setR({ ...r, params: { ...r.params, [p.chave]: e.target.value } })} />
              )}
            </label>
          ))}
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
      <button type="button" className={botao.secundario} disabled={salvando} onClick={() => void salvar()} data-salvar-cena="">
        {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 h-3.5 w-3.5" />}
        Salvar a cena
      </button>
    </div>
  );
}
