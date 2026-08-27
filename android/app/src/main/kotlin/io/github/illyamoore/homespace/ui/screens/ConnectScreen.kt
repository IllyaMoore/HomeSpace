package io.github.illyamoore.homespace.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import io.github.illyamoore.homespace.data.SavedServer
import io.github.illyamoore.homespace.ui.HomeSpaceViewModel
import io.github.illyamoore.homespace.ui.components.HsCard
import io.github.illyamoore.homespace.ui.components.SectionLabel
import io.github.illyamoore.homespace.ui.theme.LocalHomeSpaceColors
import io.github.illyamoore.homespace.ui.theme.MonoStyle

/**
 * The pairing gate. Nothing else in the app renders until a daemon has answered
 * and accepted the token.
 */
@Composable
fun ConnectScreen(
    viewModel: HomeSpaceViewModel,
    savedServers: List<SavedServer>,
    onConnected: () -> Unit,
) {
    val colors = LocalHomeSpaceColors.current
    var address by remember { mutableStateOf(savedServers.firstOrNull()?.baseUrl ?: "") }
    var token by remember { mutableStateOf("") }
    var tokenVisible by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun attempt(name: String, url: String, secret: String) {
        error = null
        busy = true
        viewModel.connect(name, url, secret) { ok ->
            busy = false
            if (ok) onConnected() else error = "could not connect — check the address and token"
        }
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier = Modifier
                .widthIn(max = 460.dp)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                Icon(
                    Icons.Default.Home,
                    contentDescription = null,
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(26.dp),
                )
                Text("HomeSpace", style = MaterialTheme.typography.headlineSmall)
            }

            Text(
                "Browse your NAS, run Claude Code sessions on it, and drive code agents.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            HsCard {
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it; error = null },
                    label = { Text("NAS address") },
                    placeholder = { Text("nas.local:7333") },
                    singleLine = true,
                    textStyle = MonoStyle.merge(MaterialTheme.typography.bodyMedium),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Uri,
                        imeAction = ImeAction.Next,
                        autoCorrectEnabled = false,
                    ),
                    supportingText = { Text("Host and port the daemon listens on.") },
                    isError = error != null,
                    modifier = Modifier.fillMaxWidth(),
                )

                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it; error = null },
                    label = { Text("Access token") },
                    singleLine = true,
                    textStyle = MonoStyle.merge(MaterialTheme.typography.bodyMedium),
                    visualTransformation =
                        if (tokenVisible) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(
                        keyboardType = KeyboardType.Password,
                        imeAction = ImeAction.Done,
                        autoCorrectEnabled = false,
                    ),
                    trailingIcon = {
                        IconButton(onClick = { tokenVisible = !tokenVisible }) {
                            Icon(
                                if (tokenVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                                contentDescription = if (tokenVisible) "Hide token" else "Show token",
                            )
                        }
                    },
                    supportingText = { Text("Run `homespace token` on the NAS.") },
                    isError = error != null,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                )

                // Cleartext is the norm for a LAN daemon, but the token is a
                // credential and the operator should know it is unprotected.
                if (address.trim().startsWith("http://", ignoreCase = true) ||
                    (address.isNotBlank() && !address.trim().startsWith("https://", ignoreCase = true))
                ) {
                    Row(
                        modifier = Modifier.padding(top = 10.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Icon(
                            Icons.Default.Warning,
                            contentDescription = null,
                            tint = colors.warning,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            "Unencrypted connection — only use this on a network you trust.",
                            style = MaterialTheme.typography.bodySmall,
                            color = colors.textMuted,
                        )
                    }
                }

                if (error != null) {
                    Text(
                        error!!,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }

                Button(
                    onClick = { attempt("HomeSpace", address, token) },
                    enabled = !busy && address.isNotBlank() && token.isNotBlank(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 14.dp),
                ) {
                    if (busy) {
                        CircularProgressIndicator(
                            strokeWidth = 2.dp,
                            modifier = Modifier.size(16.dp),
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                    } else {
                        Text("Connect")
                    }
                }
            }

            if (savedServers.isNotEmpty()) {
                SectionLabel("Saved servers", Modifier.padding(top = 6.dp))
                savedServers.forEach { server ->
                    HsCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text(server.name, style = MaterialTheme.typography.titleSmall)
                                Text(
                                    server.baseUrl,
                                    style = MonoStyle.merge(MaterialTheme.typography.bodySmall),
                                    color = colors.textMuted,
                                )
                            }
                            TextButton(onClick = { viewModel.forgetServer(server.id) }) { Text("Forget") }
                            OutlinedButton(
                                enabled = !busy,
                                onClick = {
                                    busy = true
                                    error = null
                                    viewModel.connectSaved(server) { ok ->
                                        busy = false
                                        if (ok) onConnected() else error = "could not reach ${server.name}"
                                    }
                                },
                            ) { Text("Connect") }
                        }
                    }
                }
            }
        }
    }
}
