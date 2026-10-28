//! What the `[[` menu offers: the notes a GM could mean, best first (2026-10 design review).
//!
//! The menu used to borrow the palette's full-text search, which answers a different
//! question — *where does this word appear* — and so ranked by how often a word turned up in
//! note bodies. `[[ember` put "The War of Embers" above "The Ember Keep", `[[herb` put "Start
//! Here" above the note whose alias is "the Herbalist", and an empty `[[` answered nothing at
//! all. A link names a note; this ranks names.
//!
//! The ranking is a pure function over candidates, so it is tested without a ledger; the
//! command is the thin part that reads the candidates out of SQLite.

use crate::db::schema::note_aliases::dsl as na;
use crate::db::schema::notes::dsl as n;
use crate::db::schema::recent_entities::dsl as re;
use crate::ledger::{with_open_ledger, AppLedger};
use diesel::prelude::*;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

/// How many the menu is handed: about two menus' worth, so a long ledger still scrolls to
/// the one meant without the old silent cap of ten.
const LIMIT: usize = 20;

/// One note the menu can link to.
#[derive(Serialize, specta::Type, Debug, Clone, PartialEq)]
pub struct LinkTarget {
    pub id: i32,
    pub title: String,
    /// Ledger-relative, as the link is written.
    pub path: String,
    /// The folder it lives in, for telling two notes of one name apart. None at the root.
    pub folder: Option<String>,
    /// The alias the query matched, when it was an alias and not the title that answered.
    pub alias: Option<String>,
}

/// A note as the ranking sees it.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub id: i32,
    pub title: String,
    pub path: String,
    pub aliases: Vec<String>,
    /// Position in the recently-opened list (0 is the latest), or None.
    pub recent: Option<usize>,
    /// ISO timestamp of the last write, for the empty query's fallback order.
    pub modified_at: String,
}

fn folder_of(path: &str) -> Option<String> {
    path.rsplit_once('/').map(|(dir, _)| dir.to_string()).filter(|d| !d.is_empty())
}

fn words(s: &str) -> impl Iterator<Item = &str> {
    s.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty())
}

/// Whether `q`, a run of words, starts at a word boundary of `text` — "ember k" in "the
/// ember keep", but not "mber" in "ember".
fn word_prefix(text: &str, q: &str) -> bool {
    if text.starts_with(q) {
        return true;
    }
    text.char_indices().any(|(i, c)| {
        !c.is_alphanumeric() && text[i + c.len_utf8()..].starts_with(q)
    })
}

/// Levenshtein distance, bounded: anything over `max` answers `max + 1`.
fn distance(a: &str, b: &str, max: usize) -> usize {
    let a: Vec<char> = a.chars().collect();
    let b: Vec<char> = b.chars().collect();
    if a.len().abs_diff(b.len()) > max {
        return max + 1;
    }
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut row = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() {
            let cost = usize::from(ca != cb);
            row[j + 1] = (prev[j] + cost).min(prev[j + 1] + 1).min(row[j] + 1);
        }
        prev = row;
    }
    prev[b.len()].min(max + 1)
}

/// Whether every word of the query is within a typo of some word of the title — the last
/// word as a prefix, since it is still being typed. "thornhavn" finds "Thornhaven".
///
/// Only words of five letters or more are forgiven a typo: four-letter words sit one letter
/// apart from too many others, and `herb` answered with "Start Here".
fn near_miss(title: &str, q: &str) -> bool {
    let title_words: Vec<&str> = words(title).collect();
    let query_words: Vec<&str> = words(q).collect();
    if query_words.is_empty() {
        return false;
    }
    let last = query_words.len() - 1;
    query_words.iter().enumerate().all(|(i, qw)| {
        let max = if qw.chars().count() >= 8 { 2 } else { 1 };
        if qw.chars().count() < 5 {
            return title_words.iter().any(|tw| tw.starts_with(qw));
        }
        title_words.iter().any(|tw| {
            let candidate = if i == last && tw.chars().count() > qw.chars().count() {
                tw.chars().take(qw.chars().count()).collect::<String>()
            } else {
                tw.to_string()
            };
            distance(&candidate, qw, max) <= max
        })
    })
}

