package org.cloudreve.android.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import org.cloudreve.android.util.CrUri

private val Context.cameraUploadStore by preferencesDataStore(name = "camera_upload")

/**
 * Camera auto-upload preferences and run timestamps. What has been uploaded
 * lives in [org.cloudreve.android.data.backup.BackupLedger], keyed by content,
 * not here: a preferences store is the wrong place for per-photo state.
 */
class CameraUploadSettings(private val context: Context) {

    private object Keys {
        val enabled = booleanPreferencesKey("enabled")
        val paused = booleanPreferencesKey("paused")
        val remoteFolder = stringPreferencesKey("remote_folder")
        val wifiOnly = booleanPreferencesKey("wifi_only")
        val includeVideos = booleanPreferencesKey("include_videos")
        val lastSyncAt = longPreferencesKey("last_sync_at")
        val lastReconcileAt = longPreferencesKey("last_reconcile_at")
    }

    data class Snapshot(
        val enabled: Boolean = false,
        /** Halted from the notification; work stays armed but every run exits. */
        val paused: Boolean = false,
        /** Root folder; photos go to `root/yyyy/MM` by capture date. */
        val remoteFolder: String = DEFAULT_FOLDER,
        val wifiOnly: Boolean = true,
        val includeVideos: Boolean = true,
        val lastSyncAt: Long = 0L,
        val lastReconcileAt: Long = 0L,
    )

    val snapshot: Flow<Snapshot> = context.cameraUploadStore.data.map {
        Snapshot(
            enabled = it[Keys.enabled] ?: false,
            paused = it[Keys.paused] ?: false,
            remoteFolder = it[Keys.remoteFolder] ?: DEFAULT_FOLDER,
            wifiOnly = it[Keys.wifiOnly] ?: true,
            includeVideos = it[Keys.includeVideos] ?: true,
            lastSyncAt = it[Keys.lastSyncAt] ?: 0L,
            lastReconcileAt = it[Keys.lastReconcileAt] ?: 0L,
        )
    }

    suspend fun snapshotNow(): Snapshot = snapshot.first()

    suspend fun setEnabled(enabled: Boolean) {
        context.cameraUploadStore.edit {
            it[Keys.enabled] = enabled
            // Disabling is the stronger action; re-enabling starts unpaused.
            if (!enabled) it[Keys.paused] = false
        }
    }

    suspend fun setPaused(paused: Boolean) {
        context.cameraUploadStore.edit { it[Keys.paused] = paused }
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

    /** A run finished (even with nothing to do); the stats card shows this as "Last run". */
    suspend fun markRun() {
        context.cameraUploadStore.edit { it[Keys.lastSyncAt] = System.currentTimeMillis() }
    }

    suspend fun markReconciled() {
        context.cameraUploadStore.edit { it[Keys.lastReconcileAt] = System.currentTimeMillis() }
    }

    companion object {
        const val DEFAULT_FOLDER = "${CrUri.MY_PREFIX}/Photos"
    }
}
