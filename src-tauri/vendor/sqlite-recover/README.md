# SQLite recover extension

`sqlite3recover.c`, `sqlite3recover.h` and `dbdata.c`, unmodified from SQLite's own source
tree at **version-3.45.0** — the version libsqlite3-sys 0.28 bundles. Public domain, like
the rest of SQLite.

```
https://sqlite.org/src/raw?filename=ext/recover/<file>&ci=version-3.45.0
```

| File               | SHA-256                                                            |
| ------------------ | ------------------------------------------------------------------ |
| `sqlite3recover.c` | `a1a09c56d2630e032373015b7cf7846ed153d3bc79ed1e39c61e20f4eb2b86ba` |
| `sqlite3recover.h` | `c088088d15af055304e931842f7c197024d46ff1b7077912ec42149e9fa4f9bb` |
| `dbdata.c`         | `1a33fc4e58cf8a63c2ad2da8198098d7c1ad3294eb96079a9820c75e16bc608a` |

`build.rs` compiles them against the bundled `sqlite3.h`; `src/db/recover.rs` is the only
caller. They read the damaged file through the `sqlite_dbpage` virtual table, which the
bundled SQLite only has because `.cargo/config.toml` sets `SQLITE_ENABLE_DBPAGE_VTAB`.

**When libsqlite3-sys is upgraded**, replace these three files with the ones tagged at its
new bundled SQLite version (`#define SQLITE_VERSION` in its `sqlite3/sqlite3.c`) and update
the table above.
