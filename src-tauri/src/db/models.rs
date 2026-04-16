use super::schema::notes;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(
    Queryable, Selectable, Serialize, Deserialize, Debug, Clone, AsChangeset, Identifiable,
)]
#[diesel(table_name = notes)]
pub struct Note {
    pub id: i32,
    pub path: String,
    pub title: String,
    pub icon: Option<String>,
    pub cover_image: Option<String>,
    pub parent_path: Option<String>,
    pub archived: i32,
    pub modified_at: String,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = notes)]
pub struct NewNote<'a> {
    pub path: &'a str,
    pub title: &'a str,
    pub parent_path: Option<&'a str>,
}

use super::schema::{maps, pin_categories, pins, scene_slots, scenes, spotify_auth};

// ── Map ──────────────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Deserialize, Debug, Clone, AsChangeset, Identifiable)]
#[diesel(table_name = maps)]
pub struct Map {
    pub id: i32,
    pub title: String,
    pub image_path: Option<String>,
    pub image_width: Option<i32>,
    pub image_height: Option<i32>,
    pub created_at: String,
    pub modified_at: String,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = maps)]
pub struct NewMap<'a> {
    pub title: &'a str,
    pub image_path: Option<&'a str>,
    pub image_width: Option<i32>,
    pub image_height: Option<i32>,
}

#[derive(AsChangeset, Debug)]
#[diesel(table_name = maps)]
pub struct AssignImageChangeset<'a> {
    pub image_path: Option<&'a str>,
    pub image_width: Option<i32>,
    pub image_height: Option<i32>,
    pub modified_at: &'a str,
}

// ── PinCategory ───────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Deserialize, Debug, Clone, AsChangeset, Identifiable)]
#[diesel(table_name = pin_categories)]
pub struct PinCategory {
    pub id: i32,
    pub map_id: Option<i32>,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub shape: String,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = pin_categories)]
pub struct NewPinCategory<'a> {
    pub map_id: Option<i32>,
    pub name: &'a str,
    pub icon: &'a str,
    pub color: &'a str,
}

// ── Pin ───────────────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Deserialize, Debug, Clone, AsChangeset, Identifiable)]
#[diesel(table_name = pins, treat_none_as_null = true)]
pub struct Pin {
    pub id: i32,
    pub map_id: i32,
    pub x: f32,
    pub y: f32,
    pub title: String,
    pub description: Option<String>,
    pub category_id: Option<i32>,
    pub note_id: Option<i32>,
    pub created_at: String,
    pub shape: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = pins)]
pub struct NewPin<'a> {
    pub map_id: i32,
    pub x: f32,
    pub y: f32,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub category_id: Option<i32>,
    pub note_id: Option<i32>,
    // shape, icon, color omitted — they default to NULL at creation
}

// ── Scene ─────────────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Deserialize, Debug, Clone, Identifiable)]
#[diesel(table_name = scenes)]
pub struct Scene {
    pub id: i32,
    pub name: String,
    pub created_at: String,
    pub favorited: i32,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = scenes)]
pub struct NewScene {
    pub name: String,
}

#[derive(AsChangeset, Debug)]
#[diesel(table_name = scenes)]
pub struct UpdateScene {
    pub name: String,
}

use diesel::sql_types::{BigInt, Integer, Text};

#[derive(QueryableByName, Serialize, Deserialize, Debug)]
pub struct SceneWithCount {
    #[diesel(sql_type = Integer)]
    pub id: i32,
    #[diesel(sql_type = Text)]
    pub name: String,
    #[diesel(sql_type = Integer)]
    pub favorited: i32,
    #[diesel(sql_type = Text)]
    pub created_at: String,
    #[diesel(sql_type = BigInt)]
    pub slot_count: i64,
}

// ── SceneSlot ─────────────────────────────────────────────────────────────────

#[derive(Queryable, Selectable, Serialize, Deserialize, Debug, Clone, Identifiable)]
#[diesel(table_name = scene_slots)]
pub struct SceneSlot {
    pub id: i32,
    pub scene_id: i32,
    pub source: String,
    pub source_id: String,
    pub label: String,
    pub volume: f32,
    #[serde(rename = "loop")]
    pub is_loop: i32,
    pub slot_order: i32,
    pub shuffle: i32,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = scene_slots)]
pub struct NewSceneSlot {
    pub scene_id: i32,
    pub source: String,
    pub source_id: String,
    pub label: String,
    pub volume: f32,
    pub is_loop: i32,
    pub slot_order: i32,
    pub shuffle: i32,
}

#[derive(AsChangeset, Debug)]
#[diesel(table_name = scene_slots)]
pub struct UpdateSceneSlot {
    pub label: String,
    pub volume: f32,
    pub is_loop: i32,
    pub slot_order: i32,
    pub shuffle: i32,
}

// ── SpotifyAuth ───────────────────────────────────────────────────────────────
// Does NOT derive Serialize — raw tokens are never sent to the frontend.

#[derive(Queryable, Selectable, Debug)]
#[diesel(table_name = spotify_auth)]
pub struct SpotifyAuth {
    pub id: i32,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = spotify_auth)]
pub struct NewSpotifyAuth {
    pub id: i32,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: String,
}

// ── SpotifyAuthStatus ─────────────────────────────────────────────────────────
// Token-free struct returned to frontend. Safe to serialize.

#[derive(Serialize, Debug)]
pub struct SpotifyAuthStatus {
    pub is_connected: bool,
    pub expires_at: String,
}
