package io.github.illyamoore.homespace.ui

import io.github.illyamoore.homespace.ui.components.formatBytes
import io.github.illyamoore.homespace.ui.components.formatCost
import io.github.illyamoore.homespace.ui.components.formatDurationMs
import io.github.illyamoore.homespace.ui.components.formatRelative
import io.github.illyamoore.homespace.ui.components.formatUptime
import java.time.Instant
import org.junit.Assert.assertEquals
import org.junit.Test

class FormatTest {

    @Test
    fun `bytes scale into the units a NAS actually uses`() {
        assertEquals("0 B", formatBytes(0))
        assertEquals("512 B", formatBytes(512))
        assertEquals("1.0 KB", formatBytes(1024))
        assertEquals("1.5 KB", formatBytes(1536))
        assertEquals("1.0 GB", formatBytes(1024L * 1024 * 1024))
        assertEquals("2.0 TB", formatBytes(2L * 1024 * 1024 * 1024 * 1024))
    }

    @Test
    fun `large values in a unit drop the decimal`() {
        assertEquals("500 KB", formatBytes(512_000))
    }

    @Test
    fun `a negative size is not rendered as a number`() {
        assertEquals("—", formatBytes(-1))
    }

    @Test
    fun `relative times read the way a person would say them`() {
        val now = Instant.parse("2026-01-01T12:00:00Z")
        assertEquals("just now", formatRelative("2026-01-01T11:59:57Z", now))
        assertEquals("30s ago", formatRelative("2026-01-01T11:59:30Z", now))
        assertEquals("5m ago", formatRelative("2026-01-01T11:55:00Z", now))
        assertEquals("3h ago", formatRelative("2026-01-01T09:00:00Z", now))
        assertEquals("2d ago", formatRelative("2025-12-30T12:00:00Z", now))
    }

    @Test
    fun `a future timestamp from clock skew reads as just now, not a negative`() {
        val now = Instant.parse("2026-01-01T12:00:00Z")
        assertEquals("just now", formatRelative("2026-01-01T12:00:30Z", now))
    }

    @Test
    fun `an unparseable or absent timestamp does not throw`() {
        assertEquals("—", formatRelative(null))
        assertEquals("—", formatRelative(""))
        assertEquals("—", formatRelative("yesterday"))
    }

    @Test
    fun `uptime picks sensible units`() {
        assertEquals("45m", formatUptime(2_700))
        assertEquals("3h 0m", formatUptime(10_800))
        assertEquals("2d 3h", formatUptime(2 * 86_400 + 3 * 3_600))
    }

    @Test
    fun `a cost too small to matter is not shown as zero dollars`() {
        assertEquals("—", formatCost(0.0))
        assertEquals("$0.1979", formatCost(0.19793))
    }

    @Test
    fun `durations switch from millis to seconds`() {
        assertEquals("450ms", formatDurationMs(450))
        assertEquals("6.4s", formatDurationMs(6_369))
    }
}
