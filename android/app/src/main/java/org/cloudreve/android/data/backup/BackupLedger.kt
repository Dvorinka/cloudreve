package org.cloudreve.android.data.backup

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

/**
 * What the server has of the phone's photos, one row per (file content,
 * MediaStore row).
 *
 * Identity is the SHA-256 of the bytes, computed while the file is staged for
 * upload, so a photo stays the same photo across MediaStore rebuilds, renames
 * and a second phone. The same content can sit in two gallery rows (a copy in
 * another album); each gets its own row pointing at the one remote file.
 * MediaStore id, name and dates are cached attributes used to recognise a row
 * cheaply on the next scan without re-reading the file.
 *
 * Only outcomes are stored. "Pending" is not a state: it is every MediaStore
 * row with no matching ledger entry, recomputed on each scan, so nothing can be
 * assumed done because of its position in a list or the date it was added.
 *
 * Plain SQLite rather than Room: four queries, no relations, and no annotation
 * processor to keep in step with the Kotlin version.
 */
class BackupLedger(context: Context) : SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    enum class State {
        /** Upload completed and the server reports the same byte count we sent. */
        UPLOADED,
        /** The server refused this file, or it cannot be read; retried only on request. */
        REJECTED,
        /** Was UPLOADED; a later check found it gone (or resized) on the server. */
        MISSING,
    }

    data class Item(
        val sha256: String,
        val mediaId: Long,
        val name: String,
        val size: Long,
        /** Capture time in epoch millis (EXIF, or the file's modification time). */
        val capturedAt: Long,
        /** MediaStore DATE_MODIFIED, seconds; part of the cheap match key. */
        val dateModified: Long,
        val remoteUri: String?,
        val remoteSize: Long?,
        val state: State,
        val uploadedAt: Long = 0,
        val verifiedAt: Long = 0,
        val error: String? = null,
    )

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE items (
                sha256 TEXT NOT NULL,
                media_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                size INTEGER NOT NULL,
                captured_at INTEGER NOT NULL,
                date_modified INTEGER NOT NULL,
                remote_uri TEXT,
                remote_size INTEGER,
                state TEXT NOT NULL,
                uploaded_at INTEGER NOT NULL DEFAULT 0,
                verified_at INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                PRIMARY KEY (sha256, media_id)
            )""",
        )
        db.execSQL("CREATE INDEX items_media ON items(media_id)")
        db.execSQL("CREATE INDEX items_state ON items(state)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Only pre-release schemas exist; rebuilding costs one adoption scan, no uploads.
        db.execSQL("DROP TABLE IF EXISTS items")
        onCreate(db)
    }

    /**
     * Every row grouped by MediaStore id, for matching a scan without touching files.
     * An id can carry several rows when a file was edited in place: each content
     * version keeps its own row, since each may be on the server.
     */
    fun byMediaId(): Map<Long, List<Item>> =
        readableDatabase.query("items", null, null, null, null, null, null).use { c ->
            buildList { while (c.moveToNext()) add(c.item()) }.groupBy { it.mediaId }
        }

    /** The row describing exactly this MediaStore row's current content, if any. */
    fun match(index: Map<Long, List<Item>>, mediaId: Long, size: Long, dateModified: Long): Item? =
        index[mediaId]?.firstOrNull { it.size == size && it.dateModified == dateModified }

    fun findByHash(sha256: String): Item? =
        readableDatabase.query("items", null, "sha256 = ?", arrayOf(sha256), null, null, null)
            .use { c -> if (c.moveToFirst()) c.item() else null }

    fun inState(state: State): List<Item> =
        readableDatabase.query("items", null, "state = ?", arrayOf(state.name), null, null, "captured_at DESC")
            .use { c -> buildList { while (c.moveToNext()) add(c.item()) } }

    fun isEmpty(): Boolean =
        readableDatabase.rawQuery("SELECT 1 FROM items LIMIT 1", null).use { !it.moveToFirst() }

    fun upsert(item: Item) {
        writableDatabase.insertWithOnConflict("items", null, item.values(), SQLiteDatabase.CONFLICT_REPLACE)
    }

    /**
     * The same bytes seen under another MediaStore row (rebuild, rename, a copy in a
     * second album): record that row too, pointing at the same remote file.
     */
    fun adopt(known: Item, mediaId: Long, name: String, dateModified: Long) {
        upsert(known.copy(mediaId = mediaId, name = name, dateModified = dateModified))
    }

    fun setState(sha256: String, state: State, error: String? = null, verifiedAt: Long = 0) {
        writableDatabase.update(
            "items",
            ContentValues().apply {
                put("state", state.name)
                put("error", error)
                if (verifiedAt > 0) put("verified_at", verifiedAt)
            },
            "sha256 = ?", arrayOf(sha256),
        )
    }

    /** Forget a whole state so the next scan treats those photos as new again. */
    fun forget(state: State): Int = writableDatabase.delete("items", "state = ?", arrayOf(state.name))

    private fun Item.values() = ContentValues().apply {
        put("sha256", sha256)
        put("media_id", mediaId)
        put("name", name)
        put("size", size)
        put("captured_at", capturedAt)
        put("date_modified", dateModified)
        put("remote_uri", remoteUri)
        put("remote_size", remoteSize)
        put("state", state.name)
        put("uploaded_at", uploadedAt)
        put("verified_at", verifiedAt)
        put("error", error)
    }

    private fun Cursor.item() = Item(
        sha256 = getString(getColumnIndexOrThrow("sha256")),
        mediaId = getLong(getColumnIndexOrThrow("media_id")),
        name = getString(getColumnIndexOrThrow("name")),
        size = getLong(getColumnIndexOrThrow("size")),
        capturedAt = getLong(getColumnIndexOrThrow("captured_at")),
        dateModified = getLong(getColumnIndexOrThrow("date_modified")),
        remoteUri = getColumnIndexOrThrow("remote_uri").let { if (isNull(it)) null else getString(it) },
        remoteSize = getColumnIndexOrThrow("remote_size").let { if (isNull(it)) null else getLong(it) },
        state = State.valueOf(getString(getColumnIndexOrThrow("state"))),
        uploadedAt = getLong(getColumnIndexOrThrow("uploaded_at")),
        verifiedAt = getLong(getColumnIndexOrThrow("verified_at")),
        error = getColumnIndexOrThrow("error").let { if (isNull(it)) null else getString(it) },
    )

    companion object {
        private const val DB_NAME = "backup_ledger.db"
        private const val DB_VERSION = 2
    }
}
