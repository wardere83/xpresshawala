#!/usr/bin/env bash
# A release must be cryptographically signed by the existing upload key and
# contain release configuration. Warning-only checks can publish debug builds.
set -euo pipefail

APK=android/app/build/outputs/apk/release/app-release.apk
AAB=android/app/build/outputs/bundle/release/app-release.aab
EXPECTED_CERT=9e00dfe863947690bd24bef87979faa6186334814a34f1dd5f0c2f41bc22b054
EXPECTED_VERSION=${EXPECTED_ANDROID_VERSION_CODE:?Expected release version is required}
SDK_ROOT=${ANDROID_HOME:-${ANDROID_SDK_ROOT:?Android SDK is required}}
BUILD_TOOLS="$SDK_ROOT/build-tools/$(ls "$SDK_ROOT/build-tools" | sort -V | tail -1)"
CHECK_DIR=$(mktemp -d)
trap 'rm -rf "$CHECK_DIR"' EXIT
test -s "$APK"
test -s "$AAB"

"$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK" > "$CHECK_DIR/apk-signature"
grep -Fq "Signer #1 certificate SHA-256 digest: $EXPECTED_CERT" "$CHECK_DIR/apk-signature"
"$BUILD_TOOLS/aapt" dump badging "$APK" > "$CHECK_DIR/apk-metadata"
grep -Fq "package: name='com.xpresstend.app' versionCode='$EXPECTED_VERSION'" "$CHECK_DIR/apk-metadata"
grep -Fq "targetSdkVersion:'36'" "$CHECK_DIR/apk-metadata"
if grep -q 'application-debuggable' "$CHECK_DIR/apk-metadata"; then
  echo '::error::A debuggable APK cannot be published.'
  exit 1
fi
"$BUILD_TOOLS/zipalign" -c -P 16 4 "$APK"

# Upload certificates are self-signed, so jarsigner -strict's CA-trust errors
# are inappropriate here. Require verified integrity and the pinned certificate.
jarsigner -J-Duser.language=en -verify "$AAB" > "$CHECK_DIR/bundle-signature"
grep -Fq 'jar verified.' "$CHECK_DIR/bundle-signature"
keytool -J-Duser.language=en -printcert -jarfile "$AAB" > "$CHECK_DIR/bundle-certificate"
BUNDLE_CERT=$(sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' "$CHECK_DIR/bundle-certificate" | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')
test "$BUNDLE_CERT" = "$EXPECTED_CERT"
sha256sum "$APK" "$AAB"
echo "Verified signed release APK and Play App Bundle, build $EXPECTED_VERSION."
