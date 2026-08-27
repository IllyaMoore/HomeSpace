package io.github.illyamoore.homespace

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.widget.Toast

/**
 * Two ways to get a NAS file off the phone's screen and into the rest of
 * Android: hand the URL to another app, or download it to the shared Downloads
 * folder.
 *
 * Neither can carry an Authorization header, which is why the daemon accepts
 * `?token=` on the raw-file route and the URLs built here already include it.
 */
object FileActions {

    fun open(context: Context, url: String, mimeType: String, name: String, share: Boolean) {
        if (share) viewWith(context, url, mimeType) else download(context, url, name, mimeType)
    }

    /** Send the URL to whatever app claims the type — a video player, a PDF
     *  reader. Nothing is copied to the device. */
    private fun viewWith(context: Context, url: String, mimeType: String) {
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(Uri.parse(url), mimeType.substringBefore(';').ifBlank { "*/*" })
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        val chooser = Intent.createChooser(intent, "Open with").apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(chooser) }
            .onFailure { Toast.makeText(context, "No app can open that file", Toast.LENGTH_SHORT).show() }
    }

    /**
     * DownloadManager rather than a hand-rolled fetch: it survives the app being
     * killed, shows progress in the system tray, and writes into public
     * Downloads without needing a storage permission on any supported API level.
     */
    private fun download(context: Context, url: String, name: String, mimeType: String) {
        val manager = context.getSystemService(Context.DOWNLOAD_SERVICE) as? DownloadManager
        if (manager == null) {
            Toast.makeText(context, "Downloads are unavailable on this device", Toast.LENGTH_SHORT).show()
            return
        }
        val safeName = name.replace(Regex("""[\\/:*?"<>|]"""), "_").ifBlank { "homespace-download" }
        val request = DownloadManager.Request(Uri.parse(url))
            .setTitle(safeName)
            .setDescription("Downloading from HomeSpace")
            .setMimeType(mimeType.substringBefore(';').ifBlank { null })
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(true)

        runCatching { manager.enqueue(request) }
            .onSuccess { Toast.makeText(context, "Downloading $safeName", Toast.LENGTH_SHORT).show() }
            .onFailure { Toast.makeText(context, "Could not start the download", Toast.LENGTH_SHORT).show() }
    }
}
