import { useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Paperclip, Pencil, Plus, Trash2, X } from "lucide-react";
import { CampoDeFormulario, botao, foco, juntar, superficie, texto } from "@/components/sistema";
import RespostaPorAudio from "./RespostaPorAudio";
import { campoPublico, campoTextoPublico } from "@/components/publico/CascaPublica";
import {
  type AnexoDoBriefing,
  type CampoDoBriefing,
  type ItemDeReferencia,
  type Respostas,
  type SituacaoDoMaterial,
  EXTENSOES_DE_ANEXO,
  SITUACOES_DO_MATERIAL,
  anexosDoCampo,
  chaveDaConfirmacao,
  chaveDoOutro,
  urlValida,
} from "../../../supabase/functions/_shared/briefing-modelos";

/**
 * Os campos do briefing por tipo (frente BRF, 30/09/2026). Celular primeiro:
 * chips que quebram linha, alvos de toque de 44 px (o CSS responsivo do
 * painel), campo com letra de 16 px no celular (o iPhone não dá zoom).
 * Sem `gap` em flex (Safari 11): espaço é margem.
 */

export const idDoCampo = (key: string) => `briefing-${key}`;

export type AoMudar = (key: string, valor: unknown) => void;
/** Envia os arquivos do campo; devolve os anexos que ficaram prontos. */
export type AoAnexar = (campo: CampoDoBriefing, arquivos: File[]) => Promise<AnexoDoBriefing[]>;

export type PropsDoCampo = {
  campo: CampoDoBriefing;
  respostas: Respostas;
  prefill: Record<string, string>;
  anexos: AnexoDoBriefing[];
  erro?: string | null;
  somenteLeitura?: boolean;
  enviando?: boolean;
  onMudar: AoMudar;
  onAnexar: AoAnexar;
  onRemoverAnexo: (anexo: AnexoDoBriefing) => void;
  /** Resposta por áudio (frente BRF2): grava, transcreve e junta ao campo. Sem ela, o botão não aparece. */
  onTranscrever?: (campo: CampoDoBriefing, audio: Blob, segundos: number) => Promise<void>;
};

function Rotulo({ t }: { t: string }) {
  return <span className="whitespace-normal text-[13px] font-medium leading-5 text-foreground">{t}</span>;
}

const chip = (marcado: boolean) =>
  juntar(
    "m-1 inline-flex min-h-[36px] items-center rounded-md border px-3 py-1.5 text-left text-[13px] leading-5 transition-colors disabled:opacity-40",
    marcado ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
    foco,
  );

const LARGOS = new Set(["textarea", "multi-chip", "scale", "reference", "upload", "checklist"]);

export default function CampoDoBriefingUI(p: PropsDoCampo) {
  const { campo } = p;
  const id = idDoCampo(campo.key);
  const largo = LARGOS.has(campo.tipo) || (campo.tipo === "url" && !!campo.multiplo) || (campo.tipo === "single-chip" && (campo.opcoes || []).length > 3);
  return (
    <CampoDeFormulario rotulo={<Rotulo t={campo.pergunta} />} obrigatorio={!!campo.obrigatorio} largo={largo} erro={p.erro || undefined} apoio={apoioDoCampo(p)}>
      <Controle {...p} id={id} />
    </CampoDeFormulario>
  );
}

function apoioDoCampo(p: PropsDoCampo): React.ReactNode {
  const { campo, respostas } = p;
  const base = campo.apoio;
  if (campo.tipo === "multi-chip" && campo.maxSelect) {
    const n = Array.isArray(respostas[campo.key]) ? (respostas[campo.key] as unknown[]).length : 0;
    return `${base ? `${base} ` : ""}${n} de ${campo.maxSelect}.`;
  }
  if ((campo.tipo === "textarea" || campo.tipo === "text") && campo.maxChars) {
    const n = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string).length : 0;
    return (
      <span className="flex min-w-0">
        <span className="mr-2 min-w-0 flex-1">{base}</span>
        <span className={juntar("shrink-0 tabular-nums", n >= campo.maxChars && "text-destructive")}>{n}/{campo.maxChars}</span>
      </span>
    );
  }
  return base;
}

