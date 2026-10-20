// Per-tag graph styles: an explicit colour, a hidden flag, and the ramp step a
// tag wears when it has no colour of its own.
//
// The step is PINNED ONCE GIVEN. It used to be derived on every read from the
// ledger's sorted tag list, so adding "bandit" handed every tag after it a new
// colour, and a GM who had learnt that NPCs were gold found them teal. Now a tag
// keeps its step for as long as it is in use; a new tag takes the lowest free one.
// The first read after upgrading assigns steps in alphabetical order, which is
// what the old rule was drawing — so nobody's graph changes colour on the way in.

use crate::db::schema::note_tags::dsl as nt;
use crate::db::schema::pin_tags::dsl as pt;
use crate::db::schema::tag_graph_styles::dsl as gs;
use crate::ledger::{with_open_ledger, AppLedger};
use diesel::prelude::*;
use diesel::SqliteConnection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use tauri::State;

/// How many ramp steps there are (`--viz-cat-1` … `--viz-cat-8`). Past this a tag
/// has no step and draws muted — see `graph-palette.ts`.
pub const VIZ_SLOTS: i32 = 8;

#[derive(Serialize, specta::Type, Debug, Clone)]
pub struct TagGraphStyleResponse {
    pub color: Option<String>,
    pub hidden: bool,
    /// The ramp step, 0-based; `None` past the eighth tag.
    pub slot: Option<i32>,
}

/// One `tag_graph_styles` row, whole — what a retag's Undo puts back.
#[derive(Serialize, Deserialize, specta::Type, Debug, Clone, PartialEq)]
pub struct TagStyleRow {
    pub tag: String,
    pub color: Option<String>,
    pub hidden: bool,
    pub slot: Option<i32>,
}

#[tauri::command]
#[specta::specta]
pub fn get_tag_graph_styles(
    ledger: State<AppLedger>,
) -> Result<HashMap<String, TagGraphStyleResponse>, String> {
    with_open_ledger(&ledger, |l| get_tag_graph_styles_from_conn(l.conn))
}

pub fn get_tag_graph_styles_from_conn(
    conn: &mut SqliteConnection,
) -> Result<HashMap<String, TagGraphStyleResponse>, String> {
    conn.transaction(|c| {
        ensure_tag_slots(c)?;
        load_style_rows(c)
    })
    .map(|rows| {
        rows.into_iter()
            .map(|r| {
                (
                    r.tag,
                    TagGraphStyleResponse {
                        color: r.color,
                        hidden: r.hidden,
                        slot: r.slot,
                    },
                )
            })
            .collect()
    })
    .map_err(|e: diesel::result::Error| e.to_string())
}

pub fn load_style_rows(c: &mut SqliteConnection) -> QueryResult<Vec<TagStyleRow>> {
    let rows: Vec<(String, Option<String>, i32, Option<i32>)> = gs::tag_graph_styles
        .select((gs::tag, gs::color, gs::hidden, gs::slot))
        .load(c)?;
    Ok(rows
        .into_iter()
        .map(|(tag, color, hidden, slot)| TagStyleRow {
            tag,
            color,
            hidden: hidden != 0,
            slot,
        })
        .collect())
}

/// Give every tag in use that has no colour of its own a ramp step, if it has
/// none yet and one is free. Tags are visited in the Tag Manager's order (by
/// lowercase name), so on an upgraded ledger the steps fall where the old
/// alphabetical rule put them.
///
/// A step is taken while a tag *in use* holds it — explicit colour or not, so
/// switching a tag back to Automatic gives it its own colour back. A tag no
/// longer in use keeps its row (and the step comes back if the tag does), but
/// gives the step up the moment a new tag needs it.
fn ensure_tag_slots(c: &mut SqliteConnection) -> QueryResult<()> {
    let mut in_use: Vec<String> = nt::note_tags.select(nt::tag).load(c)?;
    in_use.extend(pt::pin_tags.select(pt::tag).load::<String>(c)?);
    in_use.sort_by_key(|t| t.to_lowercase());
    in_use.dedup_by(|a, b| a.to_lowercase() == b.to_lowercase());

    let rows = load_style_rows(c)?;
    let row_for = |tag: &str| {
        rows.iter()
            .find(|r| r.tag.to_lowercase() == tag.to_lowercase())
    };

    let mut taken: BTreeSet<i32> = in_use
        .iter()
        .filter_map(|t| row_for(t).and_then(|r| r.slot))
        .collect();

    for tag in &in_use {
        let row = row_for(tag);
        if row.is_some_and(|r| r.color.is_some() || r.slot.is_some()) {
            continue;
        }
        let Some(free) = (0..VIZ_SLOTS).find(|s| !taken.contains(s)) else {
            break;
        };
        taken.insert(free);
        diesel::update(gs::tag_graph_styles.filter(gs::slot.eq(free)))
            .set(gs::slot.eq(None::<i32>))
            .execute(c)?;
        match row {
            Some(r) => {
                diesel::update(gs::tag_graph_styles.filter(gs::tag.eq(&r.tag)))
                    .set(gs::slot.eq(free))
                    .execute(c)?;
            }
            None => {
                diesel::insert_into(gs::tag_graph_styles)
                    .values((gs::tag.eq(tag), gs::hidden.eq(0), gs::slot.eq(free)))
                    .execute(c)?;
            }
        }
    }
    Ok(())
}

