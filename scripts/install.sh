#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-Xangel0s/OzyBase}"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
VERSION="${VERSION:-latest}"
BINARY_NAME="ozybase"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -b|--bin-dir)
      BIN_DIR="$2"
      shift 2
      ;;
    -v|--version)
      VERSION="$2"
      shift 2
      ;;
    -r|--repo)
      REPO="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "unsupported architecture: $ARCH" >&2
    exit 1
    ;;
esac

if [[ "$OS" != "linux" && "$OS" != "darwin" ]]; then
  echo "unsupported OS: $OS" >&2
  exit 1
fi

if [[ "$VERSION" == "latest" ]]; then
  RELEASE_API="https://api.github.com/repos/${REPO}/releases/latest"
else
  VERSION="${VERSION#v}"
  RELEASE_API="https://api.github.com/repos/${REPO}/releases/tags/v${VERSION}"
fi

echo "Fetching release metadata from ${REPO}..."
TAG="$(curl -fsSL "$RELEASE_API" | grep -m1 '"tag_name":' | sed -E 's/.*"v?([^"]+)".*/\1/')"
if [[ -z "${TAG}" ]]; then
  echo "unable to resolve release tag" >&2
  exit 1
fi

ASSET="ozybase_${TAG}_${OS}_${ARCH}.tar.gz"
URL="https://github.com/${REPO}/releases/download/v${TAG}/${ASSET}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "Downloading ${ASSET}..."
curl -fsSL "$URL" -o "${TMP_DIR}/${ASSET}"
tar -xzf "${TMP_DIR}/${ASSET}" -C "${TMP_DIR}"

mkdir -p "$BIN_DIR"
install -m 0755 "${TMP_DIR}/${BINARY_NAME}" "${BIN_DIR}/${BINARY_NAME}"

echo "Installed ${BINARY_NAME} to ${BIN_DIR}/${BINARY_NAME}"
"${BIN_DIR}/${BINARY_NAME}" version || true
