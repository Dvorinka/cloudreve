package org.cloudreve.android.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Where photo backup stands, computed from the same inputs the worker uses:
 * MediaStore for what is on the device, the settings store for what has been
 * sent or given up on. Cheap enough to run on every home-page load (ids and
 * dates only, no file access).
 */
class BackupStats(private val context: Context, private val settings: CameraUploadSettings) {

    data class Stats(
        val total: Int,
        val synced: Int,
        val pending: Int,
        val failed: Int,
        val lastRunAt: Long,
        val remoteFolder: String,
        /** Backup is Wi-Fi only and the device is on a metered connection right now. */
        val waitingForWifi: Boolean,
    ) {
        val fraction: Float get() = if (total > 0) synced.toFloat() / total else 1f
        val done: Boolean get() = pending == 0 && failed == 0
    }

    /** Null when backup is off or the media permission has not been granted. */
    suspend fun compute(): Stats? = withContext(Dispatchers.IO) {
        val snap = settings.snapshotNow()
        if (!snap.enabled || !hasMediaPermission()) return@withContext null

        val synced = settings.syncedIdsNow()
        val failed = settings.failedIdsNow()
        val lastTs = settings.lastSyncTsNow()

        var total = 0
        var pending = 0
        var failedOnDevice = 0
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val types = buildList {
            add(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE)
            if (snap.includeVideos) add(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
        }
        val selection = "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${types.joinToString(",") { "?" }})"
        context.contentResolver.query(
            collection,
            arrayOf(MediaStore.Files.FileColumns._ID, MediaStore.Files.FileColumns.DATE_ADDED),
            selection, types.map { it.toString() }.toTypedArray(), null,
        )?.use { c ->
            while (c.moveToNext()) {
                total++
                val id = c.getLong(0).toString()
                when {
                    id in failed -> failedOnDevice++
                    // The worker walks media in DATE_ADDED order and remembers the newest it
                    // finished, so anything newer that it has not marked is still to do.
                    c.getLong(1) > lastTs && id !in synced -> pending++
                }
            }
        }
        Stats(
            total = total,
            synced = total - pending - failedOnDevice,
            pending = pending,
            failed = failedOnDevice,
            lastRunAt = snap.lastSyncAt,
            remoteFolder = snap.remoteFolder,
            waitingForWifi = snap.wifiOnly && pending > 0 && isMetered(),
        )
    }

    private fun hasMediaPermission(): Boolean {
        val perms = if (Build.VERSION.SDK_INT >= 33) {
            listOf(Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO)
        } else {
            listOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }
        return perms.any { context.checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }
    }

    private fun isMetered(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return true
        return !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }
}
