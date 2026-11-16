package expo.modules.syncservice

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SyncServiceModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No React context")

  override fun definition() = ModuleDefinition {
    Name("SyncService")

    // Start (or retext) the service. While the app is in the foreground this is
    // always allowed; that's the only place a sync starts.
    Function("start") { text: String ->
      val intent = Intent(context, SyncService::class.java).putExtra(SyncService.EXTRA_TEXT, text)
      ContextCompat.startForegroundService(context, intent)
    }

    // Progress, posted straight to the notification (no service restart).
    Function("update") { text: String, percent: Int ->
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      manager.notify(SyncService.NOTIFICATION_ID, SyncService.build(context, text, percent))
    }

    Function("stop") {
      context.stopService(Intent(context, SyncService::class.java))
    }
  }
}
