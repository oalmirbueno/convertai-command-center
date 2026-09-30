import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Plus, Trash2 } from "lucide-react";
import { CampoDeFormulario, GrupoDeCampos, botao, campo as estiloDoCampo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema";
import {
  type CampoDoBriefing,
  type CategoriaDeAnexo,
  ROTULO_DA_CATEGORIA,
  type TipoDeCampo,
  TIPOS_DE_CAMPO,
} from "../../../supabase/functions/_shared/briefing-modelos";
import { chaveNova, moverItem } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Lista de perguntas editável (frente BRF2, 30/09/2026): o editor de modelos
 * e as perguntas extras por projeto usam a mesma peça. Arrastar e soltar no
 * computador; setas no celular. Cada pergunta abre para editar o texto, o
 * tipo, se é obrigatória, as opções e a condição (só aparece quando outra
 * pergunta de escolha, que vem antes, tem um valor).
 *
 * Frente UXS: a linha inteira abre a pergunta (com a setinha que gira e
 * aria-expanded), sem o lápis que repetia o mesmo clique, e `somenteLeitura`
 * mostra tudo sem deixar mexer (quem não é admin no editor de modelos).
 */

export const ROTULO_DO_TIPO: Record<TipoDeCampo, string> = {
  text: "Texto curto",
  textarea: "Texto longo",
  "single-chip": "Escolha única",
  "multi-chip": "Várias escolhas",
  scale: "Escala de 1 a 5",
  reference: "Referências",
  upload: "Arquivo",
  url: "Endereço",
  checklist: "Materiais",
  confirm: "Confirmar dado",
  date: "Data",
};

const linhas = (t: string) => t.split("\n").map((x) => x.trim()).filter(Boolean);

/** Pergunta nova, com chave provisória (vira a definitiva ao salvar, pelo texto). */
export function perguntaNova(existentes: string[], prefixo = ""): CampoDoBriefing {
  return { key: chaveNova("nova pergunta", existentes, prefixo), tipo: "text", pergunta: "" };
}

export default function EditorDeCampos({
  campos,
  onMudar,
  anteriores = [],
  todasAsChaves,
  prefixo = "",
  rotulo,
  somenteLeitura = false,
}: {
  campos: CampoDoBriefing[];
  onMudar: (campos: CampoDoBriefing[]) => void;
  /** Perguntas que vêm antes desta lista (para a condição). */
  anteriores?: CampoDoBriefing[];
  todasAsChaves: string[];
  prefixo?: string;
  rotulo: string;
  /** Só leitura: abre as perguntas para ver, sem mover, tirar, arrastar nem criar. */
  somenteLeitura?: boolean;
}) {
  const [aberta, setAberta] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState<number | null>(null);
  const mudarCampo = (i: number, parte: Partial<CampoDoBriefing>) => onMudar(campos.map((c, k) => (k === i ? { ...c, ...parte } : c)));
  const tirar = (i: number) => {
    const key = campos[i].key;
    // Quem dependia desta pergunta perde a condição.
    onMudar(campos.filter((_, k) => k !== i).map((c) => (c.mostrarSe && c.mostrarSe.key === key ? { ...c, mostrarSe: undefined } : c)));
  };
  return (
    <div className="min-w-0">
      {campos.length === 0 ? (
        <p className={texto.auxiliar}>Nenhuma pergunta ainda.</p>
      ) : (
        <ol className={juntar(lista.aberta, lista.divisoria)} aria-label={rotulo}>
          {campos.map((c, i) => {
            const antes = anteriores.concat(campos.slice(0, i)).filter((x) => x.tipo === "single-chip" || x.tipo === "multi-chip");
            const abertaAqui = aberta === c.key;
            const idDaEdicao = `pergunta-${c.key}`;
            return (
              <li
                key={c.key}
                draggable={!somenteLeitura}
                onDragStart={(e) => {
                  setArrastando(i);
                  try {
                    e.dataTransfer.setData("text/plain", String(i));
                  } catch { /* navegador sem dataTransfer */ }
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (!somenteLeitura && arrastando !== null && arrastando !== i) onMudar(moverItem(campos, arrastando, i));
                  setArrastando(null);
                }}
                onDragEnd={() => setArrastando(null)}
                className={juntar("min-w-0 px-2 py-2", arrastando === i && "opacity-50")}
                data-pergunta={c.key}
              >
                <div className="flex min-w-0 items-center">
                  {!somenteLeitura && <GripVertical className="mr-1.5 hidden h-4 w-4 shrink-0 cursor-grab text-muted-foreground sm:block" aria-hidden="true" />}
                  <button
                    type="button"
                    onClick={() => setAberta(abertaAqui ? null : c.key)}
                    aria-expanded={abertaAqui}
                    aria-controls={idDaEdicao}
                    className="flex min-w-0 flex-1 items-center text-left"
                  >
                    <ChevronDown className={juntar("mr-1.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform", abertaAqui ? "" : "-rotate-90")} aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">{c.pergunta || "Pergunta sem texto"}</span>
                      <span className={juntar(texto.auxiliar, "block truncate")}>
                        {ROTULO_DO_TIPO[c.tipo]}
                        {c.obrigatorio ? " · obrigatória" : ""}
                        {c.mostrarSe ? " · com condição" : ""}
                      </span>
                    </span>
                  </button>
                  {!c.pergunta.trim() && <span className={juntar(etiqueta, "ml-2 bg-destructive/10 text-destructive")}>sem texto</span>}
                  {!somenteLeitura && (
                    <>
                      <button type="button" onClick={() => onMudar(moverItem(campos, i, i - 1))} disabled={i === 0} className={juntar(botao.icone, "ml-1")} aria-label={`Subir ${c.pergunta || "pergunta"}`}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => onMudar(moverItem(campos, i, i + 1))} disabled={i === campos.length - 1} className={botao.icone} aria-label={`Descer ${c.pergunta || "pergunta"}`}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => tirar(i)} className={botao.icone} aria-label={`Tirar ${c.pergunta || "pergunta"}`}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </>
                  )}
                </div>
                {abertaAqui && <EdicaoDaPergunta id={idDaEdicao} campo={c} antes={antes} onMudar={(parte) => mudarCampo(i, parte)} somenteLeitura={somenteLeitura} />}
              </li>
            );
          })}
        </ol>
      )}
      {!somenteLeitura && (
        <button
          type="button"
          onClick={() => {
            const nova = perguntaNova(todasAsChaves, prefixo);
            onMudar(campos.concat(nova));
            setAberta(nova.key);
          }}
          className={juntar(botao.discreto, "-ml-2 mt-1 h-8 px-2 text-[12px]")}
        >
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Nova pergunta
        </button>
      )}
    </div>
  );
}

