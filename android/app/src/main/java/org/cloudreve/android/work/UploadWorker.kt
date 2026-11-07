package org.cloudreve.android.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ForegroundInfo
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import org.cloudreve.android.CloudreveApp
import org.cloudreve.android.data.ApiException
import java.io.File
import java.io.FileOutputStream

/**
 * UploadWorker copies SAF/content URIs into cache, then streams them through
 * the Cloudreve upload-session flow. WorkManager survives process death for
 * large transfers. Progress goes two ways: a determinate foreground
 * notification with a cancel action, and [WorkInfo.progress] for the in-app
 * transfer card (see [UploadStatus.from]).
 */
class UploadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    private val notifications =
        applicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private var lastNotified = 0L

    override suspend fun doWork(): Result {
        val uris = inputData.getStringArray(KEY_URIS)?.toList() ?: return Result.failure()
        val parentUri = inputData.getString(KEY_PARENT_URI) ?: return Result.failure()
        val names = inputData.getStringArray(KEY_NAMES)
        val overwrite = inputData.getBoolean(KEY_OVERWRITE, false)
        val app = applicationContext as CloudreveApp

        createChannel()
        var failed = 0
        var lastError: String? = null
        try {
            uris.forEachIndexed { i, uriString ->
                val uri = Uri.parse(uriString)
                val name = names?.getOrNull(i) ?: resolveDisplayName(uri)
                report(name, i, uris.size, sent = 0, size = 0, parentUri = parentUri, force = true)
                try {
                    val tmp = stageToCache(uri, name)
                    try {
                        app.fileRepository.uploadFile(tmp, parentUri, remoteName = name, overwrite = overwrite) { sent, total ->
                            report(name, i, uris.size, sent, total, parentUri)
                        }
                    } finally {
                        tmp.delete()
                    }
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    failed++
                    lastError = describe(e, name)
                }
            }
        } finally {
            notifications.cancel(NOTIF_ID)
        }

        val output = workDataOf(
            KEY_PARENT_URI to parentUri,
            KEY_UPLOADED to uris.size - failed,
            KEY_FAILED to failed,
            KEY_ERROR to lastError,
        )
        return if (failed == 0) Result.success(output) else Result.failure(output)
    }

    /**
     * Pushes progress to WorkManager and (throttled) to the notification.
     * Called from OkHttp's write loop, hence the non-suspending Async variants.
     */
    private fun report(
        name: String, index: Int, total: Int, sent: Long, size: Long, parentUri: String, force: Boolean = false,
    ) {
        setProgressAsync(
            workDataOf(
                KEY_PARENT_URI to parentUri,
                KEY_PROGRESS_NAME to name,
                KEY_PROGRESS_INDEX to index,
                KEY_PROGRESS_TOTAL to total,
                KEY_PROGRESS_SENT to sent,
                KEY_PROGRESS_SIZE to size,
            )
        )
        val now = System.currentTimeMillis()
        if (force || now - lastNotified >= NOTIFY_INTERVAL_MS) {
            lastNotified = now
            setForegroundAsync(foregroundInfo(name, index, total, sent, size))
        }
    }

    /** Server error codes read like log lines; say what happened to this file instead. */
    private fun describe(e: Exception, name: String): String = when {
        e is ApiException && e.code == CODE_OBJECT_EXISTS -> "$name already exists in this folder"
        e is ApiException && e.code == CODE_QUOTA_EXCEEDED -> "Not enough storage for $name"
        else -> e.message ?: "Could not upload $name"
    }

    private fun resolveDisplayName(uri: Uri): String {
        val cursor = applicationContext.contentResolver.query(uri, null, null, null, null)
        cursor?.use {
            val idx = it.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
            if (it.moveToFirst() && idx >= 0) return it.getString(idx)
        }
        return uri.lastPathSegment?.substringAfterLast('/') ?: "upload.bin"
    }

    private fun stageToCache(uri: Uri, name: String): File {
        val dir = File(applicationContext.cacheDir, "upload_staging").apply { mkdirs() }
        val tmp = File(dir, name)
        applicationContext.contentResolver.openInputStream(uri)!!.use { input ->
            FileOutputStream(tmp).use { input.copyTo(it) }
        }
        return tmp
    }

    private fun foregroundInfo(name: String, index: Int, total: Int, sent: Long, size: Long): ForegroundInfo {
        val cancel = WorkManager.getInstance(applicationContext).createCancelPendingIntent(id)
        val percent = if (size > 0) (sent * 100 / size).toInt() else 0
        val title = if (total > 1) "Uploading ${index + 1} of $total" else "Uploading"
        val notification = NotificationCompat.Builder(applicationContext, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(title)
            .setContentText(name)
            .setProgress(100, percent, size <= 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Cancel", cancel)
            .build()
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ForegroundInfo(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIF_ID, notification)
        }
    }

    private fun createChannel() {
        notifications.createNotificationChannel(
            NotificationChannel(CHANNEL_ID, "Uploads", NotificationManager.IMPORTANCE_LOW)
        )
    }

    companion object {
        const val TAG = "upload"
        const val KEY_URIS = "uris"
        /** Target file names, parallel to [KEY_URIS]; absent = use each URI's display name. */
        const val KEY_NAMES = "names"
        /** Add a version to files that already exist instead of failing. */
        const val KEY_OVERWRITE = "overwrite"
        const val KEY_PARENT_URI = "parent_uri"
        const val KEY_UPLOADED = "uploaded"
        const val KEY_FAILED = "failed"
        const val KEY_ERROR = "error"
        const val KEY_PROGRESS_NAME = "name"
        const val KEY_PROGRESS_INDEX = "index"
        const val KEY_PROGRESS_TOTAL = "total"
        const val KEY_PROGRESS_SENT = "sent"
        const val KEY_PROGRESS_SIZE = "size"
        private const val CHANNEL_ID = "uploads"
        private const val NOTIF_ID = 41
        private const val NOTIFY_INTERVAL_MS = 500L
        // pkg/serializer/error.go
        private const val CODE_OBJECT_EXISTS = 40004
        private const val CODE_QUOTA_EXCEEDED = 40051

        fun enqueue(
            context: Context,
            uris: List<Uri>,
            parentUri: String,
            names: List<String>? = null,
            overwrite: Boolean = false,
        ) {
            if (uris.isEmpty()) return
            val data = Data.Builder()
                .putStringArray(KEY_URIS, uris.map { it.toString() }.toTypedArray())
                .putString(KEY_PARENT_URI, parentUri)
                .putBoolean(KEY_OVERWRITE, overwrite)
            if (names != null) data.putStringArray(KEY_NAMES, names.toTypedArray())
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .addTag(TAG)
                .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
                .setInputData(data.build())
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }

        /** Display name of a picked document, as the picker shows it. */
        fun displayName(context: Context, uri: Uri): String {
            context.contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst() && !it.isNull(0)) return it.getString(0)
            }
            return uri.lastPathSegment?.substringAfterLast('/') ?: "upload.bin"
        }

        /** "report.pdf" -> "report (1).pdf", counting up until the name is free. */
        fun uniqueName(name: String, taken: Set<String>): String {
            if (name !in taken) return name
            val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
            val stem = name.substring(0, dot)
            val ext = name.substring(dot)
            var n = 1
            while ("$stem ($n)$ext" in taken) n++
            return "$stem ($n)$ext"
        }
    }
}

