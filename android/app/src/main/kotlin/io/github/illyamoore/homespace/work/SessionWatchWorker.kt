package io.github.illyamoore.homespace.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.illyamoore.homespace.data.HomeSpaceClient
import io.github.illyamoore.homespace.data.ServerStore
import io.github.illyamoore.homespace.data.Session
import io.github.illyamoore.homespace.notify.Notifications
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.flow.first

/**
 * Checks the last-used NAS while the app is closed and notifies about sessions
 * that finished since the previous check.
 *
 * WorkManager's periodic floor is 15 minutes, and the OS may stretch that
 * further under Doze — so this is a catch-up, not a live feed. While the app is
 * open the SSE stream notifies immediately; this only covers the gap after the
 * process is gone.
 */
class SessionWatchWorker(
    context: Context,
    params: WorkerParameters,
) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val store = ServerStore(applicationContext)
        val saved = store.lastUsed() ?: return Result.success()
        if (!Notifications.canPost(applicationContext)) return Result.success()

        val client = HomeSpaceClient(saved.toRef())
        val sessions = try {
            client.sessions().sessions
        } catch (_: Exception) {
            // The NAS is asleep or off the network. Retrying on a schedule the
            // OS already controls is pointless; wait for the next period.
            return Result.success()
        }

        val prefs = applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val seen = prefs.getStringSet(KEY_NOTIFIED, emptySet()).orEmpty()
        val finished = sessions.filter { it.isFinished }
        val fresh = finished.filterNot { seen.contains(it.fingerprint) }

        fresh.forEach { Notifications.sessionFinished(applicationContext, it) }

        // Remember by fingerprint, not id: the same session finishing a later
        // turn should notify again, but the same completion should not.
        prefs.edit()
            .putStringSet(KEY_NOTIFIED, finished.map { it.fingerprint }.toSet())
            .apply()

        return Result.success()
    }

    private val Session.isFinished: Boolean
        get() = status == "idle" || status == "exited" || status == "error"

    private val Session.fingerprint: String
        get() = "$id@$status@$turns"

    companion object {
        private const val NAME = "homespace-session-watch"
        private const val PREFS = "homespace-watch"
        private const val KEY_NOTIFIED = "notified"

        fun enqueue(context: Context) {
            val request = PeriodicWorkRequestBuilder<SessionWatchWorker>(15, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiredNetworkType(NetworkType.CONNECTED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