function EdicaoDaPergunta({
  id,
  campo: c,
  antes,
  onMudar,
  somenteLeitura,
}: {
  id: string;
  campo: CampoDoBriefing;
  antes: CampoDoBriefing[];
  onMudar: (p: Partial<CampoDoBriefing>) => void;
  somenteLeitura: boolean;
}) {
  const [opcoes, setOpcoes] = useState((c.opcoes || []).join("\n"));
  const [itens, setItens] = useState((c.itens || []).join("\n"));
  const alvo = c.mostrarSe ? antes.find((x) => x.key === c.mostrarSe!.key) : null;
  const escolha = c.tipo === "single-chip" || c.tipo === "multi-chip";
  const n = (v: string) => (v.trim() ? Math.max(0, Math.floor(Number(v) || 0)) || undefined : undefined);
  // Só leitura: texto com readOnly; seleção e caixa com disabled (readOnly não vale para eles).
  return (
    <div id={id} className="mt-3 min-w-0 pb-2 sm:pl-6">
      <GrupoDeCampos colunas={2}>
        <CampoDeFormulario rotulo="Pergunta" obrigatorio largo>
          <input readOnly={somenteLeitura} className={estiloDoCampo} value={c.pergunta} maxLength={240} onChange={(e) => onMudar({ pergunta: e.target.value })} aria-label="Texto da pergunta" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Apoio" largo>
          <input readOnly={somenteLeitura} className={estiloDoCampo} value={c.apoio || ""} maxLength={240} onChange={(e) => onMudar({ apoio: e.target.value || undefined })} aria-label="Texto de apoio" />
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Tipo">
          <select disabled={somenteLeitura} className={estiloDoCampo} value={c.tipo} onChange={(e) => onMudar({ tipo: e.target.value as TipoDeCampo })} aria-label="Tipo da pergunta">
            {TIPOS_DE_CAMPO.map((t) => <option key={t} value={t}>{ROTULO_DO_TIPO[t]}</option>)}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Resposta">
          <label className="flex h-9 items-center text-[13px] text-foreground">
            <input type="checkbox" disabled={somenteLeitura} className="mr-2 h-4 w-4 accent-primary" checked={!!c.obrigatorio} onChange={(e) => onMudar({ obrigatorio: e.target.checked || undefined })} />
            Obrigatória
          </label>
        </CampoDeFormulario>
        {escolha && (
          <CampoDeFormulario rotulo="Opções" apoio="Uma por linha. Pelo menos duas." largo>
            <textarea readOnly={somenteLeitura} className={juntar(campoTexto, "min-h-[72px]")} value={opcoes} onChange={(e) => setOpcoes(e.target.value)} onBlur={() => onMudar({ opcoes: linhas(opcoes).slice(0, 40) })} aria-label="Opções" />
          </CampoDeFormulario>
        )}
        {escolha && (
          <CampoDeFormulario rotulo="Outro">
            <label className="flex h-9 items-center text-[13px] text-foreground">
              <input type="checkbox" disabled={somenteLeitura} className="mr-2 h-4 w-4 accent-primary" checked={!!c.outro} onChange={(e) => onMudar({ outro: e.target.checked || undefined })} />
              Aceita "Outro, qual?"
            </label>
          </CampoDeFormulario>
        )}
        {c.tipo === "multi-chip" && (
          <CampoDeFormulario rotulo="Máximo de escolhas">
            <input readOnly={somenteLeitura} className={estiloDoCampo} inputMode="numeric" value={c.maxSelect ? String(c.maxSelect) : ""} onChange={(e) => onMudar({ maxSelect: n(e.target.value) })} aria-label="Máximo de escolhas" />
          </CampoDeFormulario>
        )}
        {(c.tipo === "text" || c.tipo === "textarea") && (
          <CampoDeFormulario rotulo="Limite de caracteres">
            <input readOnly={somenteLeitura} className={estiloDoCampo} inputMode="numeric" value={c.maxChars ? String(c.maxChars) : ""} onChange={(e) => onMudar({ maxChars: n(e.target.value) })} aria-label="Limite de caracteres" />
          </CampoDeFormulario>
        )}
        {c.tipo === "scale" && (
          <CampoDeFormulario rotulo="Polos (1 e 5)" largo>
            <div className="flex min-w-0">
              <input readOnly={somenteLeitura} className={estiloDoCampo} value={c.polos ? c.polos[0] : ""} placeholder="Ex.: Sério" onChange={(e) => onMudar({ polos: [e.target.value, c.polos ? c.polos[1] : ""] })} aria-label="Polo 1" />
              <input readOnly={somenteLeitura} className={juntar(estiloDoCampo, "ml-2")} value={c.polos ? c.polos[1] : ""} placeholder="Ex.: Descontraído" onChange={(e) => onMudar({ polos: [c.polos ? c.polos[0] : "", e.target.value] })} aria-label="Polo 5" />
            </div>
          </CampoDeFormulario>
        )}
        {(c.tipo === "reference" || c.tipo === "url") && (
          <CampoDeFormulario rotulo="Mínimo">
            <input readOnly={somenteLeitura} className={estiloDoCampo} inputMode="numeric" value={c.minimo ? String(c.minimo) : ""} onChange={(e) => onMudar({ minimo: n(e.target.value) })} aria-label="Mínimo" />
          </CampoDeFormulario>
        )}
        {c.tipo === "url" && (
          <CampoDeFormulario rotulo="Vários">
            <label className="flex h-9 items-center text-[13px] text-foreground">
              <input type="checkbox" disabled={somenteLeitura} className="mr-2 h-4 w-4 accent-primary" checked={!!c.multiplo} onChange={(e) => onMudar({ multiplo: e.target.checked || undefined })} />
              Aceita vários endereços
            </label>
          </CampoDeFormulario>
        )}
        {c.tipo === "upload" && (
          <CampoDeFormulario rotulo="Categoria do arquivo">
            <select disabled={somenteLeitura} className={estiloDoCampo} value={c.categoria || "outros"} onChange={(e) => onMudar({ categoria: e.target.value as CategoriaDeAnexo })} aria-label="Categoria do arquivo">
              {(Object.keys(ROTULO_DA_CATEGORIA) as CategoriaDeAnexo[]).map((k) => <option key={k} value={k}>{ROTULO_DA_CATEGORIA[k]}</option>)}
            </select>
          </CampoDeFormulario>
        )}
        {c.tipo === "checklist" && (
          <CampoDeFormulario rotulo="Materiais" apoio="Um por linha." largo>
            <textarea readOnly={somenteLeitura} className={juntar(campoTexto, "min-h-[72px]")} value={itens} onChange={(e) => setItens(e.target.value)} onBlur={() => onMudar({ itens: linhas(itens).slice(0, 20) })} aria-label="Materiais" />
          </CampoDeFormulario>
        )}
        <CampoDeFormulario rotulo="Só aparece quando" apoio={antes.length ? undefined : "Precisa de uma pergunta de escolha antes."} largo>
          <div className="flex min-w-0 flex-wrap">
            <select
              className={juntar(estiloDoCampo, "sm:w-auto sm:flex-1")}
              value={c.mostrarSe ? c.mostrarSe.key : ""}
              disabled={somenteLeitura || !antes.length}
              onChange={(e) => {
                const k = e.target.value;
                const x = antes.find((y) => y.key === k);
                onMudar({ mostrarSe: x ? { key: k, valor: (x.opcoes || [])[0] || "" } : undefined });
              }}
              aria-label="Pergunta da condição"
            >
              <option value="">Sempre</option>
              {antes.map((x) => <option key={x.key} value={x.key}>{x.pergunta.slice(0, 60) || x.key}</option>)}
            </select>
            {alvo && (
              <select disabled={somenteLeitura}
                className={juntar(estiloDoCampo, "mt-2 sm:ml-2 sm:mt-0 sm:w-auto sm:flex-1")}
                value={Array.isArray(c.mostrarSe!.valor) ? c.mostrarSe!.valor[0] : c.mostrarSe!.valor}
                onChange={(e) => onMudar({ mostrarSe: { key: alvo.key, valor: e.target.value } })}
                aria-label="Valor da condição"
              >
                {(alvo.opcoes || []).concat(alvo.outro ? ["Outro"] : []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
          </div>
        </CampoDeFormulario>
      </GrupoDeCampos>
    </div>
  );
}
