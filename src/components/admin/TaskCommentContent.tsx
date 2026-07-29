import { Fragment, type ReactNode } from "react";

interface TaskCommentContentProps {
  text: string;
  memberNames?: readonly (string | null | undefined)[];
}

interface TextMatch {
  index: number;
  length: number;
  node: ReactNode;
}

const URL_PATTERN = /https?:\/\/[^\s<>"']+/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:)\]}]+$/;

function isMentionBoundary(value: string | undefined) {
  return value === undefined || !/[\p{L}\p{N}_]/u.test(value);
}

function findNextUrl(text: string, fromIndex: number): TextMatch | null {
  URL_PATTERN.lastIndex = fromIndex;
  const match = URL_PATTERN.exec(text);
  if (!match) return null;

  const trailing = match[0].match(TRAILING_URL_PUNCTUATION)?.[0] || "";
  const href = trailing ? match[0].slice(0, -trailing.length) : match[0];
  if (!href) return null;

  return {
    index: match.index,
    length: href.length,
    node: (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="break-all font-medium text-primary underline underline-offset-2 hover:opacity-80"
      >
        {href}
      </a>
    ),
  };
}

function findNextMention(
  text: string,
  fromIndex: number,
  memberNames: readonly (string | null | undefined)[],
): TextMatch | null {
  let next: TextMatch | null = null;

  for (const name of memberNames) {
    if (typeof name !== "string") continue;
    const normalizedName = name.trim();
    if (!normalizedName) continue;

    const mention = `@${normalizedName}`;
    let index = text.indexOf(mention, fromIndex);
    while (index >= 0) {
      const before = index > 0 ? text[index - 1] : undefined;
      const after = text[index + mention.length];
      if (isMentionBoundary(before) && isMentionBoundary(after)) {
        if (
          !next ||
          index < next.index ||
          (index === next.index && mention.length > next.length)
        ) {
          next = {
            index,
            length: mention.length,
            node: (
              <span className="rounded bg-primary/10 px-0.5 font-semibold text-primary">
                {mention}
              </span>
            ),
          };
        }
        break;
      }
      index = text.indexOf(mention, index + mention.length);
    }
  }

  return next;
}

export default function TaskCommentContent({
  text,
  memberNames = [],
}: TaskCommentContentProps) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let partIndex = 0;

  while (cursor < text.length) {
    const url = findNextUrl(text, cursor);
    const mention = findNextMention(text, cursor, memberNames);
    const next =
      !mention || (url && url.index <= mention.index) ? url : mention;

    if (!next) {
      parts.push(text.slice(cursor));
      break;
    }
    if (next.index > cursor) {
      parts.push(text.slice(cursor, next.index));
    }
    parts.push(
      <Fragment key={`${next.index}-${partIndex}`}>{next.node}</Fragment>,
    );
    partIndex += 1;
    cursor = next.index + next.length;
  }

  return <>{parts}</>;
}