/// Put rows back exactly as they were, after deleting every row for `tags`
/// (case-insensitively). A restored step is taken back from whoever was given it
/// in the meantime; they get a free one on the next read.
pub fn restore_style_rows(
    c: &mut SqliteConnection,
    tags: &[&str],
    rows: &[TagStyleRow],
) -> QueryResult<()> {
    let lower: BTreeSet<String> = tags.iter().map(|t| t.to_lowercase()).collect();
    for r in load_style_rows(c)? {
        if lower.contains(&r.tag.to_lowercase()) {
            diesel::delete(gs::tag_graph_styles.filter(gs::tag.eq(&r.tag))).execute(c)?;
        }
    }
    for r in rows {
        if let Some(slot) = r.slot {
            diesel::update(gs::tag_graph_styles.filter(gs::slot.eq(slot)))
                .set(gs::slot.eq(None::<i32>))
                .execute(c)?;
        }
        diesel::insert_into(gs::tag_graph_styles)
            .values((
                gs::tag.eq(&r.tag),
                gs::color.eq(&r.color),
                gs::hidden.eq(i32::from(r.hidden)),
                gs::slot.eq(r.slot),
            ))
            .execute(c)?;
    }
    Ok(())
}

/// Carry a tag's style through a retag, in the retag's own terms:
/// - **rename** — the row moves to the new name, colour and step with it;
/// - **merge** (the target is already a tag) — the target keeps its own row and
///   the source's goes, freeing its step;
/// - **delete** — the row goes.
pub fn carry_style_through_retag(
    c: &mut SqliteConnection,
    from: &str,
    to: Option<&str>,
    is_merge: bool,
) -> QueryResult<()> {
    let from_lower = from.to_lowercase();
    let rows = load_style_rows(c)?;
    let source: Vec<&TagStyleRow> = rows
        .iter()
        .filter(|r| r.tag.to_lowercase() == from_lower)
        .collect();
    for r in &source {
        diesel::delete(gs::tag_graph_styles.filter(gs::tag.eq(&r.tag))).execute(c)?;
    }
    let (Some(to), false) = (to, is_merge) else {
        return Ok(());
    };
    let Some(moved) = source.first() else {
        return Ok(());
    };
    // A leftover row under the new name (a tag that was once in use) gives way to
    // the one being renamed — that is the tag the GM has been looking at.
    let to_lower = to.to_lowercase();
    for r in rows
        .iter()
        .filter(|r| r.tag.to_lowercase() == to_lower && r.tag.to_lowercase() != from_lower)
    {
        diesel::delete(gs::tag_graph_styles.filter(gs::tag.eq(&r.tag))).execute(c)?;
    }
    diesel::insert_into(gs::tag_graph_styles)
        .values((
            gs::tag.eq(to),
            gs::color.eq(&moved.color),
            gs::hidden.eq(i32::from(moved.hidden)),
            gs::slot.eq(moved.slot),
        ))
        .execute(c)?;
    Ok(())
}

/// A tag's explicit colour; `None` is Automatic (its ramp step). Touches only the
/// colour — the hidden flag and the step stay as they are.
#[tauri::command]
#[specta::specta]
pub fn set_tag_graph_color(
    tag: String,
    color: Option<String>,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    with_open_ledger(&ledger, |l| {
        set_tag_graph_color_on_conn(l.conn, &tag, color.as_deref())
    })
}