function Controle(p: PropsDoCampo & { id: string }) {
  switch (p.campo.tipo) {
    case "textarea":
      return <Texto {...p} longo />;
    case "date":
      return <Data {...p} />;
    case "single-chip":
      return <Escolha {...p} />;
    case "multi-chip":
      return <Varias {...p} />;
    case "scale":
      return <Escala {...p} />;
    case "url":
      return p.campo.multiplo ? <ListaDeUrls {...p} /> : <Url {...p} />;
    case "reference":
      return <Referencias {...p} />;
    case "upload":
      return <Envio {...p} />;
    case "checklist":
      return <Materiais {...p} />;
    case "confirm":
      return <Confirmar {...p} />;
    default:
      return <Texto {...p} />;
  }
}

// ------------------------------------------------------------------ texto

function Texto({ campo, respostas, onMudar, somenteLeitura, id, longo, onTranscrever }: PropsDoCampo & { id: string; longo?: boolean }) {
  const v = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string) : "";
  const mudar = (novo: string) => {
    if (campo.maxChars && novo.length > campo.maxChars) return;
    onMudar(campo.key, novo);
  };
  if (longo) {
    // Pergunta aberta: dá para responder por áudio (grava, transcreve e junta ao que já estava escrito).
    return (
      <div className="min-w-0">
        <textarea id={id} value={v} readOnly={somenteLeitura} onChange={(e) => mudar(e.target.value)} placeholder={campo.placeholder} rows={4} className={juntar(campoTextoPublico, "resize-y")} />
        {onTranscrever && !somenteLeitura && <RespostaPorAudio onTranscrever={(a, s) => onTranscrever(campo, a, s)} />}
      </div>
    );
  }
  return <input id={id} type="text" value={v} readOnly={somenteLeitura} onChange={(e) => mudar(e.target.value)} placeholder={campo.placeholder} className={campoPublico} />;
}

function Data({ campo, respostas, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const v = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string) : "";
  return <input id={id} type="date" value={v} readOnly={somenteLeitura} onChange={(e) => onMudar(campo.key, e.target.value)} placeholder="dd/mm/aaaa" className={juntar(campoPublico, "sm:max-w-[220px]")} />;
}

function Outro({ campo, respostas, onMudar, somenteLeitura }: PropsDoCampo) {
  const k = chaveDoOutro(campo.key);
  const v = typeof respostas[k] === "string" ? (respostas[k] as string) : "";
  return (
    <input
      type="text"
      aria-label={`Outro: ${campo.pergunta}`}
      value={v}
      readOnly={somenteLeitura}
      onChange={(e) => onMudar(k, e.target.value.slice(0, 200))}
      placeholder="Qual?"
      className={juntar(campoPublico, "mt-2")}
    />
  );
}

function Escolha(p: PropsDoCampo & { id: string }) {
  const { campo, respostas, onMudar, somenteLeitura, id } = p;
  const v = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string) : "";
  const opcoes = campo.opcoes || [];
  // Muitas opções: seletor. Poucas: botões (um toque no celular).
  if (opcoes.length > 8) {
    return (
      <div className="min-w-0">
        <select id={id} value={v} disabled={somenteLeitura} onChange={(e) => onMudar(campo.key, e.target.value)} className={campoPublico}>
          <option value="">Escolha uma opção</option>
          {opcoes.map((op) => <option key={op} value={op}>{op}</option>)}
        </select>
        {campo.outro && v === "Outro" && <Outro {...p} />}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <div id={id} tabIndex={-1} role="radiogroup" className="-m-1 flex flex-wrap outline-none">
        {opcoes.map((op) => (
          <button key={op} type="button" role="radio" aria-checked={v === op} disabled={somenteLeitura} onClick={() => onMudar(campo.key, v === op ? "" : op)} className={chip(v === op)}>
            {op}
          </button>
        ))}
      </div>
      {campo.outro && v === "Outro" && <Outro {...p} />}
    </div>
  );
}

