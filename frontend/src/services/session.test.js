import { afterEach, describe, expect, it } from "vitest";
import { clearSession, readStoredSession, saveSession } from "./session";

describe("authentication session state", () => {
  afterEach(() => sessionStorage.clear());

  it("persists and restores the signed-in analyst", () => {
    const user = { id: "analyst-1", name: "Analyst One", role: "ANALYST" };
    expect(saveSession({ token: "signed-token", user })).toEqual(user);
    expect(readStoredSession()).toEqual(user);
  });

  it("clears a partial or malformed session instead of trusting stale UI data", () => {
    sessionStorage.setItem("trustmesh_user", "not-json");
    expect(readStoredSession()).toBeNull();
    expect(sessionStorage.getItem("trustmesh_user")).toBeNull();
    expect(sessionStorage.getItem("trustmesh_token")).toBeNull();
  });

  it("clears both token and user when signing out", () => {
    saveSession({ token: "signed-token", user: { id: "analyst-1" } });
    clearSession();
    expect(readStoredSession()).toBeNull();
  });
});
