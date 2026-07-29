import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import TaskCommentContent from "@/components/admin/TaskCommentContent";

afterEach(cleanup);

describe("TaskCommentContent", () => {
  it("preserves mentions and renders only http/https URLs as safe links", () => {
    const text =
      "Publicado por @Ana Souza: https://instagram.com/p/abc. FTP: ftp://files.test/item";
    const { container } = render(
      <p>
        <TaskCommentContent text={text} memberNames={["Ana", "Ana Souza"]} />
      </p>,
    );

    expect(container).toHaveTextContent(text);
    expect(screen.getByText("@Ana Souza")).toHaveClass("text-primary");

    const link = screen.getByRole("link", {
      name: "https://instagram.com/p/abc",
    });
    expect(link).toHaveAttribute("href", "https://instagram.com/p/abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.queryByRole("link", { name: /ftp:/i })).toBeNull();
  });

  it("does not turn unknown mentions, unsafe protocols or markup into elements", () => {
    const text =
      '@Desconhecido javascript:alert(1) <img src=x onerror="alert(1)">';
    const { container } = render(
      <TaskCommentContent text={text} memberNames={["Ana Souza"]} />,
    );

    expect(container).toHaveTextContent(text);
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("keeps mentions inside a URL as part of the URL", () => {
    render(
      <TaskCommentContent
        text="Veja https://example.com/@Ana e fale com @Ana"
        memberNames={["Ana"]}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "https://example.com/@Ana",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("@Ana")).toHaveLength(1);
  });
});
