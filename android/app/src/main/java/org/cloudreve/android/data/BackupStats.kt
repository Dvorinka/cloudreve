package org.cloudreve.android.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.cloudreve.android.data.backup.BackupLedger
import org.cloudreve.android.data.backup.BackupLedger.State
import org.cloudreve.android.data.backup.MediaScanner

/**
 * Where photo backup stands: every MediaStore row, classified by the ledger
 * entry that describes its current content. Rows with no entry are pending;
 * there is no shortcut by date or position. Ids and sizes only, no file
 * access, so cheap enough for every home-page load.
 */
class BackupStats(
    context: Context,
    private val settings: CameraUploadSettings,
    private val ledger: BackupLedger,
) {
    private val context = context.applicationContext
    private val scanner = MediaScanner(context)

    data class Stats(
        /** Photos and videos currently on the device. */
        val total: Int,
        /** On the server, upload completed and size confirmed. Safe to free up. */
        val uploaded: Int,
        val pending: Int,
        /** Refused by the server or unreadable; retried only on request. */
        val failed: Int,
        /** Were uploaded; the last check no longer found them on the server. */
        val missing: Int,
        val lastRunAt: Long,
        val remoteFolder: String,
        /** Backup is Wi-Fi only and the device is on a metered connection right now. */
        val waitingForWifi: Boolean,
    ) {
        val fraction: Float get() = if (total > 0) uploaded.toFloat() / total else 1f
        val done: Boolean get() = pending == 0 && failed == 0 && missing == 0
    }

    /** Null when backup is off or the media permission has not been granted. */
    suspend fun compute(): Stats? = withContext(Dispatchers.IO) {
        val snap = settings.snapshotNow()
        if (!snap.enabled || !hasMediaPermission()) return@withContext null

        val known = ledger.byMediaId()
        var total = 0
        var uploaded = 0
        var pending = 0
        var failed = 0
        var missing = 0
        for (row in scanner.scan(snap.includeVideos)) {
            total++
            when (ledger.match(known, row.id, row.size, row.dateModified)?.state) {
                State.UPLOADED -> uploaded++
                State.REJECTED -> failed++
                State.MISSING -> missing++
                null -> pending++
            }
        }
        Stats(
            total = total,
            uploaded = uploaded,
            pending = pending,
            failed = failed,
            missing = missing,
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