function Varias(p: PropsDoCampo & { id: string }) {
  const { campo, respostas, onMudar, somenteLeitura, id } = p;
  const lista: string[] = Array.isArray(respostas[campo.key]) ? (respostas[campo.key] as string[]) : [];
  const cheio = !!campo.maxSelect && lista.length >= campo.maxSelect;
  const alternar = (op: string) => {
    if (lista.indexOf(op) >= 0) onMudar(campo.key, lista.filter((x) => x !== op));
    else if (!cheio) onMudar(campo.key, lista.concat(op));
  };
  const opcoes = campo.outro && (campo.opcoes || []).indexOf("Outro") < 0 ? (campo.opcoes || []).concat("Outro") : campo.opcoes || [];
  return (
    <div className="min-w-0">
      <div id={id} tabIndex={-1} role="group" className="-m-1 flex flex-wrap outline-none">
        {opcoes.map((op) => {
          const marcada = lista.indexOf(op) >= 0;
          return (
            <button key={op} type="button" aria-pressed={marcada} disabled={somenteLeitura || (!marcada && cheio)} onClick={() => alternar(op)} className={chip(marcada)}>
              {op}
            </button>
          );
        })}
      </div>
      {campo.outro && lista.indexOf("Outro") >= 0 && <Outro {...p} />}
    </div>
  );
}

// ------------------------------------------------------------------ escala

function Escala({ campo, respostas, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const v = typeof respostas[campo.key] === "number" ? (respostas[campo.key] as number) : 0;
  const [a, b] = campo.polos || ["", ""];
  return (
    <div id={id} tabIndex={-1} role="radiogroup" className="flex min-w-0 items-center outline-none">
      <span className={juntar(texto.auxiliar, "w-[72px] shrink-0 truncate sm:w-24")}>{a}</span>
      <span className="flex min-w-0 flex-1 items-center justify-between px-1 sm:px-3">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={v === n}
            aria-label={`${n} de 5: ${n < 3 ? a : n > 3 ? b : "equilíbrio"}`}
            disabled={somenteLeitura}
            onClick={() => onMudar(campo.key, v === n ? null : n)}
            className={juntar(
              "toque-compacto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[12px] tabular-nums transition-colors",
              v === n ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50",
              foco,
            )}
          >
            {n}
          </button>
        ))}
      </span>
      <span className={juntar(texto.auxiliar, "w-[72px] shrink-0 truncate text-right sm:w-24")}>{b}</span>
    </div>
  );
}

// ------------------------------------------------------------------ url

function Url({ campo, respostas, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const v = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string) : "";
  return <input id={id} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={v} readOnly={somenteLeitura} onChange={(e) => onMudar(campo.key, e.target.value.slice(0, 400))} placeholder={campo.placeholder || "https://"} className={campoPublico} />;
}

