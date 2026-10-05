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
test -s "$APK" || { echo '::error::The signed release APK was not produced at the expected path.'; exit 1; }
test -s "$AAB" || { echo '::error::The signed release App Bundle was not produced at the expected path.'; exit 1; }

if ! "$BUILD_TOOLS/apksigner" verify --verbose --print-certs "$APK" > "$CHECK_DIR/apk-signature" 2>&1; then
  echo '::error::APK cryptographic signature verification failed.'
  exit 1
fi
ACTUAL_CERT=$(sed -n 's/^Signer #1 certificate SHA-256 digest: //p' "$CHECK_DIR/apk-signature")
echo "APK signing certificate SHA-256: $ACTUAL_CERT"
test "$ACTUAL_CERT" = "$EXPECTED_CERT" || { echo '::error::The APK signer differs from the existing XpressTend upload certificate.'; exit 1; }
"$BUILD_TOOLS/aapt" dump badging "$APK" > "$CHECK_DIR/apk-metadata"
sed -n "/^package:/p; /^targetSdkVersion:/p" "$CHECK_DIR/apk-metadata"
grep -Fq "package: name='com.xpresstend.app' versionCode='$EXPECTED_VERSION'" "$CHECK_DIR/apk-metadata" || { echo '::error::The APK package or release build number is incorrect.'; exit 1; }
grep -Fq "targetSdkVersion:'36'" "$CHECK_DIR/apk-metadata" || { echo '::error::The APK target SDK is incorrect.'; exit 1; }
if grep -q 'application-debuggable' "$CHECK_DIR/apk-metadata"; then
  echo '::error::A debuggable APK cannot be published.'
  exit 1
fi
"$BUILD_TOOLS/zipalign" -c -P 16 4 "$APK"

# Upload certificates are self-signed, so jarsigner -strict's CA-trust errors
# are inappropriate here. Require verified integrity and the pinned certificate.
jarsigner -J-Duser.language=en -verify "$AAB" > "$CHECK_DIR/bundle-signature" 2>&1
grep -Fq 'jar verified.' "$CHECK_DIR/bundle-signature"
if grep -Eiq 'unsigned|not signed|weak|disabled algorithm' "$CHECK_DIR/bundle-signature"; then
  echo '::error::App Bundle contains unsigned content or weak signing algorithms.'
  exit 1
fi
keytool -J-Duser.language=en -printcert -jarfile "$AAB" > "$CHECK_DIR/bundle-certificate"
BUNDLE_CERT=$(sed -n 's/^[[:space:]]*SHA256:[[:space:]]*//p' "$CHECK_DIR/bundle-certificate" | head -1 | tr -d ':' | tr '[:upper:]' '[:lower:]')
echo "App Bundle signing certificate SHA-256: $BUNDLE_CERT"
test "$BUNDLE_CERT" = "$EXPECTED_CERT" || { echo '::error::The App Bundle signer differs from the existing XpressTend upload certificate.'; exit 1; }
sha256sum "$APK" "$AAB"
echo "Verified signed release APK and Play App Bundle, build $EXPECTED_VERSION."
