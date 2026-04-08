CREATE TABLE spotify_auth (
    id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    access_token  TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at    TEXT NOT NULL
);
