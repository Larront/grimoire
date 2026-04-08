use std::env;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use diesel::prelude::*;
use dotenvy::dotenv;
use rand::Rng;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, State};

use crate::db::models::{NewSpotifyAuth, SpotifyAuth, SpotifyAuthStatus};
use crate::db::schema::spotify_auth;
use crate::vault::AppVault;

// ---- PKCE helpers ----

fn generate_random_string(len: usize) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
    let mut rng = rand::thread_rng();
    (0..len)
        .map(|_| CHARSET[rng.gen_range(0..CHARSET.len())] as char)
        .collect()
}

fn generate_code_challenge(verifier: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(hasher.finalize())
}

// ---- Private helpers ----

struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_at: String,
}

async fn post_to_token_endpoint(params: &[(&str, &str)]) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let response = client
        .post("https://accounts.spotify.com/api/token")
        .form(params)
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("Spotify returned {status}: {body}"));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))
}

fn parse_token_response(
    data: &serde_json::Value,
    fallback_refresh_token: Option<String>,
) -> Result<TokenResponse, String> {
    let access_token = data["access_token"]
        .as_str()
        .ok_or("Missing access_token in Spotify response")?
        .to_string();
    let expires_in = data["expires_in"]
        .as_i64()
        .ok_or("Missing expires_in in Spotify response")?;
    let refresh_token = data["refresh_token"]
        .as_str()
        .map(|s| s.to_string())
        .or(fallback_refresh_token)
        .ok_or("Missing refresh_token in Spotify response")?;
    let expires_at = (Utc::now() + chrono::Duration::seconds(expires_in)).to_rfc3339();
    Ok(TokenResponse {
        access_token,
        refresh_token,
        expires_at,
    })
}

fn persist_auth(auth: &TokenResponse, conn: &mut SqliteConnection) -> Result<(), String> {
    diesel::replace_into(spotify_auth::table)
        .values(NewSpotifyAuth {
            id: 1,
            access_token: auth.access_token.clone(),
            refresh_token: auth.refresh_token.clone(),
            expires_at: auth.expires_at.clone(),
        })
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn spotify_get_auth_status(
    vault: State<AppVault>,
) -> Result<Option<SpotifyAuthStatus>, String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    match spotify_auth::table.find(1).first::<SpotifyAuth>(conn) {
        Ok(auth) => Ok(Some(SpotifyAuthStatus {
            is_connected: true,
            expires_at: auth.expires_at,
        })),
        Err(diesel::result::Error::NotFound) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub async fn spotify_start_auth_flow(
    vault: State<'_, AppVault>,
    app: AppHandle,
) -> Result<String, String> {
    dotenv().ok();
    let client_id = env::var("SPOTIFY_CLIENT_ID").expect("SPOTIFY_CLIENT_ID not set at build time");

    // Bind first — fail fast if port is in use
    let listener = std::net::TcpListener::bind("127.0.0.1:8888").map_err(|_| {
        "Port 8888 is in use — please close other applications and try again".to_string()
    })?;

    let verifier = generate_random_string(64);
    let challenge = generate_code_challenge(&verifier);
    let state_val = generate_random_string(16);

    {
        let mut state = vault.lock().map_err(|e| e.to_string())?;
        state.pending_spotify_verifier = Some(verifier);
        state.pending_spotify_state = Some(state_val.clone());
    }

    std::thread::spawn(move || {
        use std::io::{Read, Write};
        use std::time::Duration;

        listener.set_nonblocking(true).ok();
        let deadline = std::time::Instant::now() + Duration::from_secs(120);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    if std::time::Instant::now() >= deadline {
                        return;
                    }
                    std::thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return,
            }
        };
        stream.set_nonblocking(false).ok();

        let mut buf = [0u8; 4096];
        let n = stream.read(&mut buf).unwrap_or(0);
        let request = String::from_utf8_lossy(&buf[..n]);

        let html = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n\
            <html><body><h1>Authorization complete. You can close this tab.</h1></body></html>";
        stream.write_all(html.as_bytes()).ok();
        drop(stream);

        // Parse ?code=...&state=... from the HTTP request line
        let query = request
            .lines()
            .next()
            .unwrap_or("")
            .split_whitespace()
            .nth(1)
            .and_then(|path| path.split_once('?').map(|(_, q)| q))
            .unwrap_or("");

        let mut code: Option<String> = None;
        let mut state: Option<String> = None;
        for param in query.split('&') {
            if let Some((k, v)) = param.split_once('=') {
                match k {
                    "code" => code = Some(v.to_string()),
                    "state" => state = Some(v.to_string()),
                    _ => {}
                }
            }
        }

        if let (Some(code), Some(state)) = (code, state) {
            app.emit(
                "spotify-auth-callback",
                serde_json::json!({ "code": code, "state": state }),
            )
            .ok();
        }
    });

    Ok(format!(
        "https://accounts.spotify.com/authorize\
        ?client_id={client_id}\
        &response_type=code\
        &redirect_uri=http%3A%2F%2F127.0.0.1%3A8888%2Fcallback\
        &scope=streaming%20user-read-email%20user-read-private%20user-modify-playback-state\
        &code_challenge_method=S256\
        &code_challenge={challenge}\
        &state={state_val}"
    ))
}

