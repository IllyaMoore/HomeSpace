package io.github.illyamoore.homespace.ui.components

import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import java.util.Locale
import kotlin.math.abs
import kotlin.math.ln
import kotlin.math.pow

/** Byte counts, sized to what a NAS actually holds. */
fun formatBytes(bytes: Long): String {
    if (bytes <= 0) return if (bytes == 0L) "0 B" else "—"
    val units = listOf("B", "KB", "MB", "GB", "TB", "PB")
    val power = (ln(bytes.toDouble()) / ln(1024.0)).toInt().coerceIn(0, units.lastIndex)
    val value = bytes / 1024.0.pow(power)
    return if (value >= 100 || power == 0) {
        "${value.toInt()} ${units[power]}"
    } else {
        String.format(Locale.US, "%.1f %s", value, units[power])
    }
}

/** "3m ago". Returns "—" rather than throwing on a timestamp it cannot read,
 *  because a malformed date from the server should not blank a whole list. */
fun formatRelative(iso: String?, now: Instant = Instant.now()): String {
    if (iso.isNullOrBlank()) return "—"
    val then = try {
        Instant.parse(iso)
    } catch (_: DateTimeParseException) {
        return "—"
    }
    val seconds = Duration.between(then, now).seconds
    // Clock skew between phone and NAS can make a fresh event look future-dated.
    if (seconds < 0) return "just now"
    return when {
        seconds < 10 -> "just now"
        seconds < 60 -> "${seconds}s ago"
        seconds < 3600 -> "${seconds / 60}m ago"
        seconds < 86_400 -> "${seconds / 3600}h ago"
        else -> "${seconds / 86_400}d ago"
    }
}

/** Uptime, in the units a person would say out loud. */
fun formatUptime(seconds: Long): String {
    val days = seconds / 86_400
    val hours = (seconds % 86_400) / 3600
    val minutes = (seconds % 3600) / 60
    return when {
        days > 0 -> "${days}d ${hours}h"
        hours > 0 -> "${hours}h ${minutes}m"
        else -> "${minutes}m"
    }
}

fun formatCount(value: Long): String = String.format(Locale.US, "%,d", value)

fun formatCost(usd: Double): String =
    if (abs(usd) < 0.0001) "—" else String.format(Locale.US, "$%.4f", usd)

fun formatDurationMs(ms: Long): String =
    if (ms < 1000) "${ms}ms" else String.format(Locale.US, "%.1fs", ms / 1000.0)
