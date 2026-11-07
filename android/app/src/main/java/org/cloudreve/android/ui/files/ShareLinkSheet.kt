package org.cloudreve.android.ui.files

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.cloudreve.android.api.FileObject

private val EXPIRY_OPTIONS = listOf(
    "Never" to 0,
    "1 day" to 86_400,
    "7 days" to 7 * 86_400,
    "30 days" to 30 * 86_400,
)

/**
 * Share-link flow in two steps on one sheet: choose how open the link is,
 * create it, then copy or hand it to the system share sheet. Creating a
 * link is a server-side side effect, so nothing happens until "Create link".
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareLinkSheet(
    file: FileObject,
    thumbUrl: String?,
    createLink: suspend (password: String, expireSeconds: Int) -> String,
    onDismiss: () -> Unit,
    onMessage: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var usePassword by remember { mutableStateOf(false) }
    var password by remember { mutableStateOf("") }
    var expiry by remember { mutableStateOf(0) }
    var creating by remember { mutableStateOf(false) }
    var link by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 20.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            FileThumb(file, thumbUrl, size = 48.dp)
            Column(Modifier.padding(start = 16.dp)) {
                Text("Share link", style = MaterialTheme.typography.titleMedium)
                Text(file.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }

        val made = link
        if (made == null) {
            Text("Link expires", style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(start = 20.dp, top = 20.dp, bottom = 8.dp))
            Row(Modifier.padding(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                EXPIRY_OPTIONS.forEach { (label, seconds) ->
                    FilterChip(selected = expiry == seconds, onClick = { expiry = seconds }, label = { Text(label) })
                }
            }
            ListItem(
                modifier = Modifier
                    .padding(top = 8.dp)
                    .clickable { usePassword = !usePassword },
                headlineContent = { Text("Require a password") },
                supportingContent = { Text(if (usePassword) "Included in the link; recipients open it without typing" else "Anyone with the link can open it") },
                trailingContent = { Switch(checked = usePassword, onCheckedChange = { usePassword = it }) },
                colors = ListItemDefaults.colors(containerColor = Color.Transparent),
            )
            if (usePassword) {
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it.take(32) },
                    label = { Text("Password") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp),
                )
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp, vertical = 20.dp),
                horizontalArrangement = Arrangement.End,
            ) {
                Button(
                    enabled = !creating && (!usePassword || password.isNotBlank()),
                    onClick = {
                        creating = true
                        scope.launch {
                            runCatching { createLink(if (usePassword) password.trim() else "", expiry) }
                                .onSuccess { link = it }
                                .onFailure { onMessage(it.message ?: "Couldn't create the link") }
                            creating = false
                        }
                    },
                ) {
                    if (creating) CircularProgressIndicator(Modifier.height(18.dp), strokeWidth = 2.dp) else Text("Create link")
                }
            }
        } else {
            Text(
                made,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.primary,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 20.dp),
            )
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 20.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
            ) {
                OutlinedButton(onClick = {
                    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    cm.setPrimaryClip(ClipData.newPlainText("Share link", made))
                    onMessage("Link copied")
                    onDismiss()
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = null)
                    Spacer(Modifier.padding(4.dp))
                    Text("Copy")
                }
                Button(onClick = {
                    val send = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_SUBJECT, file.name)
                        putExtra(Intent.EXTRA_TEXT, made)
                    }
                    context.startActivity(Intent.createChooser(send, "Share ${file.name}"))
                    onDismiss()
                }) {
                    Icon(Icons.Default.Share, contentDescription = null)
                    Spacer(Modifier.padding(4.dp))
                    Text("Share")
                }
            }
            Spacer(Modifier.height(20.dp))
        }
        Spacer(Modifier.height(12.dp))
    }
}
