package org.cloudreve.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

// Every overridden surface sets its matching `on*` colour. Overriding `surface` alone
// leaves Material's defaults for text, which were tuned for a different surface and
// render as low-contrast grey on our near-black; typed text in OutlinedTextField uses
// onSurface and labels use onSurfaceVariant, so both must be set together.
// Brand palette sampled from the app icon: azure #056FEE with cyan #02C0FA
// accents. Dark mode lifts the primary toward the cyan end for contrast on
// the near-black surfaces.
private val LightColors = lightColorScheme(
    primary = Color(0xFF056FEE),
    onPrimary = Color(0xFFFFFFFF),
    secondary = Color(0xFF0284C7),
    tertiary = Color(0xFF02C0FA),
    background = Color(0xFFFAFBFD),
    onBackground = Color(0xFF1A1C1E),
    surface = Color(0xFFFAFBFD),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF6FA8FF),
    onPrimary = Color(0xFF0A1A33),
    secondary = Color(0xFF38BDF8),
    onSecondary = Color(0xFF062A3A),
    tertiary = Color(0xFF67E8F9),
    onTertiary = Color(0xFF062A33),
    background = Color(0xFF121417),
    onBackground = Color(0xFFE3E5E8),
    surface = Color(0xFF121417),
)

/**
 * Material You: follow the wallpaper palette like the system Files app on
 * Android 12+, fall back to the Cloudreve brand palette below that.
 */
@Composable
fun CloudreveTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    val scheme = when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> DarkColors
        else -> LightColors
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
