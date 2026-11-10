package org.cloudreve.android.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

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
 * Always the Cloudreve brand palette — the product should look like Cloudreve
 * on every device, not like the wallpaper-tinted system Files app. Material You
 * dynamic colours would replace the brand azure with whatever the wallpaper
 * dictates, which is how the app drifted into an anonymous grey look.
 */
@Composable
fun CloudreveTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val scheme = if (dark) DarkColors else LightColors
    // Edge-to-edge draws under the status bar, so its icons must follow our
    // surface, not the wallpaper: dark icons on the light theme and vice versa.
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            (view.context as? Activity)?.window?.let { window ->
                val controller = WindowCompat.getInsetsController(window, view)
                controller.isAppearanceLightStatusBars = !dark
                controller.isAppearanceLightNavigationBars = !dark
            }
        }
    }
    MaterialTheme(colorScheme = scheme, content = content)
}
