package io.github.illyamoore.homespace.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors

/** A bordered surface. Elevation reads badly on the near-black ground, so the
 *  whole app separates panels with a hairline border instead of a shadow. */
@Composable
fun HsCard(
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit,
) {
    val colors = LocalHomeSpaceColors.current
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, colors.border, RoundedCornerShape(14.dp))
            .padding(14.dp),
        content = content,
    )
}

/** Small uppercase heading, matching the web dashboard's section labels. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text.uppercase(),
        style = MaterialTheme.typography.labelSmall,
        color = LocalHomeSpaceColors.current.textMuted,
        modifier = modifier,
    )
}

/**
 * Status pill. `working` pulses, because a static badge is indistinguishable
 * from a stalled one and "is it still going?" is the question the operator has
 * most often.
 */
@Composable
fun StatusBadge(status: String, modifier: Modifier = Modifier) {
    val colors = LocalHomeSpaceColors.current
    val tint = when (status) {
        "working" -> colors.warning
        "running", "idle" -> colors.success
        "error" -> MaterialTheme.colorScheme.error
        else -> colors.textMuted
    }

    val alpha = if (status == "working") {
        val transition = rememberInfiniteTransition(label = "pulse")
        transition.animateFloat(
            initialValue = 1f,
            targetValue = 0.25f,
            animationSpec = infiniteRepeatable(tween(1100), RepeatMode.Reverse),
            label = "pulseAlpha",
        ).value
    } else {
        1f
    }

    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(5.dp),
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    ) {
        Box(
            Modifier
                .size(6.dp)
                .clip(RoundedCornerShape(999.dp))
                .background(tint.copy(alpha = alpha)),
        )
        Text(status, style = MaterialTheme.typography.labelSmall, color = tint)
    }
}

/** Neutral informational chip. */
@Composable
fun Chip(text: String, modifier: Modifier = Modifier, tint: Color? = null) {
    Text(
        text = text,
        style = MaterialTheme.typography.labelSmall,
        color = tint ?: MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier
            .clip(RoundedCornerShape(999.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(horizontal = 8.dp, vertical = 3.dp),
    )
}

@Composable
fun Meter(fraction: Float, modifier: Modifier = Modifier, tint: Color? = null) {
    val colors = LocalHomeSpaceColors.current
    val resolved = tint ?: when {
        fraction > 0.9f -> MaterialTheme.colorScheme.error
        fraction > 0.75f -> colors.warning
        else -> colors.success
    }
    LinearProgressIndicator(
        progress = { fraction.coerceIn(0f, 1f) },
        color = resolved,
        trackColor = MaterialTheme.colorScheme.surfaceContainerHigh,
        drawStopIndicator = {},
        gapSize = 0.dp,
        modifier = modifier
            .fillMaxWidth()
            .height(5.dp)
            .clip(RoundedCornerShape(3.dp)),
    )
}

/** Placeholder for a list that is legitimately empty, as opposed to loading. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier, detail: String? = null) {
    val colors = LocalHomeSpaceColors.current
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textMuted,
            textAlign = TextAlign.Center,
        )
        if (detail != null) {
            Text(
                detail,
                style = MaterialTheme.typography.bodySmall,
                color = colors.textMuted,
                textAlign = TextAlign.Center,
            )
        }
    }
}