pub fn set_tag_graph_color_on_conn(
    conn: &mut SqliteConnection,
    tag: &str,
    color: Option<&str>,
) -> Result<(), String> {
    diesel::insert_into(gs::tag_graph_styles)
        .values((gs::tag.eq(tag), gs::color.eq(color), gs::hidden.eq(0)))
        .on_conflict(gs::tag)
        .do_update()
        .set(gs::color.eq(color))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Whether a tag's notes are hidden from the graph ("" is the untagged notes).
/// Touches only the flag — two surfaces write it, and neither may carry a stale
/// colour along with it.
#[tauri::command]
#[specta::specta]
pub fn set_tag_graph_hidden(
    tag: String,
    hidden: bool,
    ledger: State<AppLedger>,
) -> Result<(), String> {
    with_open_ledger(&ledger, |l| {
        set_tag_graph_hidden_on_conn(l.conn, &tag, hidden)
    })
}

pub fn set_tag_graph_hidden_on_conn(
    conn: &mut SqliteConnection,
    tag: &str,
    hidden: bool,
) -> Result<(), String> {
    let hidden = i32::from(hidden);
    diesel::insert_into(gs::tag_graph_styles)
        .values((gs::tag.eq(tag), gs::hidden.eq(hidden)))
        .on_conflict(gs::tag)
        .do_update()
        .set(gs::hidden.eq(hidden))
        .execute(conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::connection::SimpleConnection;
    use diesel::Connection;

    fn test_conn() -> SqliteConnection {
        let mut conn =
            SqliteConnection::establish(":memory:").expect("failed to open in-memory db");
        conn.batch_execute(
            "CREATE TABLE tag_graph_styles (
                tag    TEXT    NOT NULL PRIMARY KEY,
                color  TEXT,
                hidden INTEGER NOT NULL DEFAULT 0,
                slot   INTEGER
            );
            CREATE TABLE note_tags (
                note_path TEXT NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (note_path, tag)
            );
            CREATE TABLE pin_tags (
                pin_id INTEGER NOT NULL,
                tag TEXT NOT NULL,
                PRIMARY KEY (pin_id, tag)
            );",
        )
        .expect("create table");
        conn
    }

    fn tag_notes(conn: &mut SqliteConnection, tags: &[&str]) {
        for (i, t) in tags.iter().enumerate() {
            diesel::insert_into(nt::note_tags)
                .values((nt::note_path.eq(format!("n{i}-{t}.md")), nt::tag.eq(*t)))
                .execute(conn)
                .unwrap();
        }
    }

    fn slots(conn: &mut SqliteConnection) -> HashMap<String, Option<i32>> {
        get_tag_graph_styles_from_conn(conn)
            .unwrap()
            .into_iter()
            .map(|(t, s)| (t, s.slot))
            .collect()
    }

    #[test]
    fn get_returns_empty_map_when_no_rows() {
        let mut conn = test_conn();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn set_color_inserts_a_new_row() {
        let mut conn = test_conn();
        set_tag_graph_color_on_conn(&mut conn, "npc", Some("#ff0000")).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        let style = result.get("npc").expect("npc not found");
        assert_eq!(style.color.as_deref(), Some("#ff0000"));
        assert!(!style.hidden);
    }

    #[test]
    fn clearing_color_resets_to_null() {
        let mut conn = test_conn();
        set_tag_graph_color_on_conn(&mut conn, "ally", Some("#00ff00")).unwrap();
        set_tag_graph_color_on_conn(&mut conn, "ally", None).unwrap();
        let result = get_tag_graph_styles_from_conn(&mut conn).unwrap();
        assert!(
            result["ally"].color.is_none(),
            "color should be None after clear"
        );
    }

    #[test]
    fn hidden_flag_roundtrips_correctly() {
        let mut conn = test_conn();
        set_tag_graph_hidden_on_conn(&mut conn, "secret", true).unwrap();
        assert!(get_tag_graph_styles_from_conn(&mut conn).unwrap()["secret"].hidden);
        set_tag_graph_hidden_on_conn(&mut conn, "secret", false).unwrap();
        assert!(!get_tag_graph_styles_from_conn(&mut conn).unwrap()["secret"].hidden);
    }

    #[test]
    fn hiding_leaves_the_colour_alone_and_colouring_leaves_hidden_alone() {
        // The graph's filter used to write back the colour it had loaded at mount,
        // undoing a colour the Tag Manager had set since.
        let mut conn = test_conn();
        set_tag_graph_color_on_conn(&mut conn, "fire", Some("#ff4400")).unwrap();
        set_tag_graph_hidden_on_conn(&mut conn, "fire", true).unwrap();
        set_tag_graph_color_on_conn(&mut conn, "fire", Some("#00aaff")).unwrap();
        let style = &get_tag_graph_styles_from_conn(&mut conn).unwrap()["fire"];
        assert_eq!(style.color.as_deref(), Some("#00aaff"));
        assert!(style.hidden);
    }

    #[test]
    fn the_first_read_assigns_steps_alphabetically_skipping_explicit_colours() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["npc", "Ally", "city", "beast"]);
        set_tag_graph_color_on_conn(&mut conn, "beast", Some("#123456")).unwrap();
        let s = slots(&mut conn);
        assert_eq!(s["Ally"], Some(0));
        assert_eq!(s["beast"], None);
        assert_eq!(s["city"], Some(1));
        assert_eq!(s["npc"], Some(2));
    }

    #[test]
    fn a_new_tag_takes_a_free_step_and_moves_nobody() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["city", "npc"]);
        let before = slots(&mut conn);
        tag_notes(&mut conn, &["ally"]);
        let after = slots(&mut conn);
        assert_eq!(after["city"], before["city"]);
        assert_eq!(after["npc"], before["npc"]);
        assert_eq!(after["ally"], Some(2));
    }

    #[test]
    fn back_to_automatic_gives_a_tag_its_own_step_back() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["city", "npc"]);
        let first = slots(&mut conn)["npc"];
        set_tag_graph_color_on_conn(&mut conn, "npc", Some("#abcdef")).unwrap();
        tag_notes(&mut conn, &["zone"]);
        slots(&mut conn);
        set_tag_graph_color_on_conn(&mut conn, "npc", None).unwrap();
        let s = slots(&mut conn);
        assert_eq!(s["npc"], first);
        assert_ne!(s["zone"], first);
    }

    #[test]
    fn a_ninth_tag_has_no_step() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
        let s = slots(&mut conn);
        assert_eq!(s["h"], Some(7));
        assert_eq!(s.get("i").copied().flatten(), None);
    }

    #[test]
    fn a_tag_no_longer_in_use_gives_its_step_up_when_one_is_needed() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["a", "b", "c", "d", "e", "f", "g", "h"]);
        slots(&mut conn);
        diesel::delete(nt::note_tags.filter(nt::tag.eq("c")))
            .execute(&mut conn)
            .unwrap();
        tag_notes(&mut conn, &["z"]);
        let s = slots(&mut conn);
        assert_eq!(s["z"], Some(2));
        assert_eq!(s["c"], None);
    }

    #[test]
    fn untagged_hidden_flag_never_takes_a_step() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["npc"]);
        set_tag_graph_hidden_on_conn(&mut conn, "", true).unwrap();
        let s = slots(&mut conn);
        assert_eq!(s[""], None);
        assert_eq!(s["npc"], Some(0));
    }

    #[test]
    fn rename_carries_colour_step_and_hidden_to_the_new_name() {
        let mut conn = test_conn();
        tag_notes(&mut conn, &["city", "npc"]);
        slots(&mut conn);
        set_tag_graph_hidden_on_conn(&mut conn, "npc", true).unwrap();
        carry_style_through_retag(&mut conn, "npc", Some("person"), false).unwrap();
        let rows = load_style_rows(&mut conn).unwrap();
        let moved = rows.iter().find(|r| r.tag == "person").unwrap();
        assert_eq!(moved.slot, Some(1));
        assert!(moved.hidden);
        assert!(!rows.iter().any(|r| r.tag == "npc"));
    }

    #[test]
    fn merge_keeps_the_targets_style_and_drops_the_source() {
        let mut conn = test_conn();
        set_tag_graph_color_on_conn(&mut conn, "npc", Some("#111111")).unwrap();
        set_tag_graph_color_on_conn(&mut conn, "person", Some("#222222")).unwrap();
        carry_style_through_retag(&mut conn, "npc", Some("person"), true).unwrap();
        let rows = load_style_rows(&mut conn).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].color.as_deref(), Some("#222222"));
    }

    #[test]
    fn delete_drops_the_row() {
        let mut conn = test_conn();
        set_tag_graph_color_on_conn(&mut conn, "NPC", Some("#111111")).unwrap();
        carry_style_through_retag(&mut conn, "npc", None, false).unwrap();
        assert!(load_style_rows(&mut conn).unwrap().is_empty());
    }

    #[test]
    fn restore_puts_rows_back_and_takes_the_step_back() {
        let mut conn = test_conn();
        let before = vec![TagStyleRow {
            tag: "npc".into(),
            color: None,
            hidden: true,
            slot: Some(3),
        }];
        // "zone" was given step 3 while "npc" was gone; npc takes it back.
        set_tag_graph_color_on_conn(&mut conn, "zone", None).unwrap();
        diesel::update(gs::tag_graph_styles.filter(gs::tag.eq("zone")))
            .set(gs::slot.eq(3))
            .execute(&mut conn)
            .unwrap();
        restore_style_rows(&mut conn, &["npc", "person"], &before).unwrap();
        let rows = load_style_rows(&mut conn).unwrap();
        assert_eq!(rows.iter().find(|r| r.tag == "npc"), Some(&before[0]));
        assert_eq!(rows.iter().find(|r| r.tag == "zone").unwrap().slot, None);
    }
}