/// How well one note answers — lower is better, None not at all — and the alias that did.
///
/// Titles first, as a GM names a note: exact, then from its start, then from the start of
/// a word in it. Then the same for its aliases. Then a word anywhere in it, then a typo's
/// distance. Never the body: a link menu is asked *which note*, not *where is this word*.
fn tier(c: &Candidate, q: &str) -> Option<(u8, Option<String>)> {
    let title = c.title.to_lowercase();
    if title == q {
        return Some((0, None));
    }
    if title.starts_with(q) {
        return Some((1, None));
    }
    if word_prefix(&title, q) {
        return Some((2, None));
    }
    for alias in &c.aliases {
        let lower = alias.to_lowercase();
        if lower == q {
            return Some((0, Some(alias.clone())));
        }
        if word_prefix(&lower, q) {
            return Some((3, Some(alias.clone())));
        }
    }
    if title.contains(q) {
        return Some((4, None));
    }
    if near_miss(&title, q) {
        return Some((5, None));
    }
    None
}

/// The targets a query offers, best first.
///
/// * **Nothing typed** — the notes opened most recently, then the most recently written.
/// * **A name** — ranked by `tier`. Ties go to the more recently opened note, then the
///   alphabet, so the same query always answers in the same order.
/// * **`folder/name`** — the notes in a folder whose path holds the part before the last
///   `/`, ranked by the part after it. `locations/emb` finds The Ember Keep.
///
/// `exclude` is the note being written in: a note linking to itself is never what the GM
/// was reaching for.
pub fn rank_link_targets(candidates: &[Candidate], query: &str, exclude: Option<&str>) -> Vec<LinkTarget> {
    let q = query.trim().to_lowercase();
    let pool = candidates.iter().filter(|c| Some(c.path.as_str()) != exclude);

    let target = |c: &Candidate, alias: Option<String>| LinkTarget {
        id: c.id,
        title: c.title.clone(),
        path: c.path.clone(),
        folder: folder_of(&c.path),
        alias,
    };

    if q.is_empty() {
        let mut recent: Vec<&Candidate> = pool.collect();
        recent.sort_by(|a, b| match (a.recent, b.recent) {
            (Some(x), Some(y)) => x.cmp(&y),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.modified_at.cmp(&a.modified_at),
        });
        return recent.into_iter().take(LIMIT).map(|c| target(c, None)).collect();
    }

    let (folder_q, name_q) = match q.rsplit_once('/') {
        Some((dir, name)) => (Some(dir.trim().to_string()), name.trim().to_string()),
        None => (None, q.clone()),
    };

    let mut ranked: Vec<(u8, Option<usize>, String, &Candidate, Option<String>)> = pool
        .filter(|c| match &folder_q {
            Some(dir) => folder_of(&c.path).is_some_and(|f| f.to_lowercase().contains(dir.as_str())),
            None => true,
        })
        .filter_map(|c| {
            if name_q.is_empty() {
                return Some((1, c.recent, c.title.to_lowercase(), c, None));
            }
            tier(c, &name_q).map(|(t, alias)| (t, c.recent, c.title.to_lowercase(), c, alias))
        })
        .collect();

    ranked.sort_by(|a, b| {
        a.0.cmp(&b.0)
            .then(match (a.1, b.1) {
                (Some(x), Some(y)) => x.cmp(&y),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => std::cmp::Ordering::Equal,
            })
            .then(a.2.cmp(&b.2))
    });

    ranked.into_iter().take(LIMIT).map(|(_, _, _, c, alias)| target(c, alias)).collect()
}

