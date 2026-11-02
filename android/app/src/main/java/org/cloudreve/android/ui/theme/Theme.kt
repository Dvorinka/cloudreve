package org.cloudreve.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color

// Every overridden surface sets its matching `on*` colour. Overriding `surface` alone
// leaves Material's defaults for text, which were tuned for a different surface and
// render as low-contrast grey on our near-black; typed text in OutlinedTextField uses
// onSurface and labels use onSurfaceVariant, so both must be set together.
private val LightColors = lightColorScheme(
    primary = Color(0xFF4A6FA5),
    secondary = Color(0xFF6B8BB8),
    background = Color(0xFFFAFBFD),
    onBackground = Color(0xFF1A1C1E),
    surface = Color(0xFFFAFBFD),
    onSurface = Color(0xFF1A1C1E),
    surfaceVariant = Color(0xFFE2E6ED),
    onSurfaceVariant = Color(0xFF444850),
    outline = Color(0xFF757B86),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFF9DB8DC),
    secondary = Color(0xFF8AA4CC),
    background = Color(0xFF121417),
    onBackground = Color(0xFFE3E5E8),
    surface = Color(0xFF121417),
    onSurface = Color(0xFFE3E5E8),
    surfaceVariant = Color(0xFF2A2E34),
    onSurfaceVariant = Color(0xFFC2C6CD),
    outline = Color(0xFF8B9099),
)

@Composable
fun CloudreveTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = if (isSystemInDarkTheme()) DarkColors else LightColors,
    ) {
        // Paint the whole window with the scheme's background. Without this the
        // Compose tree inherits the Activity window colour from themes.xml, which does
        // not follow the colour scheme: in dark mode the text turned light while the
        // window stayed light, leaving the login form light grey on white.
        Surface(
            modifier = Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onBackground,
            content = content,
        )
    }
}
