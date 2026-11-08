package org.cloudreve.android.ui.files

import java.text.DecimalFormat
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

fun formatSize(size: Long): String {
    if (size <= 0) return "0 B"
    val units = arrayOf("B", "kB", "MB", "GB", "TB")
    val group = (Math.log10(size.toDouble()) / Math.log10(1024.0)).toInt().coerceAtMost(units.size - 1)
    return DecimalFormat("#,##0.#").format(size / Math.pow(1024.0, group.toDouble())) + " " + units[group]
}

// Built per call so a locale change while the app is running is honoured.
private fun pattern(p: String) = DateTimeFormatter.ofPattern(p, Locale.getDefault())

/**
 * Short, Files-app-style timestamp: time of day for today, day and month
 * within the current year, otherwise with the year. Empty for unparsable input.
 */
fun formatDate(iso: String, now: Instant = Instant.now()): String {
    val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull() ?: return ""
    val zone = ZoneId.systemDefault()
    val date = instant.atZone(zone).toLocalDate()
    val today = now.atZone(zone).toLocalDate()
    return when {
        date == today -> pattern("HH:mm").format(instant.atZone(zone))
        date.year == today.year -> pattern("d MMM").format(date)
        else -> pattern("d MMM yyyy").format(date)
    }
}

/** "12.6 kB • 7 Nov" for files, just the date for folders. */
fun subtitleFor(size: Long, updatedAt: String, isFolder: Boolean, now: Instant = Instant.now()): String {
    val date = formatDate(updatedAt, now)
    return when {
        isFolder -> date
        date.isEmpty() -> formatSize(size)
        else -> "${formatSize(size)} • $date"
    }
}

/** Header label for date-grouped lists: Today, Yesterday, then "Sat, 10 Oct", with the year once it differs. */
fun dayGroupLabel(iso: String, now: Instant = Instant.now()): String {
    val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrNull() ?: return "Unknown date"
    val zone = ZoneId.systemDefault()
    val date = instant.atZone(zone).toLocalDate()
    val today = now.atZone(zone).toLocalDate()
    return when {
        date == today -> "Today"
        date == today.minusDays(1) -> "Yesterday"
        date.year == today.year -> pattern("EEE, d MMM").format(date)
        else -> pattern("d MMM yyyy").format(date)
    }
}

/** Stable key for grouping: the local calendar day. */
fun dayKey(iso: String): String =
    runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(ZoneId.systemDefault()).toLocalDate().toString() }.getOrDefault("")
