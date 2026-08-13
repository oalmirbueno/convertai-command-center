import { describe, expect, it } from "vitest";
import {
  AUTOMATIC_DELIVERY_MAX_ASSETS,
  canDeliverAutomatically,
} from "./editorialScheduler";

/**
 * Contrato da entrega automática.
 *
 * O bug que isto protege: o agendamento nunca declarava o modo de entrega,
 * então toda publicação nascia manual e o motor de publicação jamais olhava
 * para ela. Nada saía sozinho, e ninguém via o porquê.
 */
describe("modo de entrega do agendamento", () => {
  it("publica sozinho quando existe lista de arquivos dentro do limite da Meta", () => {
    expect(canDeliverAutomatically(["a"])).toBe(true);
    expect(canDeliverAutomatically(["a", "b", "c"])).toBe(true);
    expect(
      canDeliverAutomatically(Array.from({ length: AUTOMATIC_DELIVERY_MAX_ASSETS }, (_, i) => `f${i}`)),
    ).toBe(true);
  });

  it("volta para manual acima do limite, em vez de recusar o agendamento", () => {
    const acimaDoLimite = Array.from(
      { length: AUTOMATIC_DELIVERY_MAX_ASSETS + 1 },
      (_, i) => `f${i}`,
    );
    expect(canDeliverAutomatically(acimaDoLimite)).toBe(false);
  });

  it("sem lista de arquivos congelada não promete publicação automática", () => {
    expect(canDeliverAutomatically([])).toBe(false);
  });

  it("o limite é o da Meta: 10 itens", () => {
    expect(AUTOMATIC_DELIVERY_MAX_ASSETS).toBe(10);
  });
});
