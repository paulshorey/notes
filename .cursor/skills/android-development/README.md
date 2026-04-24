
### Local macOS

Android Studio manages the SDK at `~/Library/Android/sdk`. Add this to `~/.zshrc` or `~/.zprofile` so all build scripts pick it up:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
```

Then generate `local.properties` for Gradle:

```bash
bash apps/notes-android/tools/setup-android-sdk.sh
```

`local.properties` is gitignored and machine-specific. This command writes it using `ANDROID_HOME`, so it works correctly in both environments.
