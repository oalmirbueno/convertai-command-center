import { describe, expect, it } from "vitest";
import {
  TASK_DELIVERY_TYPE_LABELS,
  TASK_DELIVERY_TYPE_OPTIONS,
  TASK_DELIVERY_TYPE_VALUES,
  PUBLISHABLE_DELIVERY_TYPE_VALUES,
  contentTypeForDeliveryType,
  isPublishableDeliveryType,
  isPublishableTask,
  suggestedWorkstreamForDeliveryType,
} from "@/lib/taskDeliveryTypes";

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

  it.each(PUBLISHABLE_DELIVERY_TYPE_VALUES)(
    "admits only the explicit publishable whitelist: %s",
    (deliveryType) => {
      expect(
        isPublishableTask({
          delivery_type: deliveryType,
          workstream: "general",
          assigned_to: null,
          source: "panel",
        }),
      ).toBe(true);
    },
  );

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
    "unknown",
  ])(
    "rejects every type outside the publishable whitelist: %s",
    (deliveryType) => {
      expect(
        isPublishableTask({
          delivery_type: deliveryType,
          workstream: "design",
          assigned_to: "designer-1",
          source: "panel",
          title: "Carrossel para o feed",
        }),
      ).toBe(false);
    },
  );

  it.each([null, undefined])(
    "fails closed without an explicit delivery type: %s",
    (deliveryType) => {
      expect(
        isPublishableTask({
          delivery_type: deliveryType,
          workstream: "content",
          assigned_to: "designer-1",
          source: "panel",
          title: "Criar vídeo e arte",
        }),
      ).toBe(false);
    },
  );

  it("always excludes tasks originating from client requests", () => {
    expect(
      isPublishableTask({
        delivery_type: "reel",
        workstream: "video",
        assigned_to: "designer-1",
        source: "CLIENT_REQUEST:request-id:signature",
      }),
    ).toBe(false);
    expect(
      isPublishableTask({
        delivery_type: "static",
        source: "client_request",
      }),
    ).toBe(false);
  });
});
