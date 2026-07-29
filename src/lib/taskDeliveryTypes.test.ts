import { describe, expect, it } from "vitest";
import {
  TASK_DELIVERY_TYPE_LABELS,
  TASK_DELIVERY_TYPE_OPTIONS,
  TASK_DELIVERY_TYPE_VALUES,
  contentTypeForDeliveryType,
  isPublishableDeliveryType,
  isPublishableTask,
  suggestedWorkstreamForDeliveryType,
} from "@/lib/taskDeliveryTypes";

const designMemberIds = new Set(["designer-1"]);

describe("task delivery types", () => {
  it("exports one labelled option for every accepted value", () => {
    expect(TASK_DELIVERY_TYPE_OPTIONS).toHaveLength(
      TASK_DELIVERY_TYPE_VALUES.length,
    );
    expect(
      TASK_DELIVERY_TYPE_OPTIONS.map(({ value }) => value),
    ).toEqual(TASK_DELIVERY_TYPE_VALUES);
    for (const value of TASK_DELIVERY_TYPE_VALUES) {
      expect(TASK_DELIVERY_TYPE_LABELS[value]).toBeTruthy();
    }
  });

  it.each([
    ["design", "design"],
    ["branding", "design"],
    ["carousel", "design"],
    ["reel", "video"],
    ["video", "video"],
    ["planning", "content"],
    ["copywriting", "content"],
    ["website", "development"],
    ["landing_page", "development"],
    ["automation", "development"],
    ["traffic", "traffic"],
    ["report", "general"],
  ])("suggests area %s -> %s", (deliveryType, expected) => {
    expect(suggestedWorkstreamForDeliveryType(deliveryType)).toBe(expected);
  });

  it.each([
    ["design", "static"],
    ["static", "static"],
    ["carousel", "carousel"],
    ["reel", "reel"],
    ["story", "story"],
    ["video", "video"],
    ["short", "short"],
    ["article", "article"],
    ["google_post", "google_post"],
  ])("maps publishable type %s to %s", (deliveryType, expected) => {
    expect(isPublishableDeliveryType(deliveryType)).toBe(true);
    expect(contentTypeForDeliveryType(deliveryType)).toBe(expected);
  });

  it.each([
    "unspecified",
    "branding",
    "planning",
    "copywriting",
    "website",
    "landing_page",
    "automation",
    "traffic",
    "seo",
    "document",
    "report",
    "other",
  ])("keeps non-publishable type %s out of the calendar", (deliveryType) => {
    expect(isPublishableDeliveryType(deliveryType)).toBe(false);
    expect(contentTypeForDeliveryType(deliveryType)).toBeNull();
  });

  it("uses explicit delivery type before the legacy editorial fallback", () => {
    expect(
      isPublishableTask(
        {
          delivery_type: "carousel",
          workstream: "general",
          assigned_to: null,
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isPublishableTask(
        {
          delivery_type: "branding",
          workstream: "design",
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });

  it("preserves the legacy fallback only for missing or unspecified types", () => {
    expect(
      isPublishableTask(
        {
          delivery_type: "unspecified",
          workstream: "general",
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isPublishableTask(
        {
          delivery_type: null,
          workstream: "content",
          assigned_to: null,
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
  });

  it.each([
    "Branding e identidade visual",
    "Planejamento editorial do mês",
    "Criar landing page",
    "Automação de atendimento",
    "Relatório de tráfego pago",
  ])(
    "keeps an obvious legacy non-publishable task out of the calendar: %s",
    (title) => {
      expect(
        isPublishableTask(
          {
            delivery_type: "unspecified",
            workstream: "design",
            assigned_to: "designer-1",
            source: "panel",
            title,
          },
          designMemberIds,
        ),
      ).toBe(false);
    },
  );

  it("always excludes tasks originating from client requests", () => {
    expect(
      isPublishableTask(
        {
          delivery_type: "reel",
          workstream: "video",
          assigned_to: "designer-1",
          source: "CLIENT_REQUEST:request-id:signature",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });
});
