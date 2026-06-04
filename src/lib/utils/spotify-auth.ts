import { api } from "$lib/api";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { SpotifyAuthStatus } from "$lib/types/ledger";

export async function getSpotifyStatus(): Promise<SpotifyAuthStatus | null> {
  return api.spotifyGetAuthStatus();
}

export async function connectSpotify(): Promise<SpotifyAuthStatus> {
  const authUrl = await api.spotifyStartAuthFlow();

  // Set up listener BEFORE opening the URL so we don't miss the callback.
  // Capture the unlisten promise so the handler can unregister itself after
  // the first invocation — prevents duplicate firings on subsequent auth flows.
  const statusPromise = new Promise<SpotifyAuthStatus>((resolve, reject) => {
    const unlistenPromise = listen<{ code: string; state: string }>(
      "spotify-auth-callback",
      async (event) => {
        const unlisten = await unlistenPromise;
        unlisten();
        try {
          const result = await api.spotifyExchangeCode(
            event.payload.code,
            event.payload.state,
          );
          resolve(result);
        } catch (e) {
          reject(e);
        }
      },
    );
  });

  // Now open the browser for the user to authorize
  await openUrl(authUrl);

  return statusPromise;
}

export async function disconnectSpotify(): Promise<void> {
  await api.spotifyRevoke();
}
