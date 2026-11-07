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

private val timeFormat = DateTimeFormatter.ofPattern("HH:mm", Locale.getDefault())
private val dayMonthFormat = DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())
private val fullFormat = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.getDefault())

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
        date == today -> timeFormat.format(instant.atZone(zone))
        date.year == today.year -> dayMonthFormat.format(date)
        else -> fullFormat.format(date)
    }
}

/** "12.6 kB • 7 Nov" for files, just the date for folders. */
fun subtitleFor(size: Long, updatedAt: String, isFolder: Boolean): String {
    val date = formatDate(updatedAt)
    return when {
        isFolder -> date
        date.isEmpty() -> formatSize(size)
        else -> "${formatSize(size)} • $date"
    }
}
