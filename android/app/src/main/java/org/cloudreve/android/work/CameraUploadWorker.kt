package org.cloudreve.android.work

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.SystemClock
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
import org.cloudreve.android.data.backup.BackupLedger
import org.cloudreve.android.data.backup.BackupLedger.State
import org.cloudreve.android.data.backup.BackupPlan
import org.cloudreve.android.data.backup.MediaScanner
import org.cloudreve.android.util.CrUri
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.time.ZoneId
import java.util.concurrent.TimeUnit

/**
 * Backs up the phone's photos and videos to `root/yyyy/MM` on the server and
 * records every outcome in the [BackupLedger].
 *
 * Each run scans MediaStore, subtracts what the ledger already accounts for,
 * and uploads the rest newest-first, one file at a time, until nothing is
 * left; a run hands over to a chained continuation after [RUN_BUDGET_MS].
 * While a file is staged for upload its SHA-256 is computed and sent with the
 * upload session, so the server can link identical bytes it already holds
 * (rapid upload) and the ledger can recognise the photo again whatever
 * MediaStore calls it later.
 *
 * A photo is UPLOADED only when the upload completed and the server lists it
 * with the same byte count. A name collision is resolved against the
 * remote file: same size means it is the same photo (how everything uploaded
 * by earlier builds is adopted); otherwise ours goes up under a hash-suffixed
 * name. Nothing is ever merged on the strength of a name alone.
 *
 * Network trouble ends the run with a retry; only verdicts about one file
 * (unreadable, refused by the server) mark that file REJECTED. Once a day the
 * run also checks that every UPLOADED file is still on the server with its
 * size, and flags the ones that are not as MISSING for the user to decide.
 */
