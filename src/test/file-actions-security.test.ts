import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadFile } from "@/lib/fileActions";

describe("strict file downloads", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("never navigates to a quarantined URL when the fetch fails", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("CORS blocked")));
    const errors: Array<{ message?: string }> = [];
    const onError = (event: Event) => {
      errors.push((event as CustomEvent<{ message?: string }>).detail);
    };
    window.addEventListener("file-download:error", onError);

    try {
      await expect(downloadFile(
        "https://storage.example.test/quarantine/file.pdf",
        "file.pdf",
        { allowNavigationFallback: false },
      )).rejects.toThrow("CORS blocked");
    } finally {
      window.removeEventListener("file-download:error", onError);
    }

    expect(openSpy).not.toHaveBeenCalled();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toBe("CORS blocked");
  });
});
