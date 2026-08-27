package io.github.illyamoore.homespace

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.illyamoore.homespace.notify.Notifications
import io.github.illyamoore.homespace.ui.HomeSpaceApp
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.theme.HomeSpaceTheme

class MainActivity : ComponentActivity() {

    /** Set when the activity is opened from a "session finished" notification. */
    private var pendingSessionId by mutableStateOf<String?>(null)

    private val requestNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { /* declined is fine */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        pendingSessionId = intent?.getStringExtra(Notifications.EXTRA_SESSION_ID)

        setContent {
            val viewModel: HomeSpaceViewModel = viewModel(factory = HomeSpaceViewModel.Factory)
            val theme by viewModel.theme.collectAsStateWithLifecycle()

            HomeSpaceTheme(choice = theme) {
                HomeSpaceApp(
                    viewModel = viewModel,
                    pendingSessionId = pendingSessionId,
                    onPendingSessionHandled = { pendingSessionId = null },
                )
            }
        }

        maybeAskForNotifications()
    }

    /** launchMode is singleTask, so a second notification tap arrives here
     *  rather than through onCreate. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.getStringExtra(Notifications.EXTRA_SESSION_ID)?.let { pendingSessionId = it }
    }

    /**
     * Asked once at launch rather than behind a rationale screen: the only
     * notification this app sends is the one the user came for, and declining
     * costs nothing but that.
     */
    private fun maybeAskForNotifications() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (Notifications.canPost(this)) return
        requestNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
}
