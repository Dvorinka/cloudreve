package org.cloudreve.android.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.cloudreve.android.CloudreveApp

/**
 * Re-arms the scheduled workers after a reboot. WorkManager already persists
 * its queue, so this covers the cases it cannot: a wiped work database, an
 * OEM killer that dropped it, or a schedule the user cancelled.
 */
class BootReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val app = context.applicationContext as CloudreveApp
        val result = goAsync()
        CoroutineScope(SupervisorJob() + Dispatchers.IO).launch {
            try {
                val cam = app.cameraUploadSettings.snapshotNow()
                if (cam.enabled) CameraUploadWorker.apply(context, cam.wifiOnly)
                val sync = app.syncFolderSettings.snapshotNow()
                if (sync.enabled) SyncFolderWorker.apply(context, sync.wifiOnly)
                if (app.taskNotifySettings.enabledNow()) TaskPollWorker.apply(context)
            } finally {
                result.finish()
            }
        }
    }
}
