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
    primaryContainer = Color(0xFFD3E3FF),
    onPrimaryContainer = Color(0xFF001B44),
    secondary = Color(0xFF0284C7),
    // Selection fills read through secondaryContainer; the web uses
    // primary at 18% alpha, so these stay in the azure family — the
    // M3 defaults are purple and must not leak through.
    secondaryContainer = Color(0xFFCFE0FC),
    onSecondaryContainer = Color(0xFF10294E),
    tertiary = Color(0xFF02C0FA),
    tertiaryContainer = Color(0xFFC4ECFC),
    onTertiaryContainer = Color(0xFF08374A),
    background = Color(0xFFFAFBFD),
    onBackground = Color(0xFF1A1C1E),
    surface = Color(0xFFFAFBFD),
    surfaceVariant = Color(0xFFE1E5EA),
    onSurfaceVariant = Color(0xFF5A6068),
    inverseSurface = Color(0xFF303236),
    inverseOnSurface = Color(0xFFF0F0F1),
    inversePrimary = Color(0xFF9CC1FF),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF6FA8FF),
    onPrimary = Color(0xFF0A1A33),
    primaryContainer = Color(0xFF0A3D8F),
    onPrimaryContainer = Color(0xFFD6E4FF),
    secondary = Color(0xFF38BDF8),
    onSecondary = Color(0xFF062A3A),
    secondaryContainer = Color(0xFF1E3A5F),
    onSecondaryContainer = Color(0xFFD6E4FF),
    tertiary = Color(0xFF67E8F9),
    onTertiary = Color(0xFF062A33),
    tertiaryContainer = Color(0xFF0C4A5E),
    onTertiaryContainer = Color(0xFFB6EFFF),
    background = Color(0xFF121417),
    onBackground = Color(0xFFE3E5E8),
    surface = Color(0xFF121417),
    surfaceVariant = Color(0xFF3B3E43),
    onSurfaceVariant = Color(0xFFC4C8CC),
    inverseSurface = Color(0xFFE3E5E8),
    inverseOnSurface = Color(0xFF1A1C1E),
    inversePrimary = Color(0xFF056FEE),
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