/// Every note with its aliases and recency, read once per query. A ledger's notes run to the
/// hundreds; reading their titles is cheaper than the excerpt-per-result the full-text
/// search used to build for a menu that threw the excerpts away.
fn load_candidates(conn: &mut SqliteConnection) -> Result<Vec<Candidate>, String> {
    let rows: Vec<(i32, String, String, String)> = n::notes
        .select((n::id, n::title, n::path, n::modified_at))
        .load(conn)
        .map_err(|e| e.to_string())?;

    let mut aliases: HashMap<i32, Vec<String>> = HashMap::new();
    for (note_id, alias) in na::note_aliases
        .select((na::note_id, na::alias))
        .load::<(i32, String)>(conn)
        .map_err(|e| e.to_string())?
    {
        aliases.entry(note_id).or_default().push(alias);
    }

    let recent: HashMap<i32, usize> = re::recent_entities
        .filter(re::entity_kind.eq("note"))
        .order(re::accessed_at.desc())
        .select(re::entity_id)
        .load::<i32>(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .enumerate()
        .map(|(i, id)| (id, i))
        .collect();

    Ok(rows
        .into_iter()
        .map(|(id, title, path, modified_at)| Candidate {
            aliases: aliases.remove(&id).unwrap_or_default(),
            recent: recent.get(&id).copied(),
            id,
            title,
            path,
            modified_at,
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn search_link_targets(
    query: String,
    exclude_path: Option<String>,
    ledger: State<AppLedger>,
) -> Result<Vec<LinkTarget>, String> {
    with_open_ledger(&ledger, |l| {
        let candidates = load_candidates(l.conn)?;
        Ok(rank_link_targets(&candidates, &query, exclude_path.as_deref()))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note(id: i32, title: &str, path: &str, aliases: &[&str]) -> Candidate {
        Candidate {
            id,
            title: title.into(),
            path: path.into(),
            aliases: aliases.iter().map(|a| a.to_string()).collect(),
            recent: None,
            modified_at: format!("2026-01-{:02}T00:00:00Z", id),
        }
    }

    fn sample() -> Vec<Candidate> {
        vec![
            note(1, "The War of Embers", "Lore/The War of Embers.md", &[]),
            note(2, "The Ember Keep", "Locations/The Ember Keep.md", &[]),
            note(3, "Mira Ashvale", "Characters/Mira Ashvale.md", &["the Herbalist"]),
            note(4, "Start Here", "Start Here.md", &[]),
            note(5, "Thornhaven Village", "Locations/Thornhaven Village.md", &[]),
            note(6, "Brannoc", "Characters/Brannoc.md", &["Old Brannoc", "The Smith"]),
        ]
    }

    fn titles(results: &[LinkTarget]) -> Vec<&str> {
        results.iter().map(|r| r.title.as_str()).collect()
    }

    #[test]
    fn a_name_typed_from_its_start_comes_first() {
        // "The War of Embers" holds "ember" too, but "Ember Keep" is a word started.
        let r = rank_link_targets(&sample(), "ember", None);
        assert_eq!(titles(&r)[..2], ["The Ember Keep", "The War of Embers"]);
    }

    #[test]
    fn takes_a_space() {
        let r = rank_link_targets(&sample(), "ember k", None);
        assert_eq!(titles(&r), ["The Ember Keep"]);
    }

    #[test]
    fn finds_a_note_by_any_word_of_its_alias_and_says_which() {
        let r = rank_link_targets(&sample(), "herb", None);
        assert_eq!(r[0].title, "Mira Ashvale");
        assert_eq!(r[0].alias.as_deref(), Some("the Herbalist"));

        let smith = rank_link_targets(&sample(), "smith", None);
        assert_eq!(smith[0].title, "Brannoc");
    }

    #[test]
    fn never_ranks_by_body_text() {
        // "here" is in no title but Start Here's.
        let r = rank_link_targets(&sample(), "here", None);
        assert_eq!(titles(&r), ["Start Here"]);
    }

    #[test]
    fn forgives_a_typo() {
        let r = rank_link_targets(&sample(), "thornhavn", None);
        assert_eq!(r[0].title, "Thornhaven Village");
    }

    #[test]
    fn forgives_no_typo_in_a_short_word() {
        // "herb" is one letter from "here".
        let r = rank_link_targets(&sample(), "herb", None);
        assert_eq!(titles(&r), ["Mira Ashvale"]);
    }

    #[test]
    fn narrows_to_a_folder() {
        let r = rank_link_targets(&sample(), "locations/emb", None);
        assert_eq!(titles(&r), ["The Ember Keep"]);
        let all = rank_link_targets(&sample(), "characters/", None);
        assert_eq!(titles(&all), ["Brannoc", "Mira Ashvale"]);
    }

    #[test]
    fn says_where_a_note_lives() {
        let r = rank_link_targets(&sample(), "start", None);
        assert_eq!(r[0].folder, None);
        let k = rank_link_targets(&sample(), "keep", None);
        assert_eq!(k[0].folder.as_deref(), Some("Locations"));
    }

    #[test]
    fn offers_recent_notes_for_nothing_typed_and_leaves_out_the_note_being_written() {
        let mut notes = sample();
        notes[4].recent = Some(0); // Thornhaven, opened last
        notes[2].recent = Some(1); // Mira
        let r = rank_link_targets(&notes, "", Some("Characters/Mira Ashvale.md"));
        assert_eq!(r[0].title, "Thornhaven Village");
        assert!(!titles(&r).contains(&"Mira Ashvale"));
        // Then the most recently written: Brannoc (06) before Start Here (04).
        assert_eq!(r[1].title, "Brannoc");
    }

    #[test]
    fn breaks_ties_the_same_way_every_time() {
        let a = rank_link_targets(&sample(), "the", None);
        let b = rank_link_targets(&sample(), "the", None);
        assert_eq!(a, b);
    }
}
