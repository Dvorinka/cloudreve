import { Alert, Box, Button, CircularProgress, Container, Divider, FormControlLabel, InputAdornment, Radio, RadioGroup, Snackbar, Typography } from "@mui/material";
import { openUrl, openPath } from "@tauri-apps/plugin-opener";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from '@tauri-apps/api/core';
import confetti from "canvas-confetti";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import defaultLogo from "../assets/cloudreve.svg";
import { FilledTextField } from "../common/StyledComponent";
import { useIsWindows10 } from "../hooks/useIsWindows10";
import { fetchSiteIcon, isValidUrl } from "../utils/manifest";
import { generatePKCEPair, randomCryptoString } from "../utils/pkce";
import {
  exchangeTokens,
  isValidationError,
  validateSiteVersion,
  type TokenResponse,
} from "../utils/siteValidation";
import {
  passwordLogin,
  verifyTwoFactor,
  type PasswordAuthResult,
} from "../utils/passwordAuth";
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { platform } from "@tauri-apps/plugin-os";
import { CALLBACK_PATH, CLIENT_ID, SCOPES } from "../utils/constants";

type PageState = "url_input" | "waiting" | "final_setup" | "setting_up" | "success";

interface OAuthCallbackData {
  code: string;
  state: string;
  name: string;
  path: string;
  user_id?: string;
}

// Store PKCE data for use after OAuth redirect
export interface PKCESession {
  codeVerifier: string;
  codeChallenge: string;
  siteUrl: string;
  siteVersion: string;
  siteIcon?: string;
  state?: string;
  callbackData?: OAuthCallbackData;
}

interface AddDriveProps {
  mode?: "add" | "reauthorize";
}

function parseDeeplinkUrl(url: string): OAuthCallbackData | null {
  try {
    // Handle custom protocol: cloudreve://callback/desktop?code=xxx&state=xxx
    const urlObj = new URL(url);
    const code = urlObj.searchParams.get("code");
    const state = urlObj.searchParams.get("state");
    const name = urlObj.searchParams.get("name") || "";
    const path = urlObj.searchParams.get("path") || "";
    const user_id = urlObj.searchParams.get("user_id") || "";
    if (code && state) {
      return { code, state, name, path, user_id };
    }
    return null;
  } catch {
    return null;
  }
}

function buildAuthorizeUrl(siteUrl: string, codeChallenge: string, state: string): string {
  const url = new URL("/session/authorize", siteUrl);
  const params = {
    response_type: "code",
    client_id: CLIENT_ID,
    scope: SCOPES,
    redirect_uri: CALLBACK_PATH,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: state,
  };
  // Use encodeURIComponent to encode spaces as %20 instead of +
  url.search = Object.entries(params)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
  return url.toString();
}

