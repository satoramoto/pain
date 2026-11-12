#!/bin/bash
# Based on openflowfm/visuals/.github/workflows/release.yml. Never enable xtrace.
set -euo pipefail
keychain="$RUNNER_TEMP/pain-signing.keychain-db"
case "${1:-}" in
  prepare)
    names=(MACOS_CERTIFICATE MACOS_CERTIFICATE_PASSWORD APPLE_API_KEY_P8 APPLE_API_KEY_ID APPLE_API_ISSUER)
    present=0
    for name in "${names[@]}"; do
      if [ -n "${!name:-}" ]; then present=$((present + 1)); fi
    done
    if [ "$present" -eq 0 ] && [ "${REQUIRE_SIGNING:-false}" != true ]; then
      echo '::notice::No signing secrets configured: this is an UNSIGNED QA build.'
      echo 'signed=false' >> "$GITHUB_OUTPUT"
      exit 0
    fi
    for name in "${names[@]}"; do
      if [ -z "${!name:-}" ]; then echo "::error::Missing repository secret: $name"; exit 1; fi
    done
    umask 077
    password=$(openssl rand -hex 24)
    printf '%s' "$MACOS_CERTIFICATE" | base64 --decode > "$RUNNER_TEMP/pain-certificate.p12"
    security create-keychain -p "$password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$password" "$keychain"
    security import "$RUNNER_TEMP/pain-certificate.p12" -k "$keychain" \
      -P "$MACOS_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security
    security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$keychain" >/dev/null
    read -r -a existing <<< "$(security list-keychains -d user | tr -d '"' | tr '\n' ' ')"
    security list-keychains -d user -s "$keychain" "${existing[@]}"
    rm "$RUNNER_TEMP/pain-certificate.p12"
    identity=$(security find-identity -v -p codesigning "$keychain" | sed -n 's/.*"\(Developer ID Application: .*\)"/\1/p' | head -n 1)
    [ -n "$identity" ] || { echo '::error::No Developer ID Application identity in the certificate.'; exit 1; }
    printf '%s' "$APPLE_API_KEY_P8" | base64 --decode > "$RUNNER_TEMP/pain-notary.p8"
    echo "APPLE_SIGNING_IDENTITY=$identity" >> "$GITHUB_ENV"
    echo "APPLE_API_KEY_PATH=$RUNNER_TEMP/pain-notary.p8" >> "$GITHUB_ENV"
    echo 'signed=true' >> "$GITHUB_OUTPUT"
    ;;
  runtime)
    # The runtime is later embedded as a tarball and extracted outside the .app.
    # Submit its Mach-O files separately so their signatures have notary tickets.
    ditto -c -k --keepParent .build/macos-runtime "$RUNNER_TEMP/pain-runtime.zip"
    xcrun notarytool submit "$RUNNER_TEMP/pain-runtime.zip" --key "$APPLE_API_KEY_PATH" \
      --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait --output-format json > "$RUNNER_TEMP/pain-notary-result.json"
    python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print("Runtime notarization:",r["status"]); sys.exit(0 if r["status"]=="Accepted" else 1)' "$RUNNER_TEMP/pain-notary-result.json"
    ;;
  verify)
    bundles=desktop/src-tauri/target/aarch64-apple-darwin/release/bundle
    for app in "$bundles"/macos/*.app; do
      codesign --verify --deep --strict --verbose=2 "$app"
      spctl --assess --type execute --verbose=4 "$app"
      xcrun stapler validate "$app"
    done
    for dmg in "$bundles"/dmg/*.dmg; do
      codesign --force --timestamp --sign "$APPLE_SIGNING_IDENTITY" "$dmg"
      xcrun notarytool submit "$dmg" --key "$APPLE_API_KEY_PATH" \
        --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER" --wait
      xcrun stapler staple "$dmg"
      codesign --verify --strict --verbose=2 "$dmg"
      spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"
      xcrun stapler validate "$dmg"
    done
    ;;
  cleanup)
    if [ -f "$keychain" ]; then security delete-keychain "$keychain"; fi
    rm -f "$RUNNER_TEMP/pain-certificate.p12" "$RUNNER_TEMP/pain-notary.p8" "$RUNNER_TEMP/pain-runtime.zip" "$RUNNER_TEMP/pain-notary-result.json"
    ;;
  *) echo 'Expected prepare, runtime, verify or cleanup.' >&2; exit 2 ;;
esac
