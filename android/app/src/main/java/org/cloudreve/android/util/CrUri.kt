package org.cloudreve.android.util

import java.net.URLDecoder
import java.net.URLEncoder

/**
 * CrUri builds and manipulates `cloudreve://` URIs the same way the desktop
 * client does: segments are percent-encoded individually, "/" stays.
 */
object CrUri {
    const val MY_PREFIX = "cloudreve://my"

    fun join(parent: String, name: String): String {
        val encoded = name.split('/').filter { it.isNotEmpty() }
            .joinToString("/") { URLEncoder.encode(it, "UTF-8").replace("+", "%20") }
        return if (parent.endsWith('/')) parent + encoded else "$parent/$encoded"
    }

    fun child(parent: String, name: String): String = join(parent, name)

    fun parent(uri: String): String {
        val trimmed = uri.trimEnd('/')
        val idx = trimmed.lastIndexOf('/')
        return if (idx <= MY_PREFIX.length) MY_PREFIX else trimmed.substring(0, idx)
    }

    fun fileName(uri: String): String {
        val seg = uri.trimEnd('/').substringAfterLast('/')
        return URLDecoder.decode(seg, "UTF-8")
    }

    fun isRoot(uri: String): Boolean = uri.trimEnd('/') == MY_PREFIX

    const val ROOT_LABEL = "My files"

    /** Display name of the folder at [uri]: its last segment, or "My files" at the root. */
    fun displayName(uri: String): String = if (isRoot(uri)) ROOT_LABEL else fileName(uri)

    /** Display name of the folder containing [path]. */
    fun parentDisplayName(path: String): String = displayName(parent(path))

    /** "My files / Photos / 2025" for breadcrumb-style subtitles. */
    fun displayPath(uri: String): String {
        val rel = uri.removePrefix(MY_PREFIX).trim('/')
        return if (rel.isEmpty()) ROOT_LABEL
        else ROOT_LABEL + " / " + URLDecoder.decode(rel, "UTF-8").replace("/", " / ")
    }
}
