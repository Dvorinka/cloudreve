package org.cloudreve.android.ui.login

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable
fun LoginScreen(viewModel: LoginViewModel, onLoggedIn: () -> Unit) {
    val state by viewModel.state.collectAsState()
    val context = androidx.compose.ui.platform.LocalContext.current
    val app = context.applicationContext as org.cloudreve.android.CloudreveApp
    val oauth by app.oauthCallback.collectAsState()

    LaunchedEffect(state.loggedIn) {
        if (state.loggedIn) onLoggedIn()
    }

    LaunchedEffect(oauth) {
        oauth?.let {
            app.oauthCallback.value = null
            viewModel.completeOAuth(it.code, it.state)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Cloudreve", style = MaterialTheme.typography.headlineLarge)
        Spacer(Modifier.height(8.dp))

        // Password accepted, server is waiting for the authenticator code.
        if (state.twoFactorSessionId != null) {
            TwoFactorStep(state, viewModel)
            return@Column
        }

        Text(
            "Sign in to your server",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(32.dp))

        OutlinedTextField(
            value = state.serverUrl,
            onValueChange = viewModel::onServerUrlChange,
            label = { Text("Server URL") },
            placeholder = { Text("https://drive.example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.email,
            onValueChange = viewModel::onEmailChange,
            label = { Text("Email") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = { Text("Password") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            modifier = Modifier.fillMaxWidth(),
        )

        state.error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = viewModel::login,
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (state.loading) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
            } else {
                Text("Sign in")
            }
        }
        Spacer(Modifier.height(12.dp))
        androidx.compose.material3.OutlinedButton(
            onClick = {
                viewModel.startOAuth()?.let { url ->
                    context.startActivity(
                        android.content.Intent(
                            android.content.Intent.ACTION_VIEW,
                            android.net.Uri.parse(url),
                        )
                    )
                }
            },
            enabled = !state.loading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text("Sign in with browser")
        }
    }
}

/**
 * Second step of a password login for accounts with two-factor authentication:
 * the server has accepted the password and issued a short-lived 2FA session;
 * the user types the 6-digit TOTP code to finish.
 */
@Composable
private fun TwoFactorStep(state: LoginUiState, viewModel: LoginViewModel) {
    Text(
        "Enter the 6-digit code from your authenticator app",
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    Spacer(Modifier.height(32.dp))

    OutlinedTextField(
        value = state.otp,
        onValueChange = viewModel::onOtpChange,
        label = { Text("Verification code") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
        modifier = Modifier.fillMaxWidth(),
    )

    state.error?.let {
        Spacer(Modifier.height(12.dp))
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    }

    Spacer(Modifier.height(24.dp))
    Button(
        onClick = viewModel::verify2FA,
        enabled = !state.loading && state.otp.length == 6,
        modifier = Modifier.fillMaxWidth(),
    ) {
        if (state.loading) {
            CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
        } else {
            Text("Verify")
        }
    }
    Spacer(Modifier.height(12.dp))
    androidx.compose.material3.TextButton(
        onClick = viewModel::cancelTwoFactor,
        enabled = !state.loading,
    ) {
        Text("Back")
    }
}
