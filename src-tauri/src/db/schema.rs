// @generated automatically by Diesel CLI.

diesel::table! {
    map_annotations (id) {
        id -> Integer,
        map_id -> Integer,
        kind -> Text,
        x -> Float,
        y -> Float,
        x2 -> Nullable<Float>,
        y2 -> Nullable<Float>,
        radius -> Nullable<Float>,
        label -> Nullable<Text>,
        color -> Text,
        stroke_color -> Text,
        stroke_width -> Integer,
        font_size -> Integer,
        opacity -> Float,
        created_at -> Text,
    }
}

diesel::table! {
    maps (id) {
        id -> Integer,
        title -> Text,
        image_path -> Nullable<Text>,
        image_width -> Nullable<Integer>,
        image_height -> Nullable<Integer>,
        created_at -> Text,
        modified_at -> Text,
    }
}

diesel::table! {
    notes (id) {
        id -> Integer,
        path -> Text,
        title -> Text,
        icon -> Nullable<Text>,
        cover_image -> Nullable<Text>,
        parent_path -> Nullable<Text>,
        archived -> Bool,
        modified_at -> Text,
    }
}

diesel::table! {
    pin_categories (id) {
        id -> Integer,
        map_id -> Nullable<Integer>,
        name -> Text,
        icon -> Text,
        color -> Text,
        shape -> Text,
    }
}

diesel::table! {
    pins (id) {
        id -> Integer,
        map_id -> Integer,
        x -> Float,
        y -> Float,
        title -> Text,
        description -> Nullable<Text>,
        category_id -> Nullable<Integer>,
        note_id -> Nullable<Integer>,
        created_at -> Text,
        shape -> Nullable<Text>,
        icon -> Nullable<Text>,
        color -> Nullable<Text>,
    }
}

diesel::table! {
    scene_slots (id) {
        id -> Integer,
        scene_id -> Integer,
        source -> Text,
        source_id -> Text,
        label -> Text,
        volume -> Float,
        is_loop -> Bool,
        slot_order -> Integer,
        shuffle -> Bool,
    }
}

diesel::table! {
    scenes (id) {
        id -> Integer,
        name -> Text,
        created_at -> Text,
        favorited -> Integer,
    }
}

diesel::table! {
    spotify_auth (id) {
        id -> Integer,
        access_token -> Text,
        refresh_token -> Text,
        expires_at -> Text,
    }
}

diesel::joinable!(map_annotations -> maps (map_id));
diesel::joinable!(pin_categories -> maps (map_id));
diesel::joinable!(pins -> maps (map_id));
diesel::joinable!(pins -> notes (note_id));
diesel::joinable!(pins -> pin_categories (category_id));
diesel::joinable!(scene_slots -> scenes (scene_id));

diesel::allow_tables_to_appear_in_same_query!(
    map_annotations,
    maps,
    notes,
    pin_categories,
    pins,
    scene_slots,
    scenes,
    spotify_auth,
);
