package io.github.illyamoore.homespace.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import io.github.illyamoore.homespace.MainActivity
import io.github.illyamoore.homespace.R
import io.github.illyamoore.homespace.data.Session

/**
 * The one thing a phone can do that a browser tab cannot: tell you an agent
 * finished while you were somewhere else.
 */
object Notifications {

    const val CHANNEL_SESSIONS = "sessions"
    const val EXTRA_SESSION_ID = "sessionId"

    fun createChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_SESSIONS,
            context.getString(R.string.notification_channel_sessions),
            NotificationManager.IMPORTANCE_DEFAULT,
        ).apply {
            description = context.getString(R.string.notification_channel_sessions_description)
            setShowBadge(true)
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    fun sessionFinished(context: Context, session: Session) {
        if (!canPost(context)) return

        val failed = session.status == "error" || session.lastError != null
        val title = if (failed) "${session.title} failed" else "${session.title} finished"
        val body = when {
            !session.lastError.isNullOrBlank() -> session.lastError.take(160)
            session.turns > 0 -> "${session.turns} turn${if (session.turns == 1) "" else "s"} · tap to read the transcript"
            else -> "Tap to read the transcript"
        }

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            putExtra(EXTRA_SESSION_ID, session.id)
        }
        val pending = PendingIntent.getActivity(
            context,
            session.id.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_SESSIONS)
            .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .build()

        // A revoked permission races with canPost() on some OEM builds; the
        // throw is documented and must not take the process down.
        runCatching {
            NotificationManagerCompat.from(context).notify(session.id.hashCode(), notification)
        }
    }
}
