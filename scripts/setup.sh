#!/usr/bin/env bash
set -e

CERT="$HOME/.mitmproxy/mitmproxy-ca-cert.pem"
KEYCHAIN="/Library/Keychains/System.keychain"

# 1. Install mitmproxy if not present
if ! command -v mitmdump &>/dev/null; then
  echo "Installing mitmproxy via Homebrew..."
  brew install mitmproxy
else
  echo "mitmproxy is already installed."
fi

# 2. Generate cert if not present
if [ ! -f "$CERT" ]; then
  echo "Starting mitmdump briefly to generate certificate..."
  mitmdump --listen-port 8080 &
  MITM_PID=$!
  sleep 3
  kill "$MITM_PID" 2>/dev/null || true
  wait "$MITM_PID" 2>/dev/null || true
  echo "Certificate generated at $CERT"
else
  echo "Certificate already exists at $CERT"
fi

# 3. Trust cert in macOS keychain (idempotent — security exits 0 if already trusted)
if sudo security find-certificate -c "mitmproxy" "$KEYCHAIN" &>/dev/null; then
  echo "mitmproxy certificate is already trusted in the system keychain."
else
  echo "Trusting mitmproxy certificate in system keychain (requires sudo)..."
  sudo security add-trusted-cert -d -r trustRoot -k "$KEYCHAIN" "$CERT"
  echo "Certificate trusted."
fi

# 4. Chrome instructions
echo ""
echo "------------------------------------------------------------"
echo "Chrome setup:"
echo "  Chrome relies on the macOS system keychain, so the cert"
echo "  is already trusted for Chrome as well."
echo "  Please RESTART Chrome for the change to take effect."
echo "------------------------------------------------------------"