class CameraUploadWorker(context: Context, params: WorkerParameters) :
    CoroutineWorker(context, params) {

    private val app get() = applicationContext as CloudreveApp
    private val settings: CameraUploadSettings get() = app.cameraUploadSettings
    private val ledger: BackupLedger get() = app.backupLedger
    private val scanner by lazy { MediaScanner(applicationContext) }
    private val ensuredFolders = HashSet<String>()
    /** canonical remote uri -> size, for collision checks without a request per file. */
    private var remoteIndex: MutableMap<String, Long>? = null

    override suspend fun doWork(): Result {
        val cfg = settings.snapshotNow()
        if (!cfg.enabled) return Result.success()
        // The periodic job and "back up now" can overlap; the second would stage and
        // upload the same photo. Let it leave, the first drains the backlog.
        if (!runLock.tryLock()) return Result.success()

        try {
            createChannel()
            val started = SystemClock.elapsedRealtime()
            var backlog = -1
            var done = 0

            while (!isStopped) {
                val pending = pendingRows(cfg)
                if (backlog < 0) backlog = pending.size
                if (pending.isEmpty()) break
                if (remoteIndex == null) {
                    // One recursive listing of the backup root (500 files per request)
                    // answers every "is this name taken, and by what size" below.
                    remoteIndex = try {
                        HashMap(app.fileRepository.indexFiles(cfg.remoteFolder))
                    } catch (e: ApiException) {
                        if (e.isTransient) return retryLater()
                        HashMap() // root does not exist yet
                    } catch (e: IOException) {
                        return retryLater()
                    }
                }

                for (row in pending.take(BATCH)) {
                    if (isStopped) break
                    if (SystemClock.elapsedRealtime() - started > RUN_BUDGET_MS) {
                        continueLater(applicationContext, cfg.wifiOnly)
                        settings.markRun()
                        return Result.success()
                    }
                    val total = maxOf(backlog, done + 1)
                    setProgress(BackgroundSync.progress(BackgroundSync.Kind.CAMERA, row.name, done, total))
                    setForeground(progressInfo("Backing up ${row.name}", done, total))
                    when (backUp(cfg, row)) {
                        Outcome.DONE -> done++
                        Outcome.SKIPPED -> Unit
                        Outcome.NETWORK -> return retryLater()
                    }
                }
            }

            if (!isStopped && System.currentTimeMillis() - cfg.lastReconcileAt > RECONCILE_EVERY_MS) {
                reconcile(cfg)
            }
            settings.markRun()
            return Result.success()
        } finally {
            runLock.unlock()
        }
    }

    private suspend fun retryLater(): Result {
        settings.markRun()
        return Result.retry()
    }

    /** MediaStore rows with no ledger entry for their (id, size, modified) — newest first. */
    private fun pendingRows(cfg: CameraUploadSettings.Snapshot): List<MediaScanner.Row> {
        val known = ledger.byMediaId()
        return scanner.scan(cfg.includeVideos)
            .filter { row -> ledger.match(known, row.id, row.size, row.dateModified) == null }
            .sortedByDescending { it.capturedAt }
    }

    private enum class Outcome { DONE, SKIPPED, NETWORK }

    private suspend fun backUp(cfg: CameraUploadSettings.Snapshot, row: MediaScanner.Row): Outcome {
        // Staging reads the phone's own storage: a failure here is about this row (gone
        // since the scan, unreadable) and must not look like a network problem, or the
        // run would retry forever on one broken photo.
        val staged = try {
            stage(row)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "cannot read ${row.name}", e)
            ledger.upsert(
                BackupLedger.Item(
                    sha256 = "unreadable:${row.id}", mediaId = row.id, name = row.name, size = row.size,
                    capturedAt = row.capturedAt, dateModified = row.dateModified,
                    remoteUri = null, remoteSize = null, state = State.REJECTED, error = "Cannot read the file",
                ),
            )
            return Outcome.SKIPPED
        }
        try {
            ledger.findByHash(staged.sha256)?.let { known ->
                // Same bytes already accounted for, under another MediaStore row (rebuild,
                // rename, a copy in a second album). Nothing to send.
                ledger.adopt(known, row.id, row.name, row.dateModified)
                return if (known.state == State.UPLOADED) Outcome.DONE else Outcome.SKIPPED
            }

            val folder = BackupPlan.remoteFolder(cfg.remoteFolder, row.capturedAt, ZoneId.systemDefault())
            var target = resolveTarget(cfg.remoteFolder, folder, row, staged.sha256)
            if (target.alreadyThere) {
                record(row, staged.sha256, target.uri, row.size, verified = true)
                return Outcome.DONE
            }

            ensureFolder(folder)
            try {
                upload(staged, row, folder, target.uri)
            } catch (e: ApiException) {
                if (e.code != ApiException.CODE_OBJECT_EXISTS) throw e
                // Taken since the index was built (another device, the web app). Same
                // size: it is this photo. Otherwise ours goes up under a distinct name.
                val other = app.fileRepository.stat(target.uri)
                if (other != null && other.size == row.size) {
                    record(row, staged.sha256, target.uri, other.size, verified = true)
                    return Outcome.DONE
                }
                target = Target(CrUri.join(folder, BackupPlan.disambiguate(row.name, staged.sha256)), false)
                upload(staged, row, folder, target.uri)
            }

            // The upload completed; now the server's view is the one that counts.
            val remote = app.fileRepository.stat(target.uri)
            if (remote == null || remote.size != row.size) {
                android.util.Log.w(TAG, "${row.name}: server has ${remote?.size} bytes, expected ${row.size}")
                record(row, staged.sha256, target.uri, remote?.size, verified = false,
                       error = if (remote == null) "Not listed by the server after upload" else "Size differs on the server")
                return Outcome.SKIPPED
            }
            record(row, staged.sha256, target.uri, remote.size, verified = true)
            remoteIndex?.put(CrUri.canonical(target.uri), remote.size)
            return Outcome.DONE
        } catch (e: ApiException) {
            if (e.isTransient) {
                android.util.Log.w(TAG, "backup of ${row.name} deferred: ${e.message}")
                return Outcome.NETWORK
            }
            // The server refused this file (policy, size limit, name). Skip it for good so
            // it cannot block every later photo; "Retry failed" clears these.
            android.util.Log.w(TAG, "backup of ${row.name} rejected", e)
            ledger.upsert(
                BackupLedger.Item(
                    sha256 = staged.sha256, mediaId = row.id, name = row.name, size = row.size,
                    capturedAt = row.capturedAt, dateModified = row.dateModified,
                    remoteUri = null, remoteSize = null, state = State.REJECTED, error = e.message,
                ),
            )
            return Outcome.SKIPPED
        } catch (e: IOException) {
            android.util.Log.w(TAG, "backup of ${row.name} interrupted by the network", e)
            return Outcome.NETWORK
        } finally {
            staged.file.delete()
        }
    }

    private class Target(val uri: String, val alreadyThere: Boolean)

    private suspend fun upload(staged: Staged, row: MediaScanner.Row, folder: String, uri: String) {
        app.fileRepository.uploadFile(
            staged.file, folder, remoteName = CrUri.fileName(uri),
            hash = staged.sha256, lastModified = row.capturedAt,
        ) { _, _ -> }
    }

    /**
     * Where this photo goes, judged against the remote index. A name already taken by
     * a file of the same size is this photo (earlier builds uploaded without a hash, so
     * size is all there is to compare); taken by a different size, ours gets a
     * hash-suffixed name. Earlier builds put everything flat in [root], so that is
     * checked too, which is how an existing library is adopted without re-uploading.
     */
    private fun resolveTarget(root: String, folder: String, row: MediaScanner.Row, sha256: String): Target {
        val index = remoteIndex.orEmpty()
        val plain = CrUri.join(folder, row.name)
        val legacy = CrUri.join(root, row.name)
        for (candidate in listOf(plain, legacy)) {
            when (index[CrUri.canonical(candidate)]) {
                null -> Unit
                row.size -> return Target(candidate, alreadyThere = true)
                else -> if (candidate == plain) {
                    return Target(CrUri.join(folder, BackupPlan.disambiguate(row.name, sha256)), alreadyThere = false)
                }
            }
        }
        return Target(plain, alreadyThere = false)
    }

    private fun record(row: MediaScanner.Row, sha256: String, uri: String, remoteSize: Long?,
                       verified: Boolean, error: String? = null) {
        val now = System.currentTimeMillis()
        ledger.upsert(
            BackupLedger.Item(
                sha256 = sha256, mediaId = row.id, name = row.name, size = row.size,
                capturedAt = row.capturedAt, dateModified = row.dateModified,
                remoteUri = uri, remoteSize = remoteSize,
                state = if (verified) State.UPLOADED else State.REJECTED,
                uploadedAt = now, verifiedAt = if (verified) now else 0, error = error,
            ),
        )
    }

    private suspend fun ensureFolder(uri: String) {
        if (ensuredFolders.add(uri)) app.fileRepository.mkdirs(uri)
    }

    /**
     * Every UPLOADED row must still be listed with its size. Ones that are not become
     * MISSING: the user may have deleted them on purpose, so they are shown, not
     * silently re-sent. Skipped quietly when the server cannot be reached.
     */
    private suspend fun reconcile(cfg: CameraUploadSettings.Snapshot) {
        val index = try {
            app.fileRepository.indexFiles(cfg.remoteFolder)
        } catch (e: Exception) {
            android.util.Log.w(TAG, "reconcile skipped: ${e.message}")
            return
        }
        var missing = 0
        val now = System.currentTimeMillis()
        for (item in ledger.inState(State.UPLOADED)) {
            val uri = item.remoteUri ?: continue
            val remoteSize = index[CrUri.canonical(uri)]
            if (remoteSize == item.size) {
                ledger.setState(item.sha256, State.UPLOADED, verifiedAt = now)
            } else {
                missing++
                ledger.setState(item.sha256, State.MISSING,
                                error = if (remoteSize == null) "Not on the server any more" else "Size differs on the server")
            }
        }
        if (missing > 0) android.util.Log.w(TAG, "$missing backed-up photos are no longer on the server")
        settings.markReconciled()
    }

    private class Staged(val file: File, val sha256: String)

    /** Copies the media item into the cache, hashing it on the way. */
    private fun stage(row: MediaScanner.Row): Staged {
        val dir = File(applicationContext.cacheDir, "camera_staging").apply { mkdirs() }
        val tmp = File(dir, "${row.id}-${row.name}")
        val input = applicationContext.contentResolver.openInputStream(row.contentUri)
            ?: throw IOException("no stream for ${row.contentUri}")
        val sha = input.use { FileOutputStream(tmp).use { out -> BackupPlan.copyAndHash(it, out) } }
        if (tmp.length() != row.size) {
            // MediaStore's size is stale (file still being written, or edited since the
            // scan); the next scan will see the new size and pick it up again.
            tmp.delete()
            throw IOException("size changed while reading ${row.name}")
        }
        return Staged(tmp, sha)
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
        private const val WORK_NAME = "camera_upload_periodic"
        private const val WORK_ONCE = "camera_upload_once"
        private const val WORK_CONTINUE = "camera_upload_continue"
        private const val CHANNEL_ID = "camera_upload"
        private const val NOTIF_ID = 42
        /** Rows taken per scan; the run loops until a scan finds nothing pending. */
        private const val BATCH = 200
        /** After this a run hands over to a continuation rather than keep its foreground
         *  service alive: Android 14+ allows dataSync services about 6 h per day. */
        private const val RUN_BUDGET_MS = 30L * 60 * 1000
        private const val RECONCILE_EVERY_MS = 24L * 60 * 60 * 1000

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
            syncNow(context, wifiOnly)
        }

        fun cancel(context: Context) {
            val wm = WorkManager.getInstance(context)
            wm.cancelUniqueWork(WORK_NAME)
            wm.cancelUniqueWork(WORK_ONCE)
            wm.cancelUniqueWork(WORK_CONTINUE)
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
    }
}
