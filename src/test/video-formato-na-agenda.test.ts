import { describe, expect, it } from "vitest";
import { formatoDoVideoNaAgenda } from "@/components/mesa/videoDaPauta";

describe("formato do post de vídeo bate com o tipo da tarefa (27/10)", () => {
  it("tarefa de vídeo mantém o tipo dela", () => {
    for (const t of ["reel", "short", "video", "story"]) expect(formatoDoVideoNaAgenda(t)).toBe(t);
  });
  it("pauta planejada em outro formato (ou sem tipo) vai como Reels", () => {
    for (const t of ["static", "design", "carousel", "unspecified", null, undefined]) expect(formatoDoVideoNaAgenda(t)).toBe("reel");
  });
});
