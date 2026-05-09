declare namespace Spotify {
  interface PlayerInit {
    name: string;
    getOAuthToken: (cb: (token: string) => void) => void;
    volume?: number;
  }

  interface Player {
    connect(): Promise<boolean>;
    disconnect(): void;
    addListener(
      event: "ready",
      cb: (state: { device_id: string }) => void,
    ): void;
    addListener(event: "not_ready", cb: () => void): void;
    addListener(
      event:
        | "initialization_error"
        | "authentication_error"
        | "account_error"
        | "playback_error",
      cb: (state: { message: string }) => void,
    ): void;
    pause(): Promise<void>;
    setVolume(volume: number): Promise<void>;
  }

  // eslint-disable-next-line @typescript-eslint/no-redeclare
  const Player: new (options: PlayerInit) => Player;
}

interface Window {
  Spotify: typeof Spotify;
  onSpotifyWebPlaybackSDKReady: () => void;
}
