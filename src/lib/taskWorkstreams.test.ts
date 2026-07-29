import { describe, expect, it } from "vitest";
import {
  canonicalTaskStatus,
  editorialStageForTaskStatus,
  isDesignTask,
  isEditorialTask,
  kanbanStatusForEditorialStage,
} from "@/lib/taskWorkstreams";

const designMemberIds = new Set(["designer-1"]);

describe("isEditorialTask", () => {
  it.each(["design", "content", "video"])(
    "inclui a área editorial explícita %s",
    (workstream) => {
      expect(
        isEditorialTask(
          { workstream, assigned_to: null, source: "panel" },
          designMemberIds,
        ),
      ).toBe(true);
    },
  );

  it("mantém isDesignTask como alias compatível", () => {
    const task = {
      workstream: "content",
      assigned_to: null,
      source: "panel",
    };
    expect(isDesignTask(task, designMemberIds)).toBe(
      isEditorialTask(task, designMemberIds),
    );
  });

  it.each(["traffic", "development", "operations"])(
    "exclui a área operacional explícita %s mesmo com sinais editoriais",
    (workstream) => {
      expect(
        isEditorialTask(
          {
            workstream,
            assigned_to: "designer-1",
            source: "panel",
            title: "Criar carrossel e vídeo",
          },
          designMemberIds,
        ),
      ).toBe(false);
    },
  );

  it("usa o responsável de design como fallback conservador em Geral ou legado", () => {
    expect(
      isEditorialTask(
        {
          workstream: "general",
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isEditorialTask(
        {
          workstream: null,
          assigned_to: "designer-1",
          source: "panel",
        },
        designMemberIds,
      ),
    ).toBe(true);
    expect(
      isEditorialTask(
        {
          workstream: "general",
          assigned_to: "manager-1",
          source: "panel",
          title: "Revisar relatório financeiro",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });

  it.each([
    ["Criar carrosséis para o Instagram", null],
    ["Planejar conteúdo do próximo mês", null],
    ["Produção", "Editar vídeos e Reels cinematográficos"],
    ["Identidade visual", "Definir direção de arte"],
  ])(
    "reconhece sinais editoriais fortes com normalização de acentos",
    (title, description) => {
      expect(
        isEditorialTask(
          {
            workstream: "general",
            assigned_to: null,
            source: "panel",
            title,
            description,
          },
          designMemberIds,
        ),
      ).toBe(true);
    },
  );

  it("não confunde fragmentos de palavras com sinais editoriais", () => {
    expect(
      isEditorialTask(
        {
          workstream: "general",
          assigned_to: null,
          source: "panel",
          title: "Revisar impostos e suporte operacional",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });

  it.each([
    "orion_carrossel_semana_1",
    "orion_cliente_reels_semana_2",
  ])("reconhece fonte editorial determinística %s", (source) => {
    expect(
      isEditorialTask(
        {
          workstream: "general",
          assigned_to: null,
          source,
          title: "Produção semanal",
        },
        designMemberIds,
      ),
    ).toBe(true);
  });

  it("exclui tarefas originadas de pedidos de cliente", () => {
    expect(
      isEditorialTask(
        {
          workstream: "content",
          assigned_to: "designer-1",
          source: "CLIENT_REQUEST:request-id:signature",
          title: "Criar carrossel",
        },
        designMemberIds,
      ),
    ).toBe(false);
    expect(
      isEditorialTask(
        {
          assigned_to: "designer-1",
          source: "client_request:request-id:signature",
        },
        designMemberIds,
      ),
    ).toBe(false);
  });
});

describe("canonicalTaskStatus", () => {
  it.each([
    ["backlog", "backlog"],
    ["todo", "backlog"],
    ["doing", "doing"],
    ["in_progress", "doing"],
    ["review", "review"],
    ["approved", "review"],
    ["done", "done"],
    ["blocked", "doing"],
  ])("normaliza %s para %s", (status, expected) => {
    expect(canonicalTaskStatus(status)).toBe(expected);
  });

  it.each([null, undefined, "cancelled", "unknown"])(
    "retorna null para status sem coluna canônica: %s",
    (status) => {
      expect(canonicalTaskStatus(status)).toBeNull();
    },
  );
});

describe("editorialStageForTaskStatus", () => {
  it.each([
    ["backlog", "draft"],
    ["todo", "draft"],
    ["doing", "production"],
    ["in_progress", "production"],
    ["blocked", "production"],
    ["review", "ready"],
    ["approved", "ready"],
  ])("mapeia %s para %s", (status, expected) => {
    expect(editorialStageForTaskStatus(status)).toBe(expected);
  });

  it.each(["done", "unknown"])(
    "não força etapa editorial a partir de %s",
    (status) => {
      expect(editorialStageForTaskStatus(status)).toBeNull();
    },
  );
});

describe("kanbanStatusForEditorialStage", () => {
  it.each([
    ["draft", "backlog"],
    ["production", "doing"],
    ["ready", "review"],
  ])("mapeia %s para %s", (stage, expected) => {
    expect(kanbanStatusForEditorialStage(stage)).toBe(expected);
  });

  it.each([null, undefined, "cancelled", "archived"])(
    "retorna null para estágio sem coluna ativa: %s",
    (stage) => {
      expect(kanbanStatusForEditorialStage(stage)).toBeNull();
    },
  );
});
