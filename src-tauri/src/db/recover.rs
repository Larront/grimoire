//! SQLite's own recovery (the `sqlite3_recover_*` API, vendored in
//! `vendor/sqlite-recover` and built by `build.rs`): copy every row SQLite can still
//! read out of a damaged database into a new one. Rows on pages that are unreadable are
//! lost; everything else keeps its rowid, so references between tables still line up.

use libsqlite3_sys as ffi;
use std::ffi::{c_char, c_int, CStr, CString};
use std::path::Path;
use std::ptr;

#[repr(C)]
struct Sqlite3Recover {
    _private: [u8; 0],
}

unsafe extern "C" {
    fn sqlite3_recover_init(
        db: *mut ffi::sqlite3,
        z_db: *const c_char,
        z_uri: *const c_char,
    ) -> *mut Sqlite3Recover;
    fn sqlite3_recover_run(p: *mut Sqlite3Recover) -> c_int;
    fn sqlite3_recover_errmsg(p: *mut Sqlite3Recover) -> *const c_char;
    fn sqlite3_recover_finish(p: *mut Sqlite3Recover) -> c_int;
}

/// Whether the bundled SQLite has the `sqlite_dbpage` table the extension reads pages
/// through (`.cargo/config.toml` turns it on). Without it every recovery fails.
pub fn available() -> bool {
    unsafe { ffi::sqlite3_compileoption_used(c"ENABLE_DBPAGE_VTAB".as_ptr()) == 1 }
}

/// Closes the damaged database's handle however recovery ends.
struct Handle(*mut ffi::sqlite3);

impl Drop for Handle {
    fn drop(&mut self) {
        unsafe { ffi::sqlite3_close(self.0) };
    }
}

fn c_path(path: &Path) -> Result<CString, String> {
    let s = path.to_str().ok_or("Invalid database path.")?;
    CString::new(s).map_err(|e| e.to_string())
}

/// Recover what can be read of `damaged` into a new database at `out`. The damaged file
/// is opened read-only and left exactly as it was. `out` should not exist yet.
pub fn recover_into(damaged: &Path, out: &Path) -> Result<(), String> {
    if !available() {
        return Err("this build of SQLite has no sqlite_dbpage table".to_string());
    }
    let damaged_c = c_path(damaged)?;
    let out_c = c_path(out)?;

    let mut db = ptr::null_mut();
    let rc = unsafe {
        ffi::sqlite3_open_v2(damaged_c.as_ptr(), &mut db, ffi::SQLITE_OPEN_READONLY, ptr::null())
    };
    let handle = Handle(db);
    if rc != ffi::SQLITE_OK {
        let msg = unsafe { CStr::from_ptr(ffi::sqlite3_errmsg(handle.0)) };
        return Err(msg.to_string_lossy().into_owned());
    }

    unsafe {
        let p = sqlite3_recover_init(handle.0, c"main".as_ptr(), out_c.as_ptr());
        if p.is_null() {
            return Err("out of memory starting recovery".to_string());
        }
        sqlite3_recover_run(p);
        // The message belongs to the recover handle, which `finish` frees.
        let msg = sqlite3_recover_errmsg(p);
        let msg = if msg.is_null() {
            "recovery failed".to_string()
        } else {
            CStr::from_ptr(msg).to_string_lossy().into_owned()
        };
        match sqlite3_recover_finish(p) {
            ffi::SQLITE_OK => Ok(()),
            _ => Err(msg),
        }
    }
}