/** In-app view of one upload request, derived from [WorkInfo]. */
data class UploadStatus(
    val id: java.util.UUID,
    val state: WorkInfo.State,
    val parentUri: String,
    val name: String,
    val index: Int,
    val total: Int,
    val sent: Long,
    val size: Long,
    val uploaded: Int,
    val failed: Int,
    val error: String?,
) {
    val active: Boolean get() = !state.isFinished
    /** Whole-batch fraction, or null while the current file's size is unknown. */
    val fraction: Float?
        get() {
            if (total <= 0) return null
            val current = if (size > 0) sent.toFloat() / size else return if (index > 0) index.toFloat() / total else null
            return ((index + current) / total).coerceIn(0f, 1f)
        }

    companion object {
        fun from(info: WorkInfo): UploadStatus {
            val p = info.progress
            val o = info.outputData
            return UploadStatus(
                id = info.id,
                state = info.state,
                parentUri = p.getString(UploadWorker.KEY_PARENT_URI) ?: o.getString(UploadWorker.KEY_PARENT_URI) ?: "",
                name = p.getString(UploadWorker.KEY_PROGRESS_NAME) ?: "",
                index = p.getInt(UploadWorker.KEY_PROGRESS_INDEX, 0),
                total = p.getInt(UploadWorker.KEY_PROGRESS_TOTAL, 0),
                sent = p.getLong(UploadWorker.KEY_PROGRESS_SENT, 0),
                size = p.getLong(UploadWorker.KEY_PROGRESS_SIZE, 0),
                uploaded = o.getInt(UploadWorker.KEY_UPLOADED, 0),
                failed = o.getInt(UploadWorker.KEY_FAILED, 0),
                error = o.getString(UploadWorker.KEY_ERROR),
            )
        }
    }
}
