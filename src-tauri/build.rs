fn main() {
    build_sqlite_recover();
    tauri_build::build()
}

/// SQLite's recover extension (`sqlite3_recover_*`), which salvages what it can of a
/// damaged ledger database before the GM is asked to rebuild one. It is not part of the
/// amalgamation libsqlite3-sys bundles, so the three source files are vendored at the
/// same SQLite version and linked against its symbols. See `vendor/sqlite-recover`.
fn build_sqlite_recover() {
    let dir = std::path::Path::new("vendor/sqlite-recover");
    // libsqlite3-sys declares `links = "sqlite3"`, which hands its header directory
    // to direct dependents' build scripts.
    let include = std::env::var("DEP_SQLITE3_INCLUDE")
        .expect("libsqlite3-sys should export its bundled sqlite3.h");
    cc::Build::new()
        .file(dir.join("sqlite3recover.c"))
        .file(dir.join("dbdata.c"))
        .include(dir)
        .include(include)
        // The extension's asserts guard its own invariants; reading a damaged file
        // must end in an error, never an abort.
        .define("NDEBUG", None)
        .warnings(false)
        .compile("sqlite_recover");
    println!("cargo:rerun-if-changed=vendor/sqlite-recover");
}
