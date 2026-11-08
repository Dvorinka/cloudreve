package org.cloudreve.android.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.cloudreve.android.util.CrUri

private val Context.cameraUploadStore by preferencesDataStore(name = "camera_upload")

/**
 * Camera auto-upload preferences plus the incremental-sync bookkeeping:
 * a DATE_ADDED watermark (everything older is done), the ids uploaded at
 * the watermark second (ties), and the ids given up on. Sets are bounded so
 * storage stays small; an evicted entry costs one duplicate upload attempt,
 * which the server answers with "already exists".
 */
class CameraUploadSettings(private val context: Context) {

    private object Keys {
        val enabled = booleanPreferencesKey("enabled")
        val remoteFolder = stringPreferencesKey("remote_folder")
        val wifiOnly = booleanPreferencesKey("wifi_only")
        val includeVideos = booleanPreferencesKey("include_videos")
        val syncedIds = stringSetPreferencesKey("synced_ids")
        val failedIds = stringSetPreferencesKey("failed_ids")
        val lastSyncTs = longPreferencesKey("last_sync_ts")
        val lastSyncAt = longPreferencesKey("last_sync_at")
        val schema = intPreferencesKey("schema")
    }

    data class Snapshot(
        val enabled: Boolean = false,
        val remoteFolder: String = DEFAULT_FOLDER,
        val wifiOnly: Boolean = true,
        val includeVideos: Boolean = true,
        val lastSyncAt: Long = 0L,
    )

    val snapshot: Flow<Snapshot> = context.cameraUploadStore.data.map {
        Snapshot(
            enabled = it[Keys.enabled] ?: false,
            remoteFolder = it[Keys.remoteFolder] ?: DEFAULT_FOLDER,
            wifiOnly = it[Keys.wifiOnly] ?: true,
            includeVideos = it[Keys.includeVideos] ?: true,
            lastSyncAt = it[Keys.lastSyncAt] ?: 0L,
        )
    }

    suspend fun snapshotNow(): Snapshot = snapshot.first()

    suspend fun setEnabled(enabled: Boolean) {
        context.cameraUploadStore.edit { it[Keys.enabled] = enabled }
    }

    suspend fun setRemoteFolder(folder: String) {
        context.cameraUploadStore.edit { it[Keys.remoteFolder] = folder.trim() }
    }

    suspend fun setWifiOnly(wifiOnly: Boolean) {
        context.cameraUploadStore.edit { it[Keys.wifiOnly] = wifiOnly }
    }

    suspend fun setIncludeVideos(include: Boolean) {
        context.cameraUploadStore.edit { it[Keys.includeVideos] = include }
    }

    /**
     * MediaStore ids uploaded at the watermark second. Older items are excluded by the
     * watermark itself, so this only has to disambiguate ties: a burst of photos, or a
     * whole gallery restored from backup, all share one DATE_ADDED.
     */
    suspend fun syncedIdsNow(): Set<String> =
        (context.cameraUploadStore.data.first()[Keys.syncedIds] ?: emptySet()).map { it.idPart() }.toSet()

    suspend fun failedIdsNow(): Set<String> =
        context.cameraUploadStore.data.first()[Keys.failedIds] ?: emptySet()

    suspend fun lastSyncTsNow(): Long =
        context.cameraUploadStore.data.first()[Keys.lastSyncTs] ?: 0L

    suspend fun markSynced(id: String, dateAddedSec: Long) {
        context.cameraUploadStore.edit { prefs ->
            val watermark = maxOf(prefs[Keys.lastSyncTs] ?: 0L, dateAddedSec)
            // Entries are "id@dateAdded". Anything older than the watermark is excluded by
            // the worker's DATE_ADDED >= watermark query and can be forgotten; entries from
            // older app versions have no timestamp and are kept until the size cap.
            val synced = (prefs[Keys.syncedIds] ?: emptySet())
                .filterTo(mutableSetOf()) { it.tsPart()?.let { ts -> ts >= watermark } ?: true }
            synced.add("$id@$dateAddedSec")
            prefs[Keys.syncedIds] = synced.bounded()
            prefs[Keys.lastSyncTs] = watermark
            prefs[Keys.lastSyncAt] = System.currentTimeMillis()
        }
    }

    suspend fun markFailed(id: String) {
        context.cameraUploadStore.edit { prefs ->
            val failed = (prefs[Keys.failedIds] ?: emptySet()).toMutableSet()
            failed.add(id)
            prefs[Keys.failedIds] = failed.bounded()
        }
    }

    /** Forget permanent failures so the next run tries them again. */
    suspend fun clearFailed() {
        context.cameraUploadStore.edit { it.remove(Keys.failedIds) }
    }

    /**
     * Forget what was synced so the next run walks the whole gallery again. Already
     * uploaded files cost one request each (the server answers "already exists"), no
     * bytes, so a rescan is cheap enough to run after every bookkeeping change.
     */
    suspend fun rescanAll() {
        context.cameraUploadStore.edit {
            it.remove(Keys.lastSyncTs)
            it.remove(Keys.syncedIds)
            it[Keys.schema] = SCHEMA
        }
    }

    /**
     * Called by the worker before each run. Schema 1 (unnumbered) used a strict `>`
     * watermark, which skipped every photo sharing a DATE_ADDED second with the last one
     * uploaded; those were never sent and were counted as done. One full rescan picks
     * them up.
     */
    suspend fun migrateIfNeeded() {
        val current = context.cameraUploadStore.data.first()[Keys.schema] ?: 1
        if (current < SCHEMA) rescanAll()
    }

    /** A run finished (even with nothing to do); the stats card shows this as "Last run". */
    suspend fun markRun() {
        context.cameraUploadStore.edit { it[Keys.lastSyncAt] = System.currentTimeMillis() }
    }

    private fun Set<String>.bounded(): Set<String> =
        if (size <= MAX_TRACKED_IDS) this else this.drop(size - MAX_TRACKED_IDS).toSet()

    private fun String.idPart(): String = substringBefore('@')
    private fun String.tsPart(): Long? = substringAfter('@', "").toLongOrNull()

    companion object {
        const val DEFAULT_FOLDER = "${CrUri.MY_PREFIX}/Photos"
        private const val MAX_TRACKED_IDS = 2000
        private const val SCHEMA = 2
    }
}
