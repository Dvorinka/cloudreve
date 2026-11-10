package org.cloudreve.android.ui.files

import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue

// ---- dialogs --------------------------------------------------------------

@Composable
internal fun ConfirmDeleteDialog(title: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text("Items are moved to the trash and can be restored from the web app.") },
        confirmButton = {
            TextButton(onClick = onConfirm) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun NameDialog(
    title: String,
    label: String,
    confirm: String,
    initial: String = "",
    selectEnd: Int = initial.length,
    onConfirm: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    var value by remember {
        mutableStateOf(TextFieldValue(initial, selection = TextRange(0, selectEnd.coerceIn(0, initial.length))))
    }
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = value,
                onValueChange = { value = it },
                label = { Text(label) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { if (value.text.isNotBlank()) onConfirm(value.text.trim()) }),
                modifier = Modifier.focusRequester(focus),
            )
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(value.text.trim()) }, enabled = value.text.isNotBlank()) { Text(confirm) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}
