package io.github.illyamoore.homespace.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat
import io.github.illyamoore.homespace.data.ThemeChoice

/**
 * The same palette as the web dashboard — warm near-black or near-white ground,
 * one red accent, a four-step text ramp — expressed as Material 3 roles.
 *
 * Dynamic colour is deliberately not used: the two clients should look like the
 * same product on any device, and the red accent carries meaning (it marks the
 * primary action and every destructive one).
 */

private object Palette {
    // Dark
    val darkSurface0 = Color(0xFF0E0E0C)
    val darkSurface1 = Color(0xFF161614)
    val darkSurface2 = Color(0xFF1E1E1B)
    val darkSurface3 = Color(0xFF2A2A26)
    val darkBorder = Color(0xFF3A3A34)
    val darkTextPrimary = Color(0xFFE8E6E1)
    val darkTextSecondary = Color(0xFFA3A09A)
    val darkTextMuted = Color(0xFF6B6862)
    val darkPrimary = Color(0xFFEF4444)
    val darkPrimaryContainer = Color(0xFF3B1111)

    // Light
    val lightSurface0 = Color(0xFFF4F4F1)
    val lightSurface1 = Color(0xFFF9F9F7)
    val lightSurface2 = Color(0xFFF0F0EC)
    val lightSurface3 = Color(0xFFE5E5E0)
    val lightBorder = Color(0xFFD8D8D1)
    val lightTextPrimary = Color(0xFF111111)
    val lightTextSecondary = Color(0xFF404040)
    val lightTextMuted = Color(0xFF737373)
    val lightPrimary = Color(0xFFCC0000)
    val lightPrimaryContainer = Color(0xFFFEE2E2)
}

/** Roles Material 3 has no slot for but the app uses consistently. */
data class HomeSpaceColors(
    val textMuted: Color,
    val success: Color,
    val warning: Color,
    val info: Color,
    val surfaceRaised: Color,
    val border: Color,
    val isDark: Boolean,
)

val LocalHomeSpaceColors = staticCompositionLocalOf {
    HomeSpaceColors(
        textMuted = Palette.darkTextMuted,
        success = Color(0xFF34D399),
        warning = Color(0xFFFBBF24),
        info = Color(0xFF60A5FA),
        surfaceRaised = Palette.darkSurface2,
        border = Palette.darkBorder,
        isDark = true,
    )
}

private val DarkScheme = darkColorScheme(
    primary = Palette.darkPrimary,
    onPrimary = Color.White,
    primaryContainer = Palette.darkPrimaryContainer,
    onPrimaryContainer = Palette.darkTextPrimary,
    secondary = Palette.darkTextSecondary,
    onSecondary = Palette.darkSurface0,
    background = Palette.darkSurface0,
    onBackground = Palette.darkTextPrimary,
    surface = Palette.darkSurface1,
    onSurface = Palette.darkTextPrimary,
    surfaceVariant = Palette.darkSurface2,
    onSurfaceVariant = Palette.darkTextSecondary,
    surfaceContainer = Palette.darkSurface2,
    surfaceContainerHigh = Palette.darkSurface3,
    surfaceContainerHighest = Palette.darkSurface3,
    surfaceContainerLow = Palette.darkSurface1,
    surfaceContainerLowest = Palette.darkSurface0,
    outline = Palette.darkBorder,
    outlineVariant = Palette.darkSurface3,
    error = Palette.darkPrimary,
    onError = Color.White,
    errorContainer = Palette.darkPrimaryContainer,
    onErrorContainer = Palette.darkTextPrimary,
)

private val LightScheme = lightColorScheme(
    primary = Palette.lightPrimary,
    onPrimary = Color.White,
    primaryContainer = Palette.lightPrimaryContainer,
    onPrimaryContainer = Palette.lightTextPrimary,
    secondary = Palette.lightTextSecondary,
    onSecondary = Color.White,
    background = Palette.lightSurface0,
    onBackground = Palette.lightTextPrimary,
    surface = Palette.lightSurface1,
    onSurface = Palette.lightTextPrimary,
    surfaceVariant = Palette.lightSurface2,
    onSurfaceVariant = Palette.lightTextSecondary,
    surfaceContainer = Palette.lightSurface2,
    surfaceContainerHigh = Palette.lightSurface3,
    surfaceContainerHighest = Palette.lightSurface3,
    surfaceContainerLow = Palette.lightSurface1,
    surfaceContainerLowest = Palette.lightSurface0,
    outline = Palette.lightBorder,
    outlineVariant = Palette.lightSurface3,
    error = Palette.lightPrimary,
    onError = Color.White,
    errorContainer = Palette.lightPrimaryContainer,
    onErrorContainer = Palette.lightTextPrimary,
)

/** Monospace is load-bearing here: paths, tokens, model ids and transcripts all
 *  need to be scannable and to not reflow between renders. */
val MonoStyle = TextStyle(fontFamily = FontFamily.Monospace)

private val HomeSpaceTypography = Typography(
    headlineSmall = TextStyle(fontSize = 20.sp, fontWeight = FontWeight.Bold, letterSpacing = (-0.4).sp),
    titleLarge = TextStyle(fontSize = 18.sp, fontWeight = FontWeight.SemiBold, letterSpacing = (-0.3).sp),
    titleMedium = TextStyle(fontSize = 15.sp, fontWeight = FontWeight.SemiBold),
    titleSmall = TextStyle(fontSize = 13.sp, fontWeight = FontWeight.Medium),
    bodyLarge = TextStyle(fontSize = 15.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 12.sp, lineHeight = 17.sp),
    labelLarge = TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, fontWeight = FontWeight.Medium, letterSpacing = 0.6.sp),
)

@Composable
fun HomeSpaceTheme(
    choice: ThemeChoice = ThemeChoice.SYSTEM,
    content: @Composable () -> Unit,
) {
    val dark = when (choice) {
        ThemeChoice.DARK -> true
        ThemeChoice.LIGHT -> false
        ThemeChoice.SYSTEM -> isSystemInDarkTheme()
    }
    val scheme = if (dark) DarkScheme else LightScheme
    val extras = if (dark) {
        HomeSpaceColors(
            textMuted = Palette.darkTextMuted,
            success = Color(0xFF34D399),
            warning = Color(0xFFFBBF24),
            info = Color(0xFF60A5FA),
            surfaceRaised = Palette.darkSurface2,
            border = Palette.darkBorder,
            isDark = true,
        )
    } else {
        HomeSpaceColors(
            textMuted = Palette.lightTextMuted,
            success = Color(0xFF047857),
            warning = Color(0xFFB45309),
            info = Color(0xFF1D4ED8),
            surfaceRaised = Palette.lightSurface2,
            border = Palette.lightBorder,
            isDark = false,
        )
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        val context = LocalContext.current
        SideEffect {
            val window = (context as? Activity)?.window ?: return@SideEffect
            // Edge-to-edge is set in the Activity; this only keeps the status
            // bar icons legible when the theme flips at runtime.
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }

    CompositionLocalProvider(LocalHomeSpaceColors provides extras) {
        MaterialTheme(colorScheme = scheme, typography = HomeSpaceTypography, content = content)
    }
}
