package expo.modules.syncservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Keeps the app's process in the foreground while a Pattern Hub sync runs, so
 * Android doesn't freeze or kill it in the background; the sync itself is the
 * app's own JS + Expo's UploadTask. It shows one ongoing notification with the
 * progress; tapping it opens the app. Started and updated by SyncServiceModule.
 */
class SyncService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = build(this, intent?.getStringExtra(EXTRA_TEXT) ?: "", intent?.getIntExtra(EXTRA_PERCENT, -1) ?: -1)
    val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0
    ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
    return START_NOT_STICKY
  }

  // Android 15 caps a dataSync service at 6 h a day: stop instead of crashing.
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  companion object {
    const val CHANNEL_ID = "pattern-sync"
    const val NOTIFICATION_ID = 4107
    const val EXTRA_TEXT = "text"
    const val EXTRA_PERCENT = "percent"

    fun build(context: Context, text: String, percent: Int): Notification {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Pattern sync", NotificationManager.IMPORTANCE_LOW))
      }
      val open = context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      }
      return NotificationCompat.Builder(context, CHANNEL_ID)
        .setSmallIcon(R.drawable.dw_sync_notification)
        .setContentTitle("Syncing patterns")
        .setContentText(text)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(open)
        .setProgress(100, percent.coerceIn(0, 100), percent < 0)
        .build()
    }
  }
}
