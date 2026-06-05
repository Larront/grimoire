// Tests for the Command Wrapper's error posture (ADR-0010): the api/api.silent
// surfaces, code→friendly-message resolution, toast-on-throw, and that both
// surfaces rethrow so control flow still aborts.
import { describe, it, expect, afterEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { toastError } from "$lib/toast";

vi.mock("$lib/toast", () => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);
const mockedToast = vi.mocked(toastError);

// Imported after the mocks above are registered.
import { api } from "$lib/api";

afterEach(() => {
  mockedInvoke.mockReset();
  mockedInvoke.mockResolvedValue(null);
  mockedToast.mockReset();
  vi.restoreAllMocks();
});

describe("Command Wrapper — success path", () => {
  it("returns the command result and does not toast", async () => {
    mockedInvoke.mockResolvedValueOnce(["a", "b"]);
    const tags = await api.listAllTags();
    expect(tags).toEqual(["a", "b"]);
    expect(mockedToast).not.toHaveBeenCalled();
  });
});

describe("Command Wrapper — api.* (toast surface)", () => {
  it("maps a coded error to its friendly message and rethrows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce("ERR_NAME_TAKEN: A file already exists at 'x.md'");

    await expect(api.listAllTags()).rejects.toBeDefined(); // rethrows
    expect(mockedToast).toHaveBeenCalledWith("That name is already taken.");
  });

  it("maps an unknown error to the generic message and rethrows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce("No ledger open");

    await expect(api.listAllTags()).rejects.toBeDefined();
    expect(mockedToast).toHaveBeenCalledWith("Something went wrong — please try again.");
  });

  it("resolves each known code to its own copy", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [string, string][] = [
      ["ERR_UNSUPPORTED_IMAGE: .bmp", "That image format isn't supported — use PNG, JPG, GIF, or WebP."],
      ["ERR_SPOTIFY_AUTH: State mismatch", "Couldn't connect to Spotify — please try again."],
    ];
    for (const [raw, friendly] of cases) {
      mockedToast.mockClear();
      mockedInvoke.mockRejectedValueOnce(raw);
      await expect(api.listAllTags()).rejects.toBeDefined();
      expect(mockedToast).toHaveBeenCalledWith(friendly);
    }
  });

  it("always logs the raw developer detail", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce("ERR_NAME_TAKEN: A file already exists at 'x.md'");
    await expect(api.listAllTags()).rejects.toBeDefined();
    expect(spy).toHaveBeenCalled();
    // the raw (coded) string is what gets logged, not the friendly copy
    expect(String(spy.mock.calls[0])).toContain("ERR_NAME_TAKEN");
  });
});

describe("Command Wrapper — api.silent (quiet surface)", () => {
  it("does NOT toast on failure but still rethrows", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce("ERR_NAME_TAKEN: taken");

    await expect(api.silent.listAllTags()).rejects.toBeDefined();
    expect(mockedToast).not.toHaveBeenCalled();
  });

  it("still logs the failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedInvoke.mockRejectedValueOnce("boom");
    await expect(api.silent.listAllTags()).rejects.toBeDefined();
    expect(spy).toHaveBeenCalled();
  });

  it("returns the result on success", async () => {
    mockedInvoke.mockResolvedValueOnce(["x"]);
    expect(await api.silent.listAllTags()).toEqual(["x"]);
  });
});
