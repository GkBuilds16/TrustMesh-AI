import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Auth from "./Auth";

describe("authentication form validation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("rejects passwords above bcrypt's UTF-8 byte limit before sending login", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<Auth onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "analyst@example.test" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "😀".repeat(19) } });
    fireEvent.click(document.querySelector(".auth-submit"));

    expect((await screen.findByRole("alert")).textContent).toContain("72 UTF-8 bytes");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows a multibyte password exactly at the 72-byte boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: "Invalid credentials." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<Auth onLogin={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "analyst@example.test" } });
    fireEvent.change(screen.getByPlaceholderText("Enter your password"), { target: { value: "😀".repeat(18) } });
    fireEvent.click(document.querySelector(".auth-submit"));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