export default function AddDrive({ mode = "add" }: AddDriveProps) {
  const { t } = useTranslation();
  const { driveId, siteUrl: encodedSiteUrl, driveName: driveNameQuery } = useParams<{ driveId?: string; siteUrl?: string, driveName: string }>();
  const isReauthorize = mode === "reauthorize" && driveId && encodedSiteUrl;
  const decodedSiteUrl = encodedSiteUrl ? decodeURIComponent(encodedSiteUrl) : "";
  const isWindows10 = useIsWindows10();

  const [siteUrl, setSiteUrl] = useState(isReauthorize ? decodedSiteUrl : "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [logo, setLogo] = useState(defaultLogo);
  const [authorizeUrl, setAuthorizeUrl] = useState<string | null>(null);
  const [pageState, setPageState] = useState<PageState>(isReauthorize ? "url_input" : "url_input");
  const [localPath, setLocalPath] = useState("");
  const [folderNotEmpty, setFolderNotEmpty] = useState(false);
  const isLinux = platform() === "linux";
  const [syncMode, setSyncMode] = useState<"full" | "ondemand">("full");
  const [driveName, setDriveName] = useState(driveNameQuery ? decodeURIComponent(driveNameQuery) : "");
  // Manual credential sign-in (alternative to browser OAuth).
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [twoFactorSessionId, setTwoFactorSessionId] = useState<string | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const passwordAuthRef = useRef<{ siteUrl: string; result: PasswordAuthResult } | null>(null);
  const lastFetchedUrl = useRef<string>("");
  const currentIconUrl = useRef<string | undefined>(undefined);
  const pkceSessionRef = useRef<PKCESession | null>(null);
  const hasInitialized = useRef(false);

  // Listen for deeplink events from OAuth callback
  useEffect(() => {
    let unlisten: () => void;
    listen<string>('deeplink', (event) => {
      console.log("Received deeplink event:", event.payload);

      const callbackData = parseDeeplinkUrl(event.payload);
      if (!callbackData) {
        console.error("Failed to parse deeplink URL:", event.payload);
        return;
      }

      // Verify state matches current session
      if (!pkceSessionRef.current || callbackData.state !== pkceSessionRef.current.state) {
        console.error("State mismatch or no active session", pkceSessionRef.current, callbackData);
        setError(t("addDrive.errors.stateMismatch"));
        setSnackbarOpen(true);
        return;
      }

      // Store the auth code in the session
      pkceSessionRef.current.callbackData = callbackData;

      // Transition to final setup page
      if (callbackData.name) {
        setDriveName(callbackData.name);
      }
      setPageState("final_setup");
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [t]);

  // Fetch site icon when URL changes and is valid
  const handleUrlBlur = () => {
    const trimmedUrl = siteUrl.trim();
    if (!isValidUrl(trimmedUrl) || trimmedUrl === lastFetchedUrl.current) {
      return;
    }

    lastFetchedUrl.current = trimmedUrl;

    fetchSiteIcon(trimmedUrl)
      .then((iconUrl) => {
        if (iconUrl) {
          // Preload the image to ensure it loads successfully
          const img = new Image();
          img.onload = () => {
            setLogo(iconUrl);
            currentIconUrl.current = iconUrl;
          };
          img.onerror = () => {
            console.error("Failed to load site icon:", iconUrl);
            currentIconUrl.current = undefined;
          };
          img.src = iconUrl;
        }
      })
      .catch((err) => {
        console.error("Failed to fetch manifest:", err);
        currentIconUrl.current = undefined;
      });
  };

  // Reset logo when URL is cleared or becomes invalid
  useEffect(() => {
    if (!siteUrl.trim() || !isValidUrl(siteUrl.trim())) {
      setLogo(defaultLogo);
      lastFetchedUrl.current = "";
      currentIconUrl.current = undefined;
    }
  }, [siteUrl]);

  // Shared authorization logic
  const startAuthorization = useCallback(async (urlToAuthorize: string) => {
    setLoading(true);
    setSnackbarOpen(false);

    try {
      // Validate site version first
      const version = await validateSiteVersion(urlToAuthorize);
      console.log("Site version:", version);

      // Generate PKCE pair
      const { codeVerifier, codeChallenge } = await generatePKCEPair();
      // Add "reauthorize:" prefix to state when in reauthorize mode
      const stateValue = isReauthorize
        ? `reauthorize:${randomCryptoString(32)}`
        : randomCryptoString(32);

      // Store PKCE session data for use after OAuth redirect
      pkceSessionRef.current = {
        codeVerifier,
        codeChallenge,
        siteUrl: urlToAuthorize.trim(),
        siteVersion: version,
        siteIcon: currentIconUrl.current,
        state: stateValue,
      };

      // Build and open the authorization URL
      const authUrl = buildAuthorizeUrl(urlToAuthorize.trim(), codeChallenge, stateValue);
      setAuthorizeUrl(authUrl);
      setPageState("waiting");
      await openUrl(authUrl);
    } catch (error) {
      if (isValidationError(error)) {
        setError(t(`addDrive.errors.${error.type}`, error.params));
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setError(t("addDrive.errors.connectionFailed", { message }));
      }
      setSnackbarOpen(true);
    } finally {
      setLoading(false);
    }
  }, [t, isReauthorize]);

  // Auto-start authorization flow when in reauthorize mode
  useEffect(() => {
    if (isReauthorize && !hasInitialized.current) {
      hasInitialized.current = true;
      // Fetch site icon for the reauthorize URL
      fetchSiteIcon(decodedSiteUrl)
        .then((iconUrl) => {
          if (iconUrl) {
            const img = new Image();
            img.onload = () => {
              setLogo(iconUrl);
              currentIconUrl.current = iconUrl;
            };
            img.src = iconUrl;
          }
        })
        .catch((err) => {
          console.error("Failed to fetch manifest:", err);
        });

      // Auto-start the authorization flow
      startAuthorization(decodedSiteUrl);
    }
  }, [isReauthorize, decodedSiteUrl, startAuthorization]);

  // Trigger confetti effect when entering success state
  useEffect(() => {
    if (pageState === "success") {
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
      });
    }
  }, [pageState]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await startAuthorization(siteUrl);
  };

  const handleOpenAuthorizeUrl = async () => {
    if (authorizeUrl) {
      await openUrl(authorizeUrl);
    }
  };

  const reportAuthError = (error: unknown) => {
    if (isValidationError(error)) {
      setError(t(`addDrive.errors.${error.type}`, error.params));
    } else {
      const message = error instanceof Error ? error.message : String(error);
      setError(t("addDrive.errors.connectionFailed", { message }));
    }
    setSnackbarOpen(true);
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordLoading(true);
    setSnackbarOpen(false);
    const urlToAuth = siteUrl.trim();
    try {
      await validateSiteVersion(urlToAuth);
      const outcome = await passwordLogin(urlToAuth, email.trim(), password);
      if (outcome.kind === "two_factor") {
        setTwoFactorSessionId(outcome.sessionId);
        setOtp("");
        return;
      }
      passwordAuthRef.current = { siteUrl: urlToAuth, result: outcome.result };
      if (outcome.result.nickname) {
        setDriveName((prev) => prev || outcome.result.nickname);
      }
      setPageState("final_setup");
    } catch (error) {
      reportAuthError(error);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleTwoFactorSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorSessionId) return;
    setPasswordLoading(true);
    setSnackbarOpen(false);
    const urlToAuth = siteUrl.trim();
    try {
      const result = await verifyTwoFactor(urlToAuth, twoFactorSessionId, otp.trim());
      passwordAuthRef.current = { siteUrl: urlToAuth, result };
      if (result.nickname) {
        setDriveName((prev) => prev || result.nickname);
      }
      setTwoFactorSessionId(null);
      setPageState("final_setup");
    } catch (error) {
      reportAuthError(error);
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleBack = () => {
    setAuthorizeUrl(null);
    setPageState("url_input");
    setLocalPath("");
    setFolderNotEmpty(false);
    setTwoFactorSessionId(null);
    setOtp("");
    passwordAuthRef.current = null;
    pkceSessionRef.current = null;
  };

  const handleCloseSnackbar = () => {
    setSnackbarOpen(false);
  };

  const checkDirEmpty = async (path: string) => {
    try {
      const empty = await invoke<boolean>('is_dir_empty', { path });
      setFolderNotEmpty(!empty);
    } catch {
      setFolderNotEmpty(false);
    }
  };

  const handleBrowseFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title: t("addDrive.selectFolder"),
    });
    if (selected) {
      setLocalPath(selected);
      await checkDirEmpty(selected);
    }
  };

  const handleFinish = async (e: React.FormEvent) => {
    e.preventDefault();
    setPageState("setting_up");

    const passwordAuth = passwordAuthRef.current;
    let cleanSiteUrl: string;
    let tokens: {
      access_token: string;
      refresh_token: string;
      access_token_expires: number;
      refresh_token_expires: number;
    };
    let remotePath: string;
    let userId: string;

    try {
      if (passwordAuth) {
        cleanSiteUrl = new URL(passwordAuth.siteUrl).origin;
        tokens = passwordAuth.result.tokens;
        remotePath = "cloudreve://my";
        userId = passwordAuth.result.user_id;
      } else {
        const session = pkceSessionRef.current!;
        const oauthTokens: TokenResponse = await exchangeTokens(
          session.siteUrl,
          session.callbackData!.code,
          session.codeVerifier
        );
        tokens = {
          access_token: oauthTokens.access_token,
          refresh_token: oauthTokens.refresh_token,
          access_token_expires: oauthTokens.expires_in,
          refresh_token_expires: oauthTokens.refresh_token_expires_in,
        };
        cleanSiteUrl = new URL(session.siteUrl).origin;
        remotePath = session.callbackData!.path;
        userId = session.callbackData!.user_id || "";
      }
    } catch (error) {
      if (isValidationError(error)) {
        setError(t(`addDrive.errors.${error.type}`, error.params));
      } else {
        const message = error instanceof Error ? error.message : String(error);
        setError(t("addDrive.errors.connectionFailed", { message }));
      }
      setPageState("final_setup");
      setSnackbarOpen(true);
      return;
    }

    try {
      await invoke('add_drive', {
        config: {
          site_url: cleanSiteUrl,
          access_token: tokens.access_token,
          refresh_token: tokens.refresh_token,
          access_token_expires: tokens.access_token_expires,
          refresh_token_expires: tokens.refresh_token_expires,
          drive_name: driveName,
          local_path: localPath,
          remote_path: remotePath,
          user_id: userId,
          drive_id: isReauthorize ? driveId : undefined,
          sync_mode: isLinux ? syncMode : "full",
        }
      });
      // Success - switch to success state
      setPageState("success");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(t("addDrive.errors.addDriveFailed", { message }));
      setPageState("url_input");
      setSnackbarOpen(true);
    }
  }

  const handleOpenDriveAndClose = async () => {
    const pathToOpen = localPath.endsWith('/') || localPath.endsWith('\\') ? localPath : localPath + '/';
    await openPath(pathToOpen);
    await getCurrentWindow().close();
  }

  return (
    <Container maxWidth="sm" sx={{ backgroundColor: isWindows10 ? "#fff" : undefined, minHeight: "100vh", position: "relative" }}>
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          py: 4,
        }}
      >
        <Box
          sx={{
            p: 4,
            py: 2,
            width: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 1,
            borderRadius: 3,
          }}
        >
          {pageState !== "setting_up" && pageState !== "success" && <Box
            component="img"
            src={logo}
            alt="Cloudreve"
            sx={{
              width: 120,
              height: "auto",
              mb: 2,
            }}
          />}

          {pageState === "success" ? (
            // Success state - all done!
            <>
              <Typography
                variant="h1"
                sx={{ fontSize: 64, mt: 2 }}
              >
                🎉
              </Typography>
              <Typography
                sx={{ mt: 2 }}
                variant="h5"
                component="h1"
                fontWeight={500}
                textAlign="center"
              >
                {isReauthorize ? t("addDrive.reauthorizeSuccessTitle") : t("addDrive.successTitle")}
              </Typography>

              <Box
                sx={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  mt: 2,
                }}
              >
                {isReauthorize ? (
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    onClick={() => getCurrentWindow().close()}
                  >
                    {t("addDrive.close")}
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    onClick={handleOpenDriveAndClose}
                  >
                    {t("addDrive.openDrive", { name: driveName })}
                  </Button>
                )}
              </Box>
            </>
          ) : pageState === "setting_up" ? (
            // Setting up state - loading indicator
            <>
              <CircularProgress size={48} sx={{ mt: 2 }} />
              <Typography
                sx={{ mt: 2 }}
                variant="h6"
                component="h1"
                fontWeight={500}
                textAlign="center"
              >
                {t("addDrive.settingUp")}
              </Typography>
            </>
          ) : pageState === "final_setup" ? (
            // Final setup state - local path input (hidden in reauthorize mode)
            <>
              <Typography
                sx={{ mt: 2 }}
                variant="h5"
                component="h1"
                fontWeight={500}
              >
                {isReauthorize ? t("addDrive.reauthorizeTitle") : t("addDrive.finalSetupTitle")}
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
              >
                {isReauthorize ? t("addDrive.reauthorizeDescription") : t("addDrive.finalSetupDescription")}
              </Typography>

              <Box
                component="form"
                onSubmit={handleFinish}
                sx={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  mt: 2,
                }}
              >
                <FilledTextField
                  disabled={mode === "reauthorize"}
                  fullWidth
                  autoComplete="off"
                  label={t("addDrive.localDriveName")}
                  value={driveName}
                  onChange={(e) => setDriveName(e.target.value)}
                  variant="filled"
                  required
                />

                {!isReauthorize && (
                  <>
                    <FilledTextField
                      fullWidth
                      autoComplete="off"
                      label={t("addDrive.localPath")}
                      placeholder={t("addDrive.localPathPlaceholder")}
                      value={localPath}
                      onChange={(e) => {
                        setLocalPath(e.target.value);
                        setFolderNotEmpty(false);
                      }}
                      onBlur={() => localPath && checkDirEmpty(localPath)}
                      variant="filled"
                      required
                      slotProps={{
                        input: {
                          endAdornment: (
                            <InputAdornment position="end">
                              <Button
                                onClick={handleBrowseFolder}
                                size="small"
                              >
                                {t("addDrive.browse")}
                              </Button>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                    {folderNotEmpty && (
                      <Alert severity="info" sx={{ mt: -1 }}>
                        {t(
                          "addDrive.folderNotEmptyWillSync",
                          "This folder already has files. Existing local content will be merged into the remote drive; same-name files with matching hashes will be treated as already synced."
                        )}
                      </Alert>
                    )}
                    {isLinux && (
                      <>
                        <RadioGroup
                          row
                          value={syncMode}
                          onChange={(e) => setSyncMode(e.target.value as "full" | "ondemand")}
                        >
                          <FormControlLabel
                            value="full"
                            control={<Radio size="small" />}
                            label={t("addDrive.syncModeFull", "Full sync")}
                          />
                          <FormControlLabel
                            value="ondemand"
                            control={<Radio size="small" />}
                            label={t("addDrive.syncModeOndemand", "On-demand")}
                          />
                        </RadioGroup>
                        <Typography variant="caption" color="text.secondary">
                          {syncMode === "ondemand"
                            ? t(
                                "addDrive.syncModeOndemandHint",
                                "Files appear instantly and download when opened. Uses less disk space; needs the network for new files. Existing files in the selected folder are hidden while mounted."
                              )
                            : t(
                                "addDrive.syncModeFullHint",
                                "All files are mirrored to this folder and available offline."
                              )}
                        </Typography>
                      </>
                    )}
                  </>
                )}

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  fullWidth
                >
                  {isReauthorize ? t("addDrive.reauthorizeConfirm") : t("addDrive.finish")}
                </Button>

                <Button
                  variant="text"
                  size="large"
                  fullWidth
                  onClick={handleBack}
                >
                  {t("addDrive.back")}
                </Button>
              </Box>
            </>
          ) : pageState === "waiting" ? (
            // Waiting for sign-in state
            <>
              <Typography
                sx={{ mt: 2 }}
                variant="h5"
                component="h1"
                fontWeight={500}
              >
                {t("addDrive.waitingTitle")}
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
              >
                {t("addDrive.waitingDescription")}
              </Typography>

              <Box
                sx={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  mt: 2,
                }}
              >
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  onClick={handleOpenAuthorizeUrl}
                >
                  {t("addDrive.reopenBrowser")}
                </Button>

                <Button
                  variant="text"
                  size="large"
                  fullWidth
                  onClick={handleBack}
                >
                  {t("addDrive.back")}
                </Button>
              </Box>
            </>
          ) : (
            // Initial URL input state
            <>
              <Typography
                sx={{ mt: 2 }}
                variant="h5"
                component="h1"
                fontWeight={500}
              >
                {t("addDrive.title")}
              </Typography>

              <Typography
                variant="body2"
                color="text.secondary"
                textAlign="center"
              >
                {t("addDrive.description")}
              </Typography>

              <Box
                component="form"
                onSubmit={handleSubmit}
                sx={{
                  width: "100%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  mt: 2,
                }}
              >
                <FilledTextField
                  fullWidth
                  autoComplete="off"
                  slotProps={{
                    input: {
                      readOnly: loading,
                    },
                  }}
                  label={t("addDrive.siteUrl")}
                  placeholder={t("addDrive.siteUrlPlaceholder")}
                  value={siteUrl}
                  onChange={(e) => setSiteUrl(e.target.value)}
                  onBlur={handleUrlBlur}
                  variant="filled"
                  type="url"
                  required
                />

                <Button
                  type="submit"
                  variant="contained"
                  size="large"
                  loading={loading}
                  fullWidth
                >
                  {t("addDrive.connect")}
                </Button>
              </Box>

              {!isReauthorize && (
                <>
                  <Divider sx={{ width: "100%", my: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t("addDrive.orSignIn")}
                    </Typography>
                  </Divider>
                  {twoFactorSessionId ? (
                    <Box
                      component="form"
                      onSubmit={handleTwoFactorSubmit}
                      sx={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" color="text.secondary" textAlign="center">
                        {t("addDrive.otpDescription")}
                      </Typography>
                      <FilledTextField
                        fullWidth
                        autoComplete="one-time-code"
                        label={t("addDrive.otp")}
                        value={otp}
                        onChange={(e) => setOtp(e.target.value)}
                        variant="filled"
                        required
                        slotProps={{ htmlInput: { inputMode: "numeric", maxLength: 12 } }}
                      />
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        loading={passwordLoading}
                        fullWidth
                      >
                        {t("addDrive.verify")}
                      </Button>
                      <Button
                        variant="text"
                        size="large"
                        fullWidth
                        onClick={() => {
                          setTwoFactorSessionId(null);
                          setOtp("");
                        }}
                      >
                        {t("addDrive.back")}
                      </Button>
                    </Box>
                  ) : (
                    <Box
                      component="form"
                      onSubmit={handlePasswordSubmit}
                      sx={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                      }}
                    >
                      <FilledTextField
                        fullWidth
                        autoComplete="email"
                        label={t("addDrive.email")}
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        variant="filled"
                        type="email"
                        required
                      />
                      <FilledTextField
                        fullWidth
                        autoComplete="current-password"
                        label={t("addDrive.password")}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        variant="filled"
                        type="password"
                        required
                      />
                      <Button
                        type="submit"
                        variant="outlined"
                        size="large"
                        loading={passwordLoading}
                        fullWidth
                      >
                        {t("addDrive.signIn")}
                      </Button>
                    </Box>
                  )}
                </>
              )}
            </>
          )}
        </Box>
      </Box>
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={6000}
        onClose={handleCloseSnackbar}
        message={error}
      />
    </Container>
  );
}
