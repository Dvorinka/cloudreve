package org.cloudreve.android.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentUris
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
import android.provider.MediaStore
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.sync.Mutex
import org.cloudreve.android.CloudreveApp
import org.cloudreve.android.data.ApiException
import org.cloudreve.android.data.CameraUploadSettings
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Scans MediaStore for photos/videos not yet backed up and uploads them, one at
 * a time, to the configured Cloudreve folder until the backlog is empty.
 *
 * Every run (periodic, "sync now", or the one scheduled when backup is turned
 * on) drains the whole backlog: a fresh install with thousands of photos is
 * the common case, not the exception. A run gives up its slot after
 * [RUN_BUDGET_MS] and chains a continuation, so a very long first sync is a
 * series of foreground-service runs rather than one that Android would kill,
 * and progress survives process death because every item is marked as it
 * lands. Uploads are sequential, which is the rate limit: the server and the
 * network see one file at a time.
 *
 * A bounded set of synced/failed MediaStore IDs plus the date-added watermark
 * prevents re-uploads. Network trouble ends the run with a retry (WorkManager
 * backs off); only errors specific to one file mark that file as failed.
 */
class CameraUploadWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val app = applicationContext as CloudreveApp
        val settings = app.cameraUploadSettings
        val cfg = settings.snapshotNow()
        if (!cfg.enabled) return Result.success()
        // The periodic job and a "sync now" can overlap; the second one would re-upload
        // whatever the first has in flight. Let it leave, the first drains the backlog.
        if (!runLock.tryLock()) return Result.success()

        try {
            createChannel()
            settings.migrateIfNeeded()
            val started = SystemClock.elapsedRealtime()
            var backlog = -1
            var done = 0

            while (!isStopped) {
                // Re-query per batch rather than hold 5000 rows: cheap (ids and names only)
                // and picks up photos taken while the run is going.
                val synced = settings.syncedIdsNow()
                val failed = settings.failedIdsNow()
                val remaining = queryNewMedia(settings.lastSyncTsNow(), cfg.includeVideos)
                    .filter { it.id !in synced && it.id !in failed }
                if (backlog < 0) backlog = remaining.size
                if (remaining.isEmpty()) break

                for (item in remaining.take(BATCH)) {
                    if (isStopped) break
                    if (SystemClock.elapsedRealtime() - started > RUN_BUDGET_MS) {
                        // Hand the rest to a new run so no single foreground service runs
                        // for hours (Android 14 caps dataSync services per day).
                        continueLater(applicationContext, cfg.wifiOnly)
                        settings.markRun()
                        return Result.success()
                    }
                    val total = maxOf(backlog, done + 1)
                    setProgress(BackgroundSync.progress(BackgroundSync.Kind.CAMERA, item.name, done, total))
                    setForeground(progressInfo("Backing up ${item.name}", done, total))
                    when (upload(app, settings, cfg, item)) {
                        Outcome.DONE -> done++
                        Outcome.SKIPPED -> Unit
                        Outcome.NETWORK -> {
                            // Nothing wrong with the photo; come back when the network does.
                            settings.markRun()
                            return Result.retry()
                        }
                    }
                }
            }
            settings.markRun()
            return Result.success()
        } finally {
            runLock.unlock()
        }
    }

    private enum class Outcome { DONE, SKIPPED, NETWORK }

    private suspend fun upload(
        app: CloudreveApp,
        settings: CameraUploadSettings,
        cfg: CameraUploadSettings.Snapshot,
        item: MediaItem,
    ): Outcome {
        // Staging reads the phone's own storage: any failure here is about this row (gone
        // from MediaStore since the query, unreadable) and must not look like a network
        // problem, or the run would retry forever on one broken photo.
        val tmp = try {
            stageToCache(item)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "cannot read ${item.name}", e)
            settings.markFailed(item.id)
            return Outcome.SKIPPED
        }
        try {
            app.fileRepository.uploadFile(tmp, cfg.remoteFolder) { _, _ -> }
            settings.markSynced(item.id, item.dateAddedSec)
            return Outcome.DONE
        } catch (e: ApiException) {
            if (e.code == CODE_OBJECT_EXISTS) {
                // A same-named photo is already in the folder (earlier run, another
                // device, re-enabled backup): that is the outcome we wanted.
                settings.markSynced(item.id, item.dateAddedSec)
                return Outcome.DONE
            }
            if (e.code in 500..599 || e.code == 429 || e.code == ApiException.CODE_LOGIN_REQUIRED) {
                // Server down, restarting, throttling, or our session expired: not this
                // file's fault either.
                android.util.Log.w(TAG, "backup of ${item.name} deferred: ${e.message}")
                return Outcome.NETWORK
            }
            // The server refused this file (policy, size, name): skip it for good so it
            // cannot block every later photo. "Retry failed" clears these.
            android.util.Log.w(TAG, "backup of ${item.name} rejected", e)
            settings.markFailed(item.id)
            return Outcome.SKIPPED
        } catch (e: IOException) {
            android.util.Log.w(TAG, "backup of ${item.name} interrupted by the network", e)
            return Outcome.NETWORK
        } catch (e: Exception) {
            android.util.Log.w(TAG, "backup of ${item.name} failed", e)
            settings.markFailed(item.id)
            return Outcome.SKIPPED
        } finally {
            tmp.delete()
        }
    }

    private data class MediaItem(
        val id: String,
        val contentUri: android.net.Uri,
        val name: String,
        val dateAddedSec: Long,
    )

    private fun queryNewMedia(sinceSec: Long, includeVideos: Boolean): List<MediaItem> {
        val out = mutableListOf<MediaItem>()
        val collection = MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL)
        val projection = arrayOf(
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.DATE_ADDED,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
        )
        val mediaTypes = buildList {
            add(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE)
            if (includeVideos) add(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO)
        }
        // >= not >: items sharing the watermark second are told apart by the synced set.
        val selection = "${MediaStore.Files.FileColumns.DATE_ADDED} >= ? AND " +
            "${MediaStore.Files.FileColumns.MEDIA_TYPE} IN (${mediaTypes.joinToString(",") { "?" }})"
        val args = (listOf(sinceSec) + mediaTypes).map { it.toString() }.toTypedArray()
        val order = "${MediaStore.Files.FileColumns.DATE_ADDED} ASC"

        applicationContext.contentResolver.query(
            collection, projection, selection, args, order,
        )?.use { cursor ->
            val idIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID)
            val nameIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME)
            val dateIdx = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED)
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIdx)
                out.add(
                    MediaItem(
                        id = id.toString(),
                        contentUri = ContentUris.withAppendedId(collection, id),
                        name = cursor.getString(nameIdx) ?: "media_$id",
                        dateAddedSec = cursor.getLong(dateIdx),
                    )
                )
            }
        }
        return out
    }

    private fun stageToCache(item: MediaItem): File {
        val dir = File(applicationContext.cacheDir, "camera_staging").apply { mkdirs() }
        val tmp = File(dir, item.name)
        applicationContext.contentResolver.openInputStream(item.contentUri)!!.use { input ->
            FileOutputStream(tmp).use { input.copyTo(it) }
        }
        return tmp
    }

    private fun progressInfo(text: String, index: Int, total: Int): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Cloudreve camera backup")
            .setContentText("$text (${index + 1}/$total)")
            .setOngoing(true)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIF_ID, notification)
        }
    }

    private fun createChannel() {
        val manager =
            applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Camera backup", NotificationManager.IMPORTANCE_LOW)
        )
    }

    companion object {
        private const val TAG = "CameraUpload"
        private const val CODE_OBJECT_EXISTS = 40004 // pkg/serializer/error.go
        private const val WORK_NAME = "camera_upload_periodic"
        private const val WORK_ONCE = "camera_upload_once"
        private const val CHANNEL_ID = "camera_upload"
        private const val NOTIF_ID = 42
        private const val WORK_CONTINUE = "camera_upload_continue"
        /** Items taken per MediaStore query; the run loops until the query is empty. */
        private const val BATCH = 200
        /** After this a run hands over to a continuation rather than keep its foreground
         *  service alive: Android 14+ allows dataSync services about 6 h per day. */
        private const val RUN_BUDGET_MS = 30L * 60 * 1000

        private val runLock = Mutex()

        private fun constraints(wifiOnly: Boolean): Constraints =
            Constraints.Builder()
                .setRequiredNetworkType(
                    if (wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED
                )
                .setRequiresBatteryNotLow(true)
                .build()

        /** Schedules (or removes) the periodic sync and kicks an immediate run. */
        fun apply(context: Context, wifiOnly: Boolean) {
            val wm = WorkManager.getInstance(context)
            val periodic = PeriodicWorkRequestBuilder<CameraUploadWorker>(15, TimeUnit.MINUTES)
                .addTag(BackgroundSync.TAG)
                .setConstraints(constraints(wifiOnly))
                .build()
            wm.enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, periodic)
            wm.enqueueUniqueWork(
                WORK_ONCE,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<CameraUploadWorker>()
                .addTag(BackgroundSync.TAG)
                    .setConstraints(constraints(wifiOnly))
                    .build(),
            )
        }

        fun cancel(context: Context) {
            val wm = WorkManager.getInstance(context)
            wm.cancelUniqueWork(WORK_NAME)
            wm.cancelUniqueWork(WORK_ONCE)
            wm.cancelUniqueWork(WORK_CONTINUE)
        }

        /** The rest of a backlog, picked up as soon as the current run has returned. Uses
         *  its own unique name: REPLACE on [WORK_ONCE] from inside that work would cancel
         *  the caller, and KEEP makes a second request while one is queued a no-op. */
        private fun continueLater(context: Context, wifiOnly: Boolean) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_CONTINUE,
                ExistingWorkPolicy.KEEP,
                OneTimeWorkRequestBuilder<CameraUploadWorker>()
                    .addTag(BackgroundSync.TAG)
                    .setConstraints(constraints(wifiOnly))
                    .build(),
            )
        }

        /** Manual "sync now" — the periodic schedule is untouched. */
        fun syncNow(context: Context, wifiOnly: Boolean) {
            WorkManager.getInstance(context).enqueueUniqueWork(
                WORK_ONCE,
                ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<CameraUploadWorker>()
                .addTag(BackgroundSync.TAG)
                    .setConstraints(constraints(wifiOnly))
                    .build(),
            )
        }
    }
}
