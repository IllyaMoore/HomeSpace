package io.github.illyamoore.homespace

import android.app.Application
import io.github.illyamoore.homespace.notify.Notifications

class HomeSpaceApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // The channel must exist before the first notification is posted, and
        // creating it is cheap and idempotent.
        Notifications.createChannel(this)
    }
}