#[tauri::command]
pub async fn spotify_exchange_code(
    code: String,
    state: String,
    vault: State<'_, AppVault>,
) -> Result<SpotifyAuthStatus, String> {
    dotenv().ok();
    let client_id = env::var("SPOTIFY_CLIENT_ID").expect("SPOTIFY_CLIENT_ID not set at build time");

    // Brief lock: take verifier + validate state, then drop
    let verifier = {
        let mut vault_state = vault.lock().map_err(|e| e.to_string())?;
        let verifier = vault_state
            .pending_spotify_verifier
            .take()
            .ok_or("No pending auth flow — please start the auth flow again")?;
        let stored_state = vault_state
            .pending_spotify_state
            .take()
            .ok_or("No pending auth flow — please start the auth flow again")?;
        if stored_state != state {
            return Err("State mismatch — possible CSRF attack".to_string());
        }
        verifier
    };

    let token_data = post_to_token_endpoint(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", "http://127.0.0.1:8888/callback"),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
    ])
    .await?;

    let auth = parse_token_response(&token_data, None)?;
    let expires_at = auth.expires_at.clone();

    {
        let mut vault_state = vault.lock().map_err(|e| e.to_string())?;
        let conn = vault_state.connection.as_mut().ok_or("No vault open")?;
        persist_auth(&auth, conn)?;
    }

    Ok(SpotifyAuthStatus {
        is_connected: true,
        expires_at,
    })
}

#[tauri::command]
pub async fn spotify_refresh_token(
    vault: State<'_, AppVault>,
) -> Result<SpotifyAuthStatus, String> {
    dotenv().ok();
    let client_id = env::var("SPOTIFY_CLIENT_ID").expect("SPOTIFY_CLIENT_ID not set at build time");

    let current_refresh = {
        let mut state = vault.lock().map_err(|e| e.to_string())?;
        let conn = state.connection.as_mut().ok_or("No vault open")?;
        spotify_auth::table
            .find(1)
            .select(spotify_auth::refresh_token)
            .first::<String>(conn)
            .map_err(|_| "Spotify not connected".to_string())?
    };

    let token_data = post_to_token_endpoint(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", &current_refresh),
        ("client_id", &client_id),
    ])
    .await?;

    let auth = parse_token_response(&token_data, Some(current_refresh))?;
    let expires_at = auth.expires_at.clone();

    {
        let mut state = vault.lock().map_err(|e| e.to_string())?;
        let conn = state.connection.as_mut().ok_or("No vault open")?;
        persist_auth(&auth, conn)?;
    }

    Ok(SpotifyAuthStatus {
        is_connected: true,
        expires_at,
    })
}

#[tauri::command]
pub async fn spotify_get_access_token(vault: State<'_, AppVault>) -> Result<String, String> {
    dotenv().ok();
    let client_id =
        env::var("SPOTIFY_CLIENT_ID").map_err(|_| "SPOTIFY_CLIENT_ID not set".to_string())?;

    let auth = {
        let mut state = vault.lock().map_err(|e| e.to_string())?;
        let conn = state.connection.as_mut().ok_or("No vault open")?;
        spotify_auth::table
            .find(1)
            .first::<SpotifyAuth>(conn)
            .map_err(|_| "Spotify not connected".to_string())?
    };

    let expires_at = chrono::DateTime::parse_from_rfc3339(&auth.expires_at)
        .map_err(|e| format!("Invalid expires_at: {e}"))?
        .with_timezone(&Utc);

    if expires_at <= Utc::now() + chrono::Duration::minutes(5) {
        // Auto-refresh
        let token_data = post_to_token_endpoint(&[
            ("grant_type", "refresh_token"),
            ("refresh_token", &auth.refresh_token),
            ("client_id", &client_id),
        ])
        .await?;
        let new_auth = parse_token_response(&token_data, Some(auth.refresh_token))?;
        let new_access = new_auth.access_token.clone();
        {
            let mut state = vault.lock().map_err(|e| e.to_string())?;
            let conn = state.connection.as_mut().ok_or("No vault open")?;
            persist_auth(&new_auth, conn)?;
        }
        return Ok(new_access);
    }

    Ok(auth.access_token)
}

#[tauri::command]
pub fn spotify_revoke(vault: State<AppVault>) -> Result<(), String> {
    let mut state = vault.lock().map_err(|e| e.to_string())?;
    let conn = state.connection.as_mut().ok_or("No vault open")?;
    diesel::delete(spotify_auth::table)
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_random_string_length() {
        assert_eq!(generate_random_string(64).len(), 64);
        assert_eq!(generate_random_string(43).len(), 43);
    }

    #[test]
    fn test_random_string_charset() {
        let s = generate_random_string(200);
        assert!(s.chars().all(|c| c.is_alphanumeric() || "-._~".contains(c)));
    }

    #[test]
    fn test_code_challenge_is_base64url() {
        let c = generate_code_challenge("test_verifier");
        assert!(!c.contains('+'), "must not contain +");
        assert!(!c.contains('/'), "must not contain /");
        assert!(!c.contains('='), "must not contain padding =");
    }

    #[test]
    fn test_code_challenge_deterministic() {
        assert_eq!(
            generate_code_challenge("abc"),
            generate_code_challenge("abc")
        );
    }

    #[test]
    fn test_code_challenge_differs_from_verifier() {
        let v = generate_random_string(64);
        assert_ne!(generate_code_challenge(&v), v);
    }

    #[test]
    fn test_code_challenge_rfc7636_vector() {
        // RFC 7636 Appendix B known test vector
        assert_eq!(
            generate_code_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
