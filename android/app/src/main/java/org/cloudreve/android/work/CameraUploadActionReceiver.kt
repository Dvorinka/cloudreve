package org.cloudreve.android.work

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Buttons on the camera-backup notifications. Pause drops all queued work
 * (periodic included — [CameraUploadWorker.resume] re-arms it) and leaves a
 * dismissible "paused" notification carrying the Resume action, so the user
 * always has a way back without opening the app.
 */
class CameraUploadActionReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val result = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                when (intent.action) {
                    ACTION_PAUSE -> {
                        CameraUploadWorker.pause(context)
                        pausedNotification(context)
                    }
                    ACTION_RESUME -> CameraUploadWorker.resume(context)
                }
            } finally {
                result.finish()
            }
        }
    }

    private fun pausedNotification(context: Context) {
        CameraUploadWorker.ensureChannel(context)
        val resume = PendingIntent.getBroadcast(
            context, 1,
            Intent(context, CameraUploadActionReceiver::class.java).setAction(ACTION_RESUME),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(context, CameraUploadWorker.CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle("Camera backup paused")
            .setContentText("Photos stay on this device until you resume")
            .setAutoCancel(true)
            .addAction(0, "Resume", resume)
            .build()
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(CameraUploadWorker.PAUSED_NOTIF_ID, notification)
    }

    companion object {
        const val ACTION_PAUSE = "org.cloudreve.android.camera_upload.PAUSE"
        const val ACTION_RESUME = "org.cloudreve.android.camera_upload.RESUME"
    }
}