function ListaDeUrls({ campo, respostas, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const lista: string[] = Array.isArray(respostas[campo.key]) ? (respostas[campo.key] as string[]) : [];
  const linhas = lista.length ? lista : [""];
  const mudar = (i: number, valor: string) => {
    const nova = linhas.slice();
    nova[i] = valor.slice(0, 400);
    onMudar(campo.key, nova);
  };
  return (
    <div id={id} tabIndex={-1} className="min-w-0 space-y-2 outline-none">
      {linhas.map((u, i) => (
        <div key={i} className="flex min-w-0 items-center">
          <input
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            aria-label={`${campo.pergunta} ${i + 1}`}
            value={u}
            readOnly={somenteLeitura}
            onChange={(e) => mudar(i, e.target.value)}
            placeholder={campo.placeholder || "https://"}
            className={juntar(campoPublico, u.trim() && !urlValida(u) && "border-destructive")}
          />
          {!somenteLeitura && linhas.length > 1 && (
            <button type="button" aria-label="Tirar" onClick={() => onMudar(campo.key, linhas.filter((_, k) => k !== i))} className={juntar(botao.icone, "ml-1")}>
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      ))}
      {!somenteLeitura && linhas.length < 8 && (
        <button type="button" onClick={() => onMudar(campo.key, linhas.concat(""))} className={juntar(botao.discreto, "-ml-2 h-8 px-2 text-[12px]")}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Mais um
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ referências

function Referencias(p: PropsDoCampo & { id: string }) {
  const { campo, respostas, onMudar, somenteLeitura, id, anexos } = p;
  const lista: ItemDeReferencia[] = Array.isArray(respostas[campo.key]) ? (respostas[campo.key] as ItemDeReferencia[]) : [];
  const minimo = Math.max(1, campo.minimo || 1);
  const linhas: ItemDeReferencia[] = lista.length >= minimo ? lista : lista.concat(Array.from({ length: minimo - lista.length }, () => ({})));
  const mudar = (i: number, parte: Partial<ItemDeReferencia>) => onMudar(campo.key, linhas.map((x, k) => (k === i ? { ...x, ...parte } : x)));
  const [anexandoEm, setAnexandoEm] = useState<number | null>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const aoEscolher = async (arquivos: FileList | null) => {
    const i = anexandoEm;
    if (entrada.current) entrada.current.value = "";
    if (!arquivos || !arquivos.length || i === null) return;
    const novos = await p.onAnexar(campo, [arquivos[0]]);
    setAnexandoEm(null);
    if (novos[0]) mudar(i, { anexo_id: novos[0].id, link: undefined });
  };
  return (
    <div id={id} tabIndex={-1} className="min-w-0 outline-none">
      <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={(e) => void aoEscolher(e.target.files)} />
      <ol className="min-w-0 space-y-3">
        {linhas.map((r, i) => {
          const anexo = r.anexo_id ? anexos.find((a) => a.id === r.anexo_id) : null;
          return (
            <li key={i} className={juntar(superficie.poco, "min-w-0 p-3")}>
              <div className="flex min-w-0 items-center">
                <span className={juntar(texto.etiqueta, "mr-2 shrink-0 tabular-nums text-muted-foreground")}>{i + 1}</span>
                {anexo ? (
                  <span className={juntar(texto.corpo, "flex min-w-0 flex-1 items-center")}>
                    <ImagePlus className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                    <span className="min-w-0 truncate">{anexo.nome}</span>
                  </span>
                ) : (
                  <input
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoCorrect="off"
                    aria-label={`Link da referência ${i + 1}`}
                    value={r.link || ""}
                    readOnly={somenteLeitura}
                    onChange={(e) => mudar(i, { link: e.target.value.slice(0, 400) })}
                    placeholder="Link: site, Instagram, Pinterest"
                    className={juntar(campoPublico, "flex-1", r.link && !urlValida(r.link) && "border-destructive")}
                  />
                )}
                {!somenteLeitura && !anexo && (
                  <button
                    type="button"
                    onClick={() => {
                      setAnexandoEm(i);
                      entrada.current?.click();
                    }}
                    disabled={p.enviando}
                    aria-label={`Enviar imagem na referência ${i + 1}`}
                    className={juntar(botao.icone, "ml-1")}
                  >
                    {p.enviando && anexandoEm === i ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ImagePlus className="h-4 w-4" aria-hidden="true" />}
                  </button>
                )}
                {!somenteLeitura && (anexo || r.link || r.nota || linhas.length > minimo) && (
                  <button
                    type="button"
                    aria-label={`Limpar referência ${i + 1}`}
                    onClick={() => {
                      if (anexo) p.onRemoverAnexo(anexo);
                      onMudar(campo.key, linhas.filter((_, k) => k !== i));
                    }}
                    className={juntar(botao.icone, "ml-1")}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
              <input
                type="text"
                aria-label={`O que você gosta na referência ${i + 1}`}
                value={r.nota || ""}
                readOnly={somenteLeitura}
                onChange={(e) => mudar(i, { nota: e.target.value.slice(0, 300) })}
                placeholder="O que chama a sua atenção aqui"
                className={juntar(campoPublico, "mt-2")}
              />
            </li>
          );
        })}
      </ol>
      {!somenteLeitura && linhas.length < 10 && (
        <button type="button" onClick={() => onMudar(campo.key, linhas.concat({}))} className={juntar(botao.discreto, "-ml-2 mt-2 h-8 px-2 text-[12px]")}>
          <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Mais uma referência
        </button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ envio de arquivo

const ACEITOS = EXTENSOES_DE_ANEXO.map((e) => `.${e}`).join(",");

export function tamanhoLegivel(bytes: number | null | undefined): string {
  const n = Number(bytes || 0);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Envio({ campo, anexos, somenteLeitura, enviando, id, onAnexar, onRemoverAnexo }: PropsDoCampo & { id: string }) {
  const entrada = useRef<HTMLInputElement>(null);
  const meus = anexosDoCampo(anexos, campo.key);
  return (
    <div className="min-w-0">
      <input
        ref={entrada}
        type="file"
        multiple
        accept={ACEITOS}
        className="hidden"
        onChange={(e) => {
          const lista = e.target.files ? (Array.prototype.slice.call(e.target.files) as File[]) : [];
          if (entrada.current) entrada.current.value = "";
          if (lista.length) void onAnexar(campo, lista);
        }}
      />
      {meus.length > 0 && (
        <ul className="mb-2 min-w-0 divide-y divide-border/50">
          {meus.map((a) => (
            <li key={a.id} className="flex min-w-0 items-center py-1.5">
              <Paperclip className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{a.nome}</span>
              <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>{tamanhoLegivel(a.tamanho)}</span>
              {!somenteLeitura && (
                <button type="button" aria-label={`Tirar ${a.nome}`} onClick={() => onRemoverAnexo(a)} className={juntar(botao.icone, "ml-1")}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!somenteLeitura ? (
        <button id={id} type="button" disabled={enviando} onClick={() => entrada.current?.click()} className={botao.secundario}>
          {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Paperclip className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {enviando ? "Enviando..." : meus.length ? "Anexar mais" : "Anexar arquivo"}
        </button>
      ) : !meus.length ? (
        <p id={id} className={texto.auxiliar}>Nenhum arquivo.</p>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ materiais

function Materiais({ campo, respostas, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const bruto = respostas[campo.key];
  const v = bruto && typeof bruto === "object" && !Array.isArray(bruto) ? (bruto as Record<string, SituacaoDoMaterial>) : {};
  const marcar = (item: string, s: SituacaoDoMaterial) => {
    const novo = { ...v };
    if (novo[item] === s) delete novo[item];
    else novo[item] = s;
    onMudar(campo.key, novo);
  };
  return (
    <ul id={id} tabIndex={-1} className="min-w-0 divide-y divide-border/50 outline-none">
      {(campo.itens || []).map((item) => (
        <li key={item} className="min-w-0 py-2 sm:flex sm:items-center">
          <span className={juntar(texto.corpo, "block min-w-0 sm:mr-3 sm:flex-1")}>{item}</span>
          <span role="radiogroup" aria-label={item} className="-m-1 mt-1 flex flex-wrap sm:mt-0 sm:shrink-0">
            {SITUACOES_DO_MATERIAL.map((s) => (
              <button key={s.valor} type="button" role="radio" aria-checked={v[item] === s.valor} disabled={somenteLeitura} onClick={() => marcar(item, s.valor)} className={juntar(chip(v[item] === s.valor), "min-h-[32px] py-1 text-[12px]")}>
                {s.rotulo}
              </button>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ confirmar o que já sabemos

function Confirmar({ campo, respostas, prefill, onMudar, somenteLeitura, id }: PropsDoCampo & { id: string }) {
  const sabido = prefill[campo.key] || "";
  const atual = typeof respostas[campo.key] === "string" ? (respostas[campo.key] as string) : "";
  const confirmado = respostas[chaveDaConfirmacao(campo.key)] === true;
  const [editando, setEditando] = useState(!sabido || (!!atual && atual !== sabido));
  if (!sabido || editando) {
    return (
      <input
        id={id}
        type="text"
        value={atual}
        readOnly={somenteLeitura}
        onChange={(e) => {
          onMudar(campo.key, e.target.value.slice(0, 400));
          if (confirmado) onMudar(chaveDaConfirmacao(campo.key), null);
        }}
        placeholder={sabido || campo.placeholder}
        className={campoPublico}
      />
    );
  }
  return (
    <div id={id} tabIndex={-1} className={juntar(superficie.poco, "flex min-w-0 flex-wrap items-center px-3 py-2 outline-none")}>
      <span className={juntar(texto.corpo, "mr-3 min-w-0 flex-1 [overflow-wrap:anywhere]")}>{sabido}</span>
      {!somenteLeitura && (
        <span className="mt-1 flex shrink-0 items-center sm:mt-0">
          <button
            type="button"
            aria-pressed={confirmado}
            onClick={() => {
              onMudar(campo.key, confirmado ? null : sabido);
              onMudar(chaveDaConfirmacao(campo.key), confirmado ? null : true);
            }}
            className={juntar(confirmado ? botao.primario : botao.secundario, "h-8 px-2.5 text-[12px]")}
          >
            <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {confirmado ? "Confirmado" : "Está certo"}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditando(true);
              onMudar(campo.key, sabido);
              onMudar(chaveDaConfirmacao(campo.key), null);
            }}
            className={juntar(botao.discreto, "ml-1 h-8 px-2.5 text-[12px]")}
          >
            <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            Corrigir
          </button>
        </span>
      )}
    </div>
  );
}
