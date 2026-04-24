## `tools`

Helper scripts for provisioning the Android toolchain and building APKs for `notes-android`.

### Main scripts

- `check-prereqs.sh` - verify required host commands.
- `install-jdk.sh` - install a repo-local JDK into `.jdk/current`.
- `install-android-sdk.sh` - install Android command-line tools and required SDK packages.
- `setup-android-sdk.sh` - configure `ANDROID_HOME`, repo-local cache dirs, and `local.properties`.
- `build-android.sh` - assemble the debug APK.
- `build-dist-apk.sh` - copy the assembled debug APK to `dist/notes-android.apk`.
- `cloud-provision.sh` - bootstrap the full Android toolchain in cloud environments.

### Typical usage

From the monorepo root:

```bash
bash apps/notes-android/tools/check-prereqs.sh
bash apps/notes-android/tools/setup-android-sdk.sh
bash apps/notes-android/tools/build-android.sh
```

If `ANDROID_HOME` points to a missing or unwritable SDK path, `setup-android-sdk.sh` falls back to the repo-local SDK under `.android-sdk`.

If you need a single installable artifact path:

```bash
bash apps/notes-android/tools/build-dist-apk.sh
```
