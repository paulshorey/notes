---
name: android-build-apk
description: Only if in a cloud workspace - always build the .apk file after done making changes. If working locally in the desktop IDE, ignore this. If user asks you to "build the app" or to "build the APK", use this skill.
---

# Build the App APK

## When to run

Only do this if you are in the Cursor cloud workspace environment. Skip this if developing locally in the user's desktop IDE.

## Before building the APK, merge latest changes from main

1. If you're on branch `main`, not a feature branch, then create a new feature branch.
2. Commit and push any local changes to the feature branch.
3. Merge main branch into the current feature branch.
4. If there are conflicts, fix, commit and push.

## After merging from main

Generate a new canonical APK file by running this bash script from the repo root:

```bash
bash apps/notes-android/tools/build-dist-apk.sh
```

Running this script does this:

- sources from `apps/notes-android/tools/setup-android-sdk.sh` (installs the SDK if needed)
- builds the debug APK with Gradle
- writes `apps/notes-android/dist/notes-android.apk` (overwrites older build)

## Commit and push the APK file

After the build succeeds:

```bash
BRANCH="$(git branch --show-current)"
git add -f apps/notes-android/dist/notes-android.apk
# Stage any additional task files too.
git commit -m "Describe the feature and rebuilt APK"
git push -u origin "$BRANCH"
```

Do **not** commit machine-local `local.properties`. Restore it with `git restore apps/notes-android/local.properties` if the build script changed it.

## Share the direct GitHub download URL with the user

How to get the raw downloadable URL:

```bash
BRANCH="$(git branch --show-current)"
ORIGIN_URL="$(git remote get-url origin)"
REPO_PATH="$(printf '%s\n' "$ORIGIN_URL" | sed -E 's#^https://[^/]+/##; s#\.git$##; s#^git@github\.com:##')"
echo "https://github.com/${REPO_PATH}/raw/refs/heads/${BRANCH}/apps/notes-android/dist/notes-android.apk"
```

Include a link to that URL in your final response so the user can download and sideload the APK.

Format as markdown, like this:

```
[Direct download APK](https://github.com/paulshorey/marketing/raw/refs/heads/BRANCH_NAME/apps/notes-android/dist/notes-android.apk)
```
