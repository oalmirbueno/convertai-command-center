import { useMemo, useState } from "react";
import { Check, Compass, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ditado } from "@/components/mesa/Ditado";
import { useMesa } from "@/components/mesa/MesaContexto";
import { AvisoDeErro } from "@/components/mesa/Custo";
import { Moldura } from "./Comuns";
import { ImagemDaBiblioteca, LicencaEAutor } from "./EtapaBiblioteca";
import {
  descreverGuia,
  MAX_REFERENCIAS_NO_GUIA,
  MAX_TEXTO_DO_GUIA,
  MODOS_DO_GUIA,
  rotuloDaCategoriaDaBiblioteca,
  useBiblioteca,
  type Guia,
  type ModoDoGuia,
} from "./fotoApi";

/**
 * "Como guiar esta foto": quatro caminhos bem separados (prompt da
 * biblioteca, referência de imagem, prompt escrito ou sem guia). O que vai
 * ser usado fica sempre escrito embaixo, antes de gerar. Referência de imagem
 * guia clima, luz e composição; nunca o assunto (esse vem do kit).
 */
export default function SeletorDeGuia({ guia, onMudar }: { guia: Guia; onMudar: (g: Guia) => void }) {
  const { clientId } = useMesa();
  const biblioteca = useBiblioteca(clientId, guia.modo === "biblioteca" || guia.modo === "referencia");
  const [busca, setBusca] = useState("");
  const itens = useMemo(() => biblioteca.data || [], [biblioteca.data]);
  const termo = busca.trim().toLowerCase();
  const tipo = guia.modo === "referencia" ? "referencia" : "prompt";
  const lista = useMemo(
    () =>
      itens
        .filter((i) => i.tipo === tipo)
        .filter((i) => !termo || `${i.titulo} ${i.prompt_pt} ${i.tags.join(" ")} ${i.categoria}`.toLowerCase().indexOf(termo) >= 0)
        .slice(0, 60),
    [itens, tipo, termo],
  );
  const escolhido = guia.modo === "biblioteca" && guia.prompt_id ? itens.find((i) => i.id === guia.prompt_id) || null : null;
  const refs = guia.referencia_ids || [];

  const trocarModo = (m: ModoDoGuia) => {
    if (m === guia.modo) return;
    onMudar({ modo: m, prompt_id: undefined, referencia_ids: m === "referencia" ? [] : undefined, texto: m === "livre" ? guia.texto || "" : undefined });
  };

  const alternarRef = (id: string) => {
    if (refs.indexOf(id) >= 0) onMudar({ ...guia, referencia_ids: refs.filter((x) => x !== id) });
    else if (refs.length < MAX_REFERENCIAS_NO_GUIA) onMudar({ ...guia, referencia_ids: refs.concat([id]) });
  };

  return (
    <div className="min-w-0 space-y-3" data-guia={guia.modo}>
      <p className="flex items-center text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        <Compass className="mr-1 h-3.5 w-3.5" /> Como guiar esta foto
      </p>
      <div role="radiogroup" aria-label="Como guiar esta foto" className="grid min-w-0 grid-cols-2 gap-1.5 md:grid-cols-4">
        {MODOS_DO_GUIA.map((m) => (
          <button
            key={m.valor}
            type="button"
            role="radio"
            aria-checked={guia.modo === m.valor}
            onClick={() => trocarModo(m.valor)}
            className={`min-w-0 rounded-lg border px-2.5 py-2 text-left transition-colors ${
              guia.modo === m.valor ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/40"
            }`}
          >
            <span className="block truncate text-[12.5px] font-medium">{m.rotulo}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{m.dica}</span>
          </button>
        ))}
      </div>

      {(guia.modo === "biblioteca" || guia.modo === "referencia") && (
        <div className="min-w-0 space-y-2">
          <div className="relative min-w-0">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={guia.modo === "biblioteca" ? "Buscar prompt (luz, estilo, cenário...)" : "Buscar referência"}
              aria-label="Buscar na biblioteca"
              className="h-9 pl-8"
            />
          </div>
          {biblioteca.isError && <AvisoDeErro erro={biblioteca.error} />}
          {biblioteca.isSuccess && lista.length === 0 && (
            <p className="text-[12px] text-muted-foreground">Nada na biblioteca com essa busca. A etapa Biblioteca traz prompts e referências públicas.</p>
          )}
          {guia.modo === "biblioteca" ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto" aria-label="Prompts da biblioteca">
              {lista.map((i) => (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onMudar({ modo: "biblioteca", prompt_id: i.id })}
                    aria-pressed={guia.prompt_id === i.id}
                    className={`block w-full min-w-0 rounded-lg border px-2.5 py-1.5 text-left ${guia.prompt_id === i.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted"}`}
                  >
                    <span className="flex min-w-0 items-center text-[12.5px] font-medium">
                      <span className="min-w-0 flex-1 truncate">{i.titulo}</span>
                      <span className="ml-2 shrink-0 text-[10.5px] font-normal text-muted-foreground">{rotuloDaCategoriaDaBiblioteca(i.categoria)}</span>
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">{i.prompt_pt || i.prompt_en}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid max-h-72 min-w-0 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 md:grid-cols-6" aria-label="Referências da biblioteca">
              {lista.map((i) => {
                const marcada = refs.indexOf(i.id) >= 0;
                return (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => alternarRef(i.id)}
                    aria-pressed={marcada}
                    aria-label={`Referência ${i.titulo}`}
                    disabled={!marcada && refs.length >= MAX_REFERENCIAS_NO_GUIA}
                    className={`relative min-w-0 rounded-lg border p-0.5 text-left disabled:opacity-40 ${marcada ? "border-primary" : "border-transparent hover:border-border"}`}
                  >
                    <Moldura proporcao={1}>
                      <ImagemDaBiblioteca item={i} />
                    </Moldura>
                    {marcada && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                    <span className="mt-0.5 block truncate text-[10.5px]">{i.titulo}</span>
                    <LicencaEAutor item={i} compacta />
                  </button>
                );
              })}
            </div>
          )}
          {escolhido && (
            <div className="rounded-lg border border-border bg-background p-2.5 text-[12px] leading-relaxed">
              <p className="[overflow-wrap:anywhere]">{escolhido.prompt_pt || escolhido.prompt_en}</p>
              {escolhido.negativo && <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Evitar: {escolhido.negativo}</p>}
            </div>
          )}
        </div>
      )}

      {guia.modo === "livre" && (
        <div className="relative min-w-0">
          <Textarea
            value={guia.texto || ""}
            onChange={(e) => onMudar({ modo: "livre", texto: e.target.value })}
            rows={3}
            maxLength={MAX_TEXTO_DO_GUIA}
            placeholder="Ex.: luz de fim de tarde vinda da esquerda, bancada de madeira clara, sombra suave"
            aria-label="Seu prompt"
            className="pr-10 text-[12.5px]"
          />
          <Ditado valor={guia.texto || ""} onChange={(v) => onMudar({ modo: "livre", texto: v })} className="absolute bottom-1.5 right-1.5" />
        </div>
      )}

      <p className="rounded-lg bg-muted px-2.5 py-1.5 text-[12px]" data-o-que-sera-usado="">
        <span className="text-muted-foreground">Será usado: </span>
        <span className="font-medium [overflow-wrap:anywhere]">{descreverGuia(guia, itens)}</span>
      </p>
    </div>
  );
}
