import { Fragment, useMemo } from "react";

/**
 * Texto de relatório com respiro e hierarquia, sem depender de markdown do
 * autor: quebra em parágrafos, entende listas ("- " ou "• "), transforma
 * "Título:" em subtítulo, e destaca **negrito** e números/valores citados.
 * Nada de parede de texto.
 */

function renderInline(text: string, keyPrefix: string) {
  // **negrito** explícito + destaque automático de valores (R$ 1.234,56, 12%, 14 conversas)
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={`${keyPrefix}-b${index}`} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const valueParts = part.split(/(R\$\s?[\d.,]+|\b\d+[.,]?\d*\s?%|\b\d+[.,]\d+\b)/g);
    return (
      <Fragment key={`${keyPrefix}-t${index}`}>
        {valueParts.map((piece, pieceIndex) =>
          /^(R\$\s?[\d.,]+|\d+[.,]?\d*\s?%|\d+[.,]\d+)$/.test(piece) ? (
            <span key={pieceIndex} className="font-semibold text-foreground">
              {piece}
            </span>
          ) : (
            <Fragment key={pieceIndex}>{piece}</Fragment>
          ),
        )}
      </Fragment>
    );
  });
}

export default function RichText({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => {
    const lines = (text || "").split("\n").map((line) => line.trim());
    const result: Array<
      | { kind: "heading"; text: string }
      | { kind: "paragraph"; text: string }
      | { kind: "list"; items: string[] }
    > = [];
    let listBuffer: string[] = [];

    const flushList = () => {
      if (listBuffer.length > 0) {
        result.push({ kind: "list", items: listBuffer });
        listBuffer = [];
      }
    };

    for (const line of lines) {
      if (!line) {
        flushList();
        continue;
      }
      if (/^[-•*]\s+/.test(line)) {
        listBuffer.push(line.replace(/^[-•*]\s+/, ""));
        continue;
      }
      flushList();
      // "O que funcionou:" vira subtítulo quando é curto e termina em dois pontos
      if (/^[^.!?]{3,60}:$/.test(line)) {
        result.push({ kind: "heading", text: line.slice(0, -1) });
        continue;
      }
      // Parágrafos longos sem quebra: divide em blocos de ~2 frases para respirar
      const sentences = line.split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/);
      if (sentences.length > 3) {
        for (let index = 0; index < sentences.length; index += 2) {
          result.push({ kind: "paragraph", text: sentences.slice(index, index + 2).join(" ") });
        }
      } else {
        result.push({ kind: "paragraph", text: line });
      }
    }
    flushList();
    return result;
  }, [text]);

  if (blocks.length === 0) return null;

  return (
    <div className={className}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          return (
            <p
              key={index}
              className="mb-1.5 mt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-primary first:mt-0"
            >
              {block.text}
            </p>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={index} className="mb-3 space-y-1.5 last:mb-0">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="flex items-start gap-2 text-[13px] leading-relaxed text-foreground/85">
                  <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden="true" />
                  <span>{renderInline(item, `li-${index}-${itemIndex}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={index} className="mb-3 text-[13px] leading-relaxed text-foreground/85 last:mb-0">
            {renderInline(block.text, `p-${index}`)}
          </p>
        );
      })}
    </div>
  );
}
